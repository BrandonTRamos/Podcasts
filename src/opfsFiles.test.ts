import { describe, expect, it } from 'vitest'
import {
  createFileClient,
  createFileServer,
  type FileReply,
  type OpfsDirectory,
  type OpfsFileHandle,
  type SyncAccessHandle,
} from './opfsFiles'

/**
 * Stands in for the Origin Private File System as a worker sees it. A sync
 * access handle's writes reach the disk only when flushed or closed: when the
 * page is `kill`ed, every file goes back to what reached the disk, and open
 * handles stop working. One handle may be open on a file at a time.
 */
class FakeOpfs {
  #disk = new Map<string, Uint8Array>()
  #live = new Map<string, Uint8Array>()
  #locked = new Set<string>()
  #handles = new Set<{ dead: boolean }>()
  /** Bytes the disk has room for, across every file. */
  room = Infinity

  constructor({ withMove }: { withMove: boolean }) {
    this.directory = {
      getFileHandle: async (name, { create = false } = {}) => {
        if (!this.#live.has(name)) {
          if (!create) throw new DOMException(`No file ${name}`, 'NotFoundError')
          this.#live.set(name, new Uint8Array())
          this.#disk.set(name, new Uint8Array())
        }
        return this.#fileHandle(name, withMove)
      },
      removeEntry: async (name) => {
        if (!this.#live.has(name)) throw new DOMException(`No file ${name}`, 'NotFoundError')
        this.#live.delete(name)
        this.#disk.delete(name)
      },
      entries: () => this.#entries(),
    }
  }

  async *#entries(): AsyncIterable<[string, { kind: string }]> {
    for (const name of this.#live.keys()) yield [name, { kind: 'file' }]
  }

  readonly directory: OpfsDirectory

  /** The page is killed: what wasn't flushed is lost. */
  kill() {
    for (const handle of this.#handles) handle.dead = true
    this.#handles.clear()
    this.#locked.clear()
    for (const [name, bytes] of this.#disk) this.#live.set(name, bytes.slice())
  }

  /** What is on disk for the file. */
  onDisk(name: string) {
    return this.#disk.get(name)
  }

  names() {
    return [...this.#live.keys()]
  }

  #fileHandle(name: string, withMove: boolean): OpfsFileHandle {
    const handle: OpfsFileHandle = {
      getFile: async () => ({ size: this.#live.get(name)!.length }),
      createSyncAccessHandle: async () => {
        if (this.#locked.has(name)) throw new DOMException('Already open', 'NoModificationAllowedError')
        this.#locked.add(name)
        return this.#access(name)
      },
    }
    if (withMove) {
      handle.move = async (to) => {
        this.#live.set(to, this.#live.get(name)!)
        this.#disk.set(to, this.#disk.get(name)!)
        this.#live.delete(name)
        this.#disk.delete(name)
      }
    }
    return handle
  }

  #access(name: string): SyncAccessHandle {
    const state = { dead: false }
    this.#handles.add(state)
    const live = () => {
      if (state.dead) throw new DOMException('The handle is closed', 'InvalidStateError')
      return this.#live.get(name)!
    }
    const used = () => [...this.#live.values()].reduce((sum, bytes) => sum + bytes.length, 0)
    const flush = () => void this.#disk.set(name, live().slice())
    return {
      getSize: () => live().length,
      truncate: (size) => void this.#live.set(name, live().slice(0, size)),
      read: (buffer, { at }) => {
        const part = live().subarray(at, at + buffer.length)
        buffer.set(part)
        return part.length
      },
      write: (buffer, { at }) => {
        const before = live()
        const end = Math.max(before.length, at + buffer.length)
        if (used() - before.length + end > this.room) throw new DOMException('No space left', 'QuotaExceededError')
        const after = new Uint8Array(end)
        after.set(before)
        after.set(buffer, at)
        this.#live.set(name, after)
        return buffer.length
      },
      flush,
      close: () => {
        flush()
        state.dead = true
        this.#locked.delete(name)
      },
    }
  }
}

/** Device files over a fake worker boundary: messages are cloned, and chunks handed over, as `postMessage` does. */
function filesOn(opfs: FakeOpfs) {
  const serve = createFileServer(async () => opfs.directory)
  const client = createFileClient(
    (message, transfer) => {
      void serve(structuredClone(message, { transfer })).then((reply: FileReply) => client.receive(structuredClone(reply)))
    },
    async () => null,
  )
  return client.files
}

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('device files in the origin private file system', () => {
  it('keeps every write that resolved when the page is killed before the file is closed', async () => {
    const opfs = new FakeOpfs({ withMove: true })
    const files = filesOn(opfs)
    const file = await files.openForAppend('episode.part')
    await file.write(bytes(1, 2, 3))
    await file.write(bytes(4, 5))

    opfs.kill()

    expect(opfs.onDisk('episode.part')).toEqual(bytes(1, 2, 3, 4, 5))
    // A fresh page carries on from there.
    const again = filesOn(opfs)
    expect(await again.size('episode.part')).toBe(5)
    const resumed = await again.openForAppend('episode.part')
    await resumed.write(bytes(6))
    await resumed.close()
    expect(opfs.onDisk('episode.part')).toEqual(bytes(1, 2, 3, 4, 5, 6))
  })

  it('hands each chunk over to the worker rather than copying it', async () => {
    const files = filesOn(new FakeOpfs({ withMove: true }))
    const file = await files.openForAppend('episode.part')
    const chunk = bytes(1, 2, 3)

    await file.write(chunk)

    expect(chunk.byteLength).toBe(0)
  })

  it('empties a file opened fresh, and adds to the end of one opened otherwise', async () => {
    const opfs = new FakeOpfs({ withMove: true })
    const files = filesOn(opfs)
    const first = await files.openForAppend('a')
    await first.write(bytes(1, 2))
    await first.close()

    const appended = await files.openForAppend('a')
    await appended.write(bytes(3))
    await appended.close()
    expect(opfs.onDisk('a')).toEqual(bytes(1, 2, 3))

    const fresh = await files.openForAppend('a', { fresh: true })
    await fresh.write(bytes(9))
    await fresh.close()
    expect(opfs.onDisk('a')).toEqual(bytes(9))
  })

  it('says how big a file is, including while it is being written', async () => {
    const files = filesOn(new FakeOpfs({ withMove: true }))
    expect(await files.size('a')).toBeNull()
    const file = await files.openForAppend('a')
    await file.write(bytes(1, 2, 3))

    expect(await files.size('a')).toBe(3)
    await file.close()
    expect(await files.size('a')).toBe(3)
    expect(await files.list()).toEqual(['a'])
  })

  it.each([true, false])('renames a file (with the browser’s own move: %s)', async (withMove) => {
    const opfs = new FakeOpfs({ withMove })
    const files = filesOn(opfs)
    const file = await files.openForAppend('episode.part')
    await file.write(bytes(1, 2, 3))
    await file.close()

    await files.rename('episode.part', 'episode')

    expect(opfs.names()).toEqual(['episode'])
    expect(opfs.onDisk('episode')).toEqual(bytes(1, 2, 3))
  })

  it('reports a full device as QuotaExceededError', async () => {
    const opfs = new FakeOpfs({ withMove: true })
    opfs.room = 2
    const files = filesOn(opfs)
    const file = await files.openForAppend('a')

    await expect(file.write(bytes(1, 2, 3))).rejects.toMatchObject({ name: 'QuotaExceededError' })
  })

  it('removes a file, and ignores one that is already gone', async () => {
    const opfs = new FakeOpfs({ withMove: true })
    const files = filesOn(opfs)
    await (await files.openForAppend('a')).close()

    await files.remove('a')
    await files.remove('a')

    expect(opfs.names()).toEqual([])
  })
})

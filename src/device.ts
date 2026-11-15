import type { Device, DeviceFiles, FileAppender, ScreenHold } from './services'

/**
 * The browser's own facilities, as the download manager uses them: the Origin
 * Private File System, `fetch`, the screen wake lock and storage persistence.
 */
export function browserDevice(): Device {
  return {
    files: originPrivateFiles(),
    fetch: (url, init) => fetch(url, init),
    async keepScreenOn(): Promise<ScreenHold> {
      if (!('wakeLock' in navigator)) throw new Error('No screen wake lock in this browser')
      return navigator.wakeLock.request('screen')
    },
    async persistStorage() {
      if (!navigator.storage?.persist) return false
      return (await navigator.storage.persisted()) || navigator.storage.persist()
    },
  }
}

/**
 * Writes are committed to the file this often. A writable stream keeps what
 * it is given in a swap file until it is closed, so a page killed mid-download
 * loses at most this much.
 */
const COMMIT_EVERY_BYTES = 4_000_000

/** Files in the Origin Private File System's root folder. */
function originPrivateFiles(): DeviceFiles {
  const root = () => navigator.storage.getDirectory()

  async function handle(name: string): Promise<FileSystemFileHandle | null> {
    try {
      return await (await root()).getFileHandle(name)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null
      throw error
    }
  }

  return {
    async list() {
      const names: string[] = []
      for await (const [name, entry] of (await root()).entries()) {
        if (entry.kind === 'file') names.push(name)
      }
      return names
    },

    async size(name) {
      const file = await handle(name)
      return file ? (await file.getFile()).size : null
    },

    async openForAppend(name, { fresh = false } = {}): Promise<FileAppender> {
      const file = await (await root()).getFileHandle(name, { create: true })
      const open = async (keepExistingData: boolean) => {
        const writable = await file.createWritable({ keepExistingData })
        if (keepExistingData) await writable.seek((await file.getFile()).size)
        return writable
      }
      let writable = await open(!fresh)
      let uncommitted = 0
      return {
        async write(chunk) {
          await writable.write(chunk as Uint8Array<ArrayBuffer>)
          uncommitted += chunk.length
          if (uncommitted >= COMMIT_EVERY_BYTES) {
            await writable.close()
            writable = await open(true)
            uncommitted = 0
          }
        },
        close: () => writable.close(),
      }
    },

    async rename(from, to) {
      const source = await handle(from)
      if (!source) throw new DOMException(`No file ${from}`, 'NotFoundError')
      const movable = source as FileSystemFileHandle & { move?: (name: string) => Promise<void> }
      if (movable.move) {
        await movable.move(to)
        return
      }
      // Without `move`, copy it across as a stream, never whole in memory.
      const target = await (await root()).getFileHandle(to, { create: true })
      await (await source.getFile()).stream().pipeTo(await target.createWritable())
      await (await root()).removeEntry(from)
    },

    async playbackUrl(name) {
      const file = await handle(name)
      // A File from the file system refers to the file on disk; the URL doesn't copy it into memory.
      return file ? URL.createObjectURL(await file.getFile()) : null
    },

    async remove(name) {
      try {
        await (await root()).removeEntry(name)
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
      }
    },
  }
}

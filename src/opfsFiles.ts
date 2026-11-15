import type { DeviceFiles, FileAppender } from './services'

/**
 * Device files in the Origin Private File System, written through sync access
 * handles in a dedicated worker (`opfsWorker.ts`), the only place they exist.
 * Each chunk is written and flushed before its write resolves, so a page
 * killed part way through a download, as iOS does to a suspended app, keeps
 * every chunk already stored. Sync access handles reach back to Safari 15.2,
 * where the writable streams the main thread could use need Safari 26.
 *
 * The main thread holds a client (`createFileClient`) that sends each request
 * to the worker, transferring chunks rather than copying them; the worker
 * answers them with `serveFileRequest`.
 */

/** What the worker is asked to do. */
export type FileRequest =
  | { op: 'list' }
  | { op: 'size'; name: string }
  | { op: 'open'; name: string; fresh: boolean }
  | { op: 'write'; handle: number; chunk: ArrayBuffer }
  | { op: 'close'; handle: number }
  | { op: 'rename'; from: string; to: string }
  | { op: 'remove'; name: string }

export interface FileMessage {
  id: number
  request: FileRequest
}

export type FileReply =
  | { id: number; ok: true; value: unknown }
  /** An error's name survives, so a `QuotaExceededError` is still one on the other side. */
  | { id: number; ok: false; error: { name: string; message: string } }

/**
 * The parts of the OPFS the worker uses. Older Safari returns promises from
 * the sync access handle's methods, so every result is awaited.
 */
export interface SyncAccessHandle {
  getSize(): number | Promise<number>
  truncate(size: number): void | Promise<void>
  read(buffer: Uint8Array, options: { at: number }): number | Promise<number>
  write(buffer: Uint8Array, options: { at: number }): number | Promise<number>
  flush(): void | Promise<void>
  close(): void | Promise<void>
}

export interface OpfsFileHandle {
  getFile(): Promise<{ size: number }>
  createSyncAccessHandle(): Promise<SyncAccessHandle>
  /** Missing from some browsers. */
  move?(name: string): Promise<void>
}

export interface OpfsDirectory {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>
  removeEntry(name: string): Promise<void>
  entries(): AsyncIterable<[string, { kind: string }]>
}

/** Bytes copied at a time when a rename has to copy. */
const COPY_BLOCK_BYTES = 1_000_000

/**
 * Answers the main thread's file requests against this folder, one at a time
 * in the order sent. Runs in the worker.
 */
export function createFileServer(directory: () => Promise<OpfsDirectory>) {
  const open = new Map<number, { name: string; access: SyncAccessHandle; position: number }>()
  let nextHandle = 1
  let queue: Promise<unknown> = Promise.resolve()

  async function handleFor(name: string, create = false) {
    try {
      return await (await directory()).getFileHandle(name, { create })
    } catch (error) {
      if (isNamed(error, 'NotFoundError')) return null
      throw error
    }
  }

  async function serve(request: FileRequest): Promise<unknown> {
    switch (request.op) {
      case 'list': {
        const names: string[] = []
        for await (const [name, entry] of (await directory()).entries()) if (entry.kind === 'file') names.push(name)
        return names
      }
      case 'size': {
        const writing = [...open.values()].find((file) => file.name === request.name)
        if (writing) return writing.position
        const file = await handleFor(request.name)
        return file ? (await file.getFile()).size : null
      }
      case 'open': {
        const file = (await handleFor(request.name, true))!
        const access = await file.createSyncAccessHandle()
        if (request.fresh) {
          await access.truncate(0)
          await access.flush()
        }
        const handle = nextHandle++
        open.set(handle, { name: request.name, access, position: await access.getSize() })
        return handle
      }
      case 'write': {
        const file = open.get(request.handle)
        if (!file) throw new DOMException('The file is closed', 'InvalidStateError')
        const bytes = new Uint8Array(request.chunk)
        let written = 0
        while (written < bytes.length) {
          written += await file.access.write(bytes.subarray(written), { at: file.position + written })
        }
        // On disk before the write resolves: a killed page keeps it.
        await file.access.flush()
        file.position += written
        return undefined
      }
      case 'close': {
        const file = open.get(request.handle)
        if (!file) return undefined
        open.delete(request.handle)
        try {
          await file.access.flush()
        } finally {
          await file.access.close()
        }
        return undefined
      }
      case 'rename':
        return rename(request.from, request.to)
      case 'remove':
        try {
          await (await directory()).removeEntry(request.name)
        } catch (error) {
          if (!isNamed(error, 'NotFoundError')) throw error
        }
        return undefined
    }
  }

  async function rename(from: string, to: string) {
    const source = await handleFor(from)
    if (!source) throw new DOMException(`No file ${from}`, 'NotFoundError')
    if (source.move) {
      await source.move(to)
      return
    }
    // Without `move`, copy it across a block at a time, never whole in memory.
    const target = (await handleFor(to, true))!
    const reading = await source.createSyncAccessHandle()
    try {
      const writing = await target.createSyncAccessHandle()
      try {
        await writing.truncate(0)
        const size = await reading.getSize()
        const block = new Uint8Array(Math.min(COPY_BLOCK_BYTES, Math.max(size, 1)))
        for (let at = 0; at < size; ) {
          const read = await reading.read(block, { at })
          if (read === 0) break
          let written = 0
          while (written < read) written += await writing.write(block.subarray(written, read), { at: at + written })
          at += read
        }
        await writing.flush()
      } finally {
        await writing.close()
      }
    } finally {
      await reading.close()
    }
    await (await directory()).removeEntry(from)
  }

  /** Answers one message, after every one sent before it. */
  return function serveFileRequest({ id, request }: FileMessage): Promise<FileReply> {
    const reply = queue.then(
      () => serve(request),
      () => serve(request),
    )
    queue = reply.catch(() => {})
    return reply.then(
      (value): FileReply => ({ id, ok: true, value }),
      (error: unknown): FileReply => ({
        id,
        ok: false,
        error: {
          name: error instanceof Error || error instanceof DOMException ? error.name : 'Error',
          message: error instanceof Error || error instanceof DOMException ? error.message : String(error),
        },
      }),
    )
  }
}

/**
 * Device files that live in the worker. `post` sends a message to it,
 * transferring the listed buffers; pass each of its replies to `receive`.
 * Playback URLs come from `playbackUrl`, as the main thread must make them.
 */
export function createFileClient(
  post: (message: FileMessage, transfer: ArrayBuffer[]) => void,
  playbackUrl: (name: string) => Promise<string | null>,
): { files: DeviceFiles; receive: (reply: FileReply) => void } {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  let nextId = 1

  function send<T>(request: FileRequest, transfer: ArrayBuffer[] = []): Promise<T> {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      post({ id, request }, transfer)
    })
  }

  const files: DeviceFiles = {
    list: () => send<string[]>({ op: 'list' }),
    size: (name) => send<number | null>({ op: 'size', name }),
    async openForAppend(name, { fresh = false } = {}): Promise<FileAppender> {
      const handle = await send<number>({ op: 'open', name, fresh })
      return {
        write(chunk) {
          const buffer = ownBuffer(chunk)
          return send<void>({ op: 'write', handle, chunk: buffer }, [buffer])
        },
        close: () => send<void>({ op: 'close', handle }),
      }
    },
    rename: (from, to) => send<void>({ op: 'rename', from, to }),
    playbackUrl,
    remove: (name) => send<void>({ op: 'remove', name }),
  }

  return {
    files,
    receive(reply) {
      const waiting = pending.get(reply.id)
      if (!waiting) return
      pending.delete(reply.id)
      if (reply.ok) waiting.resolve(reply.value)
      else waiting.reject(new DOMException(reply.error.message, reply.error.name))
    },
  }
}

/** The chunk's bytes as a buffer of their own, to hand over without copying when they already are one. */
function ownBuffer(chunk: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = chunk
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) return buffer
  return chunk.slice().buffer
}

function isNamed(error: unknown, name: string) {
  return (error instanceof DOMException || error instanceof Error) && error.name === name
}

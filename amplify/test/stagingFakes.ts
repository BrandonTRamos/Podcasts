import { vi } from 'vitest'
import type { StagingBucket, StagingOutcome, StagingStatus, StagingStore } from '../downloads/stagingStore'

/** A staging request as the fake data API holds it. */
export interface FakeStaging {
  id: string
  episodeId: string
  status: StagingStatus
  objectKey?: string
  url?: string
  urlExpiresAt?: string
}

/** In-memory stand-in for the data API's episodes and staging records, as the stager sees them. */
export function fakeStagingStore() {
  const enclosures = new Map<string, string>()
  const stagings = new Map<string, FakeStaging>()
  /** Each status a request was given, in order, by request. */
  const history = new Map<string, StagingStatus[]>()

  const store: StagingStore = {
    async getEnclosureUrl(episodeId) {
      return enclosures.get(episodeId) ?? null
    },
    async createStaging({ id, episodeId }) {
      if (stagings.has(id)) throw new Error(`Staging ${id} already exists`)
      stagings.set(id, { id, episodeId, status: 'preparing' })
      history.set(id, ['preparing'])
    },
    async settleStaging(id, outcome: StagingOutcome) {
      const existing = stagings.get(id)
      if (!existing) throw new Error(`No staging ${id}`)
      stagings.set(id, { ...existing, ...outcome })
      history.get(id)!.push(outcome.status)
    },
  }

  return {
    store,
    /** An episode whose audio file is at this URL. */
    seedEpisode(episodeId: string, enclosureUrl: string) {
      enclosures.set(episodeId, enclosureUrl)
    },
    staging: (id: string) => stagings.get(id),
    /** Every status the request was given, oldest first. */
    statusesOf: (id: string) => history.get(id) ?? [],
  }
}

/**
 * Stands in for the private staging bucket. Objects are stored as their
 * bytes, or, for very large files, as their size alone; a put whose stream
 * errors stores nothing. `onChunk` is called with each piece as it is read.
 */
export function fakeStagingBucket({ keepBytes = true, now = () => new Date() }: { keepBytes?: boolean; now?: () => Date } = {}) {
  const objects = new Map<string, { bytes: Uint8Array | null; size: number; contentType: string | null; storedAt: Date }>()
  let broken: Error | null = null
  const chunkListeners: ((length: number) => void)[] = []

  const bucket: StagingBucket = {
    async put(key, body, { contentType }) {
      const reader = body.getReader()
      const pieces: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (broken) {
          void reader.cancel()
          throw broken
        }
        size += value.length
        chunkListeners.forEach((listener) => listener(value.length))
        if (keepBytes) pieces.push(value)
      }
      const bytes = keepBytes ? new Uint8Array(size) : null
      if (bytes) {
        let at = 0
        for (const piece of pieces) {
          bytes.set(piece, at)
          at += piece.length
        }
      }
      objects.set(key, { bytes, size, contentType, storedAt: now() })
    },
    async linkTo(key, seconds) {
      if (!objects.has(key)) throw new Error(`No object ${key}`)
      return `https://staging.s3.example.com/${key}?expires-in=${seconds}`
    },
    async list() {
      return [...objects].map(([key, { storedAt }]) => ({ key, storedAt }))
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key)
    },
  }

  return {
    bucket,
    object: (key: string) => {
      const object = objects.get(key)
      if (!object) return undefined
      const { storedAt: _storedAt, ...rest } = object
      return rest
    },
    keys: () => [...objects.keys()],
    /** Storing fails from now on, with this error. */
    break(error = new Error('S3 is unavailable')) {
      broken = error
    },
    onChunk(listener: (length: number) => void) {
      chunkListeners.push(listener)
    },
  }
}

/**
 * A publisher's host serving audio files over outbound HTTP. Each file is
 * streamed in `chunkSize` pieces, made only as they are read, so a very large
 * file never exists whole. `sent` counts the bytes handed over so far.
 */
export function fakeAudioHost() {
  const files = new Map<string, { size: number; status: number; sendsOnly: number | null; contentType: string }>()
  const requested: string[] = []
  const host = {
    chunkSize: 64 * 1024,
    sent: 0,
    requested,
    /** Serves a file of `size` bytes at the URL; `sendsOnly` cuts it off after that many. */
    serve(
      url: string,
      size: number,
      { status = 200, sendsOnly = null, contentType = 'audio/mpeg' }: { status?: number; sendsOnly?: number | null; contentType?: string } = {},
    ) {
      files.set(url, { size, status, sendsOnly, contentType })
    },
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    requested.push(url)
    const file = files.get(url)
    if (!file) throw new TypeError('fetch failed')
    if (file.status !== 200) return new Response('Not found', { status: file.status })
    const length = file.sendsOnly ?? file.size
    let at = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= length) {
          controller.close()
          return
        }
        const size = Math.min(host.chunkSize, length - at)
        controller.enqueue(byteRange(at, size))
        at += size
        host.sent += size
      },
    })
    return new Response(body, {
      headers: { 'Content-Length': String(file.size), 'Content-Type': file.contentType },
    })
  })
  return host
}

/** A run of stand-in audio bytes, cut from to make each chunk cheaply. */
let pattern = new Uint8Array(0)

/** Bytes `from`..`from + length` of a stand-in audio file, each different from its neighbours. */
export function byteRange(from: number, length: number) {
  if (pattern.length < length + 251) pattern = Uint8Array.from({ length: length + 251 }, (_, i) => i % 251)
  return pattern.slice(from % 251, (from % 251) + length)
}

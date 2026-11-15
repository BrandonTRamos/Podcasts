import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Device, Episode, ScreenHold } from './services'

/** Why a download stopped short, other than being interrupted. */
export type DownloadFailure =
  /** The publisher's host answered, but not with the file. */
  | 'unavailable'
  /** The device has no room left for it. */
  | 'noSpace'
  /** Anything else: storage misbehaved, or the host sent more than it said it would. */
  | 'other'

/** An episode's download, as this device knows it. */
export type DownloadState =
  | { status: 'none' }
  /** `bytes` are stored so far, of `total` if the host said how many there are. */
  | { status: 'downloading'; bytes: number; total: number | null }
  /** Stopped part way, with `bytes` stored, to resume from there. */
  | { status: 'interrupted'; bytes: number; total: number | null }
  /** The whole file is stored and its size checked. */
  | { status: 'downloaded' }
  /** The publisher's host doesn't let a web page download it directly. */
  | { status: 'blocked' }
  | { status: 'failed'; reason: DownloadFailure }

export type Downloadable = Pick<Episode, 'id' | 'enclosureUrl'>

/**
 * The download manager: stores episodes' files on this device, keyed by
 * episode, for the player to use in place of streaming. A file is written as
 * it arrives and never held whole in memory. A download that stops part way
 * keeps what it fetched and resumes from there with a range request; one
 * whose host can't send part of a file starts again. An episode counts as
 * downloaded only once its whole file is stored and its size matches what the
 * host said it would send.
 *
 * Which episodes are downloaded is this device's own state, read from its
 * files at launch.
 */
export interface DownloadManager {
  get(episodeId: string): DownloadState
  /**
   * A URL to play the episode's stored copy from, or null when it has none.
   * Answers at once, so the player can choose its source within the audio
   * element's `ended` event.
   */
  localCopy(episodeId: string): string | null
  /** Downloads the episode, or resumes its download. Does nothing if it is downloading or downloaded. */
  download(episode: Downloadable): void
  /**
   * While the app is open: keeps the screen on while downloads run, and
   * resumes those interrupted since launch when the app returns to the
   * foreground or the network comes back. Returns a function that stops it.
   */
  watchDevice(): () => void
  /** Calls the listener whenever a download's state changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /** Changes whenever a download's state does. */
  getVersion(): number
}

/**
 * The name of an episode's stored file. Episode IDs can hold characters a
 * file name can't, and dots are escaped too, so a partial file's name splits
 * unambiguously.
 */
const fileName = (episodeId: string) => encodeURIComponent(episodeId).replace(/\./g, '%2E')

/**
 * A part-downloaded file's name carries the size the host said the whole file
 * is, so a resume after a relaunch can tell that the file has changed since.
 */
const partialName = (episodeId: string, total: number | null) => `${fileName(episodeId)}.${total ?? 'unknown'}.part`

/** A part-downloaded file, read from its name. */
interface PartialFile {
  name: string
  episodeId: string
  total: number | null
}

function parsePartial(name: string): PartialFile | null {
  const match = /^([^.]+)\.(\d+|unknown)\.part$/.exec(name)
  const episodeId = match && decode(match[1])
  if (!match || episodeId === null) return null
  return { name, episodeId, total: match[2] === 'unknown' ? null : Number(match[2]) }
}

/** Progress is shown to the whole percent; when the size is unknown, to the megabyte. */
const UNKNOWN_SIZE_STEP = 1_000_000

/**
 * A download that receives nothing for this long counts as interrupted, so it
 * can be resumed: a connection can hang rather than fail, as after iOS
 * suspends the app.
 */
export const STALL_MS = 30_000

export function createDownloadManager(device: Device): DownloadManager {
  const states = new Map<string, DownloadState>()
  /** Playback URLs of stored copies, by episode. */
  const copies = new Map<string, string>()
  const running = new Set<string>()
  /** Interrupted since launch: resumed when the app is back in the foreground or online. */
  const interrupted = new Map<string, Downloadable>()
  const listeners = new Set<() => void>()
  let version = 0
  let askedToPersist = false
  let hold: ScreenHold | null = null
  /** Changes to the screen hold, one after another. */
  let holding = Promise.resolve()

  function set(episodeId: string, state: DownloadState) {
    states.set(episodeId, state)
    version++
    listeners.forEach((listener) => listener())
  }

  const scanned = scan()

  /** Learns what is stored already, from earlier launches. */
  async function scan() {
    let names: string[]
    try {
      names = await device.files.list()
    } catch {
      return
    }
    for (const name of names) {
      const partial = parsePartial(name)
      const episodeId = partial ? partial.episodeId : decode(name)
      if (episodeId === null || states.has(episodeId)) continue
      try {
        if (partial) {
          set(episodeId, { status: 'interrupted', bytes: (await device.files.size(name)) ?? 0, total: partial.total })
        } else {
          const url = await device.files.playbackUrl(name)
          if (url) {
            copies.set(episodeId, url)
            set(episodeId, { status: 'downloaded' })
          }
        }
      } catch {
        // Unreadable: it shows as not downloaded.
      }
    }
  }

  /** Holds the screen on while anything downloads, and lets it go once nothing does. */
  function syncScreenHold() {
    holding = holding.then(async () => {
      if (running.size > 0) {
        if (hold && !hold.released) return
        hold = await device.keepScreenOn().catch(() => null)
      } else if (hold) {
        const held = hold
        hold = null
        if (!held.released) await held.release().catch(() => {})
      }
    })
  }

  function download(episode: Downloadable) {
    const { id } = episode
    if (running.has(id) || copies.has(id)) return
    running.add(id)
    interrupted.delete(id)
    const before = states.get(id)
    const known = before?.status === 'interrupted' ? before : { bytes: 0, total: null }
    set(id, { status: 'downloading', bytes: known.bytes, total: known.total })
    syncScreenHold()
    if (!askedToPersist) {
      askedToPersist = true
      device.persistStorage().catch(() => false)
    }
    void transfer(episode)
      .catch((error: unknown): DownloadState => ({
        status: 'failed',
        reason: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'noSpace' : 'other',
      }))
      .then((outcome) => {
        running.delete(id)
        if (outcome.status === 'interrupted') interrupted.set(id, episode)
        set(id, outcome)
        syncScreenHold()
      })
  }

  /** Fetches what is missing of the episode's file into storage, and says how that ended. */
  async function transfer({ id, enclosureUrl }: Downloadable): Promise<DownloadState> {
    await scanned
    // Asked for before the launch scan had found it stored.
    if (copies.has(id) || (await adoptStoredCopy(id))) return { status: 'downloaded' }
    const existing = await findPartial(id)
    const stored = existing ? ((await device.files.size(existing.name)) ?? 0) : 0
    const knownTotal = existing?.total ?? null
    let response = await request(enclosureUrl, stored)
    // The host has no more to send, or its file is no longer the size it was:
    // what is stored doesn't match it, so start again.
    if (
      typeof response !== 'string' &&
      (response.status === 416 ||
        (response.status === 206 && knownTotal !== null && totalSize(response, stored) !== knownTotal))
    ) {
      void response.body?.cancel().catch(() => {})
      response = await request(enclosureUrl, 0)
    }
    if (response === 'blocked') return { status: 'blocked' }
    if (response === 'unreachable') return { status: 'interrupted', bytes: stored, total: knownTotal }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      return { status: 'failed', reason: 'unavailable' }
    }

    // A host that can't send part of a file sends all of it.
    const offset = response.status === 206 ? stored : 0
    const total = totalSize(response, offset)
    const partial = partialName(id, total)
    if (existing && existing.name !== partial) {
      if (offset === 0) await device.files.remove(existing.name)
      else await device.files.rename(existing.name, partial)
    }
    const file = await device.files.openForAppend(partial, { fresh: offset === 0 })
    let bytes = offset
    let shown = progressStep(bytes, total)
    set(id, { status: 'downloading', bytes, total })
    let cut = false
    let failed = false
    const reader = response.body?.getReader()
    try {
      while (reader) {
        const chunk = await readWithin(reader, STALL_MS)
        if (chunk === 'cut') {
          cut = true
          break
        }
        if (chunk.done) break
        // Taken first: writing may hand the chunk's buffer over and leave it empty.
        const length = chunk.value.length
        await file.write(chunk.value)
        bytes += length
        const step = progressStep(bytes, total)
        if (step !== shown) {
          shown = step
          set(id, { status: 'downloading', bytes, total })
        }
      }
    } catch (error) {
      failed = true
      void reader?.cancel().catch(() => {})
      throw error
    } finally {
      // After a failed write closing may fail too; the write's error is the one to report.
      if (failed) await file.close().catch(() => {})
      else await file.close()
    }

    // Check what actually reached storage, not what was sent to it.
    const size = (await device.files.size(partial)) ?? 0
    const expected = total ?? bytes
    if (cut || size < expected) return { status: 'interrupted', bytes: size, total }
    if (size > expected) {
      await device.files.remove(partial)
      return { status: 'failed', reason: 'other' }
    }
    await device.files.rename(partial, fileName(id))
    return (await adoptStoredCopy(id)) ? { status: 'downloaded' } : { status: 'failed', reason: 'other' }
  }

  /** The episode's part-downloaded file, if it has one. */
  async function findPartial(episodeId: string): Promise<PartialFile | null> {
    for (const name of await device.files.list()) {
      const partial = parsePartial(name)
      if (partial?.episodeId === episodeId) return partial
    }
    return null
  }

  /** Plays the episode's stored file from now on, if it has one. Says whether it does. */
  async function adoptStoredCopy(episodeId: string) {
    const url = await device.files.playbackUrl(fileName(episodeId))
    if (url) copies.set(episodeId, url)
    return url !== null
  }

  /**
   * Asks the host for the file from byte `from` on. When no answer can be
   * read, says whether the host is blocking the page (CORS) or can't be
   * reached at all.
   */
  async function request(url: string, from: number): Promise<Response | 'blocked' | 'unreachable'> {
    try {
      return await device.fetch(url, from > 0 ? { headers: { Range: `bytes=${from}-` } } : {})
    } catch {
      // Some browsers need the host's permission to send a Range header; ask for the whole file instead.
      if (from > 0) {
        try {
          return await device.fetch(url)
        } catch {
          // Tell why below.
        }
      }
    }
    return (await reachable(url)) ? 'blocked' : 'unreachable'
  }

  /** Whether the host answers at all, when the page doesn't need to read the answer. */
  async function reachable(url: string) {
    const abort = new AbortController()
    try {
      await device.fetch(url, { mode: 'no-cors', signal: abort.signal })
      return true
    } catch {
      return false
    } finally {
      abort.abort()
    }
  }

  return {
    get: (episodeId) => states.get(episodeId) ?? { status: 'none' },
    localCopy: (episodeId) => copies.get(episodeId) ?? null,
    download,

    watchDevice() {
      const resumeInterrupted = () => [...interrupted.values()].forEach(download)
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return
        // The system lets go of the screen whenever the app is hidden.
        syncScreenHold()
        resumeInterrupted()
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('online', resumeInterrupted)
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('online', resumeInterrupted)
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    getVersion: () => version,
  }
}

/** The whole file's size: from `Content-Range` where the page may read it, else from where this part starts and its length. */
function totalSize(response: Response, offset: number): number | null {
  const range = /\/(\d+)\s*$/.exec(response.headers.get('Content-Range') ?? '')
  if (range) return Number(range[1])
  const length = response.headers.get('Content-Length')
  return length !== null && /^\d+$/.test(length.trim()) ? offset + Number(length) : null
}

/** How much of the file is stored, to the whole percent, of a known size. */
export function percentOf(bytes: number, total: number) {
  return Math.floor((Math.min(bytes, total) / total) * 100)
}

function progressStep(bytes: number, total: number | null) {
  return total ? percentOf(bytes, total) : Math.floor(bytes / UNKNOWN_SIZE_STEP)
}

/** The next chunk, or 'cut' when the connection fails or nothing arrives within `ms`, which gives up on it. */
async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array> | 'cut'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stalled = new Promise<'cut'>((resolve) => {
    timer = setTimeout(() => resolve('cut'), ms)
  })
  try {
    const result = await Promise.race([reader.read().catch((): 'cut' => 'cut'), stalled])
    if (result === 'cut') void reader.cancel().catch(() => {})
    return result
  } finally {
    clearTimeout(timer)
  }
}

function decode(name: string): string | null {
  try {
    return decodeURIComponent(name)
  } catch {
    return null
  }
}

/** A download manager for this device, for the life of the calling component, re-rendering it as downloads change. */
export function useDownloads(device: Device): DownloadManager {
  const [downloads] = useState(() => createDownloadManager(device))
  useSyncExternalStore(downloads.subscribe, downloads.getVersion)
  useEffect(() => downloads.watchDevice(), [downloads])
  return downloads
}

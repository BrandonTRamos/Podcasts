import { useEffect, useState, useSyncExternalStore } from 'react'
import { readJson, writeJson } from './localCopy'
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
  /** The whole file, of `bytes`, is stored and its size checked. */
  | { status: 'downloaded'; bytes: number }
  /** It was downloaded, but its file has gone since: the OS cleared it, most likely to free space. */
  | { status: 'lost' }
  /** The publisher's host doesn't let a web page download it directly. */
  | { status: 'blocked' }
  | { status: 'failed'; reason: DownloadFailure }

/** An episode this device holds something of, or has lost the download of. */
export interface StoredDownload {
  episodeId: string
  /** The episode as it was when downloaded; null for a file stored before episodes were recorded with it. */
  episode: Episode | null
  state: Extract<DownloadState, { status: 'downloading' | 'interrupted' | 'downloaded' | 'lost' }>
}

/** Whether the device holds something of the download, or has lost it: what the downloads screen lists. */
export function isStored(state: DownloadState): state is StoredDownload['state'] {
  return (
    state.status === 'downloading' ||
    state.status === 'interrupted' ||
    state.status === 'downloaded' ||
    state.status === 'lost'
  )
}

/** How much room a download takes on the device. */
export function storedBytes(state: DownloadState): number {
  return isStored(state) && state.status !== 'lost' ? state.bytes : 0
}

/**
 * The download manager: stores episodes' files on this device, keyed by
 * episode, for the player to use in place of streaming. A file is written as
 * it arrives and never held whole in memory. A download that stops part way
 * keeps what it fetched and resumes from there with a range request; one
 * whose host can't send part of a file starts again. An episode counts as
 * downloaded only once its whole file is stored and its size matches what the
 * host said it would send.
 *
 * Which episodes are downloaded is this device's own state. Each download is
 * recorded, with its episode, apart from the files; at launch the records
 * are checked against the files, and a download whose file has gone counts
 * as lost until it is downloaded again or dismissed.
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
  download(episode: Episode): void
  /** Every episode this device holds something of, or has lost the download of, oldest download first. */
  list(): StoredDownload[]
  /**
   * Deletes what is stored of the episode, cancelling its download if it is
   * running, and forgets the download, lost or not. Resolves once done.
   */
  remove(episodeId: string): Promise<void>
  /** Removes the downloads of every episode of the podcast, as `remove` does. */
  removePodcast(podcastId: string): Promise<void>
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

/** Which episode a stored file, complete or not, belongs to; null for a name that isn't one of the app's. */
function episodeOf(name: string): string | null {
  return parsePartial(name)?.episodeId ?? decode(name)
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

/** Where each episode's download is recorded in device storage. */
const RECORD_PREFIX = 'download:'

/** A download as recorded: its episode, and whether its whole file was stored. */
interface DownloadRecord {
  episode: Episode
  downloaded: boolean
}

/** Whether a device storage key holds a download's record, which outlasts signing out as the file does. */
export const isDownloadRecord = (key: string) => key.startsWith(RECORD_PREFIX)

export function createDownloadManager(device: Device): DownloadManager {
  const { storage } = device
  /** Every episode's download other than those with none, in the order they were first known. */
  const states = new Map<string, DownloadState>()
  /** The episodes downloads are recorded for. */
  const episodes = new Map<string, Episode>()
  /** Playback URLs of stored copies, by episode. */
  const copies = new Map<string, string>()
  /** Downloads running, each with what cancels it, and what settles once it has stopped and tidied up. */
  const running = new Map<string, { abort: AbortController; settled: Promise<void> }>()
  /** Downloads being deleted, each with what settles once it is done. A download asked for meanwhile waits for it. */
  const removing = new Map<string, Promise<void>>()
  /** Interrupted since launch: resumed when the app is back in the foreground or online. */
  const interrupted = new Map<string, Episode>()
  const listeners = new Set<() => void>()
  let version = 0
  let askedToPersist = false
  let hold: ScreenHold | null = null
  /** Changes to the screen hold, one after another. */
  let holding = Promise.resolve()

  function set(episodeId: string, state: DownloadState) {
    if (state.status === 'none') states.delete(episodeId)
    else states.set(episodeId, state)
    version++
    listeners.forEach((listener) => listener())
  }

  /** Records the download, so the next launch can tell if its file has gone. */
  function record(episode: Episode, downloaded: boolean) {
    episodes.set(episode.id, episode)
    writeJson(storage, RECORD_PREFIX + episode.id, { episode, downloaded } satisfies DownloadRecord)
  }

  /** Forgets the download was ever made. */
  function forgetRecord(episodeId: string) {
    episodes.delete(episodeId)
    storage.remove(RECORD_PREFIX + episodeId)
  }

  // Read before anything can be downloaded, so the scan sees the records as earlier launches left them.
  const records = readRecords()
  for (const [episodeId, { episode }] of records) episodes.set(episodeId, episode)
  const scanned = scan()

  /** The downloads earlier launches recorded, by episode; any unreadable record is left out. */
  function readRecords() {
    const found = new Map<string, DownloadRecord>()
    for (const key of storage.keys()) {
      const stored = isDownloadRecord(key) ? readJson<DownloadRecord>(storage, key) : undefined
      if (stored?.episode) found.set(key.slice(RECORD_PREFIX.length), stored)
    }
    return found
  }

  /**
   * Learns what is stored already, from earlier launches, and checks every
   * recorded download against it: one whose file has gone is lost.
   */
  async function scan() {
    let names: string[]
    try {
      names = await device.files.list()
    } catch {
      return
    }
    /** Episodes with a file stored, readable or not. */
    const stored = new Set<string>()
    for (const name of names) {
      const partial = parsePartial(name)
      const episodeId = episodeOf(name)
      if (episodeId === null) continue
      stored.add(episodeId)
      if (states.has(episodeId)) continue
      try {
        if (partial) {
          set(episodeId, { status: 'interrupted', bytes: (await device.files.size(name)) ?? 0, total: partial.total })
        } else {
          const copy = await adoptStoredCopy(episodeId)
          if (copy) set(episodeId, copy)
        }
      } catch {
        // Unreadable: it shows as not downloaded.
      }
    }
    for (const [episodeId, { downloaded }] of records) {
      if (stored.has(episodeId) || states.has(episodeId)) continue
      if (downloaded) set(episodeId, { status: 'lost' })
      // Only part of it was ever stored, and that has gone: there is nothing to tell.
      else forgetRecord(episodeId)
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

  function download(episode: Episode) {
    const { id } = episode
    const deleting = removing.get(id)
    if (deleting) {
      void deleting.then(() => download(episode))
      return
    }
    if (running.has(id) || copies.has(id)) return
    const abort = new AbortController()
    interrupted.delete(id)
    const before = states.get(id)
    const known = before?.status === 'interrupted' ? before : { bytes: 0, total: null }
    record(episode, false)
    set(id, { status: 'downloading', bytes: known.bytes, total: known.total })
    if (!askedToPersist) {
      askedToPersist = true
      device.persistStorage().catch(() => false)
    }
    const settled = transfer(episode, abort.signal)
      .catch((error: unknown): DownloadState => ({
        status: 'failed',
        reason: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'noSpace' : 'other',
      }))
      .then(async (outcome) => {
        if (abort.signal.aborted) {
          await discard(id)
        } else {
          if (outcome.status === 'interrupted') interrupted.set(id, episode)
          if (outcome.status === 'downloaded') record(episode, true)
          set(id, outcome)
        }
        running.delete(id)
        syncScreenHold()
      })
    running.set(id, { abort, settled })
    syncScreenHold()
  }

  /**
   * Deletes every file stored for the episode and forgets its download. If a
   * file can't be deleted, what is left is found again as at launch.
   */
  async function discard(episodeId: string) {
    copies.delete(episodeId)
    interrupted.delete(episodeId)
    try {
      for (const name of await device.files.list()) {
        if (episodeOf(name) === episodeId) await device.files.remove(name)
      }
    } catch {
      const left = await storedState(episodeId)
      if (left) {
        set(episodeId, left)
        return
      }
    }
    forgetRecord(episodeId)
    set(episodeId, { status: 'none' })
  }

  /** What is stored of the episode, as far as can be told, or null for nothing. */
  async function storedState(episodeId: string): Promise<DownloadState | null> {
    try {
      const copy = await adoptStoredCopy(episodeId)
      if (copy) return copy
      const partial = await findPartial(episodeId)
      if (partial) {
        return { status: 'interrupted', bytes: (await device.files.size(partial.name)) ?? 0, total: partial.total }
      }
    } catch {
      // Unreadable: as good as gone.
    }
    return null
  }

  async function remove(episodeId: string) {
    const already = removing.get(episodeId)
    if (already) return already
    const run = running.get(episodeId)
    let deleted: Promise<void>
    if (run) {
      // Once stopped, it deletes what it stored.
      run.abort.abort()
      deleted = run.settled
    } else {
      deleted = scanned.then(() =>
        states.has(episodeId) || episodes.has(episodeId) ? discard(episodeId) : undefined,
      )
    }
    const done = deleted.finally(() => removing.delete(episodeId))
    removing.set(episodeId, done)
    // Anything resumed meanwhile would be deleted under it.
    interrupted.delete(episodeId)
    return done
  }

  /** Fetches what is missing of the episode's file into storage, and says how that ended. */
  async function transfer({ id, enclosureUrl }: Episode, signal: AbortSignal): Promise<DownloadState> {
    await scanned
    // Asked for before the launch scan had found it stored.
    const alreadyStored = await adoptStoredCopy(id)
    if (alreadyStored) return alreadyStored
    const existing = await findPartial(id)
    const stored = existing ? ((await device.files.size(existing.name)) ?? 0) : 0
    const knownTotal = existing?.total ?? null
    if (signal.aborted) return { status: 'none' }
    let response = await request(enclosureUrl, stored, signal)
    // The host has no more to send, or its file is no longer the size it was:
    // what is stored doesn't match it, so start again.
    if (
      typeof response !== 'string' &&
      (response.status === 416 ||
        (response.status === 206 && knownTotal !== null && totalSize(response, stored) !== knownTotal))
    ) {
      void response.body?.cancel().catch(() => {})
      response = await request(enclosureUrl, 0, signal)
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
        const chunk = await readWithin(reader, STALL_MS, signal)
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
    return (await adoptStoredCopy(id)) ?? { status: 'failed', reason: 'other' }
  }

  /** The episode's part-downloaded file, if it has one. */
  async function findPartial(episodeId: string): Promise<PartialFile | null> {
    for (const name of await device.files.list()) {
      const partial = parsePartial(name)
      if (partial?.episodeId === episodeId) return partial
    }
    return null
  }

  /** Plays the episode's stored file from now on, if it has one, and says it is downloaded; null if it has none. */
  async function adoptStoredCopy(episodeId: string): Promise<DownloadState | null> {
    const name = fileName(episodeId)
    const url = copies.get(episodeId) ?? (await device.files.playbackUrl(name))
    if (!url) return null
    copies.set(episodeId, url)
    return { status: 'downloaded', bytes: (await device.files.size(name)) ?? 0 }
  }

  /**
   * Asks the host for the file from byte `from` on. When no answer can be
   * read, says whether the host is blocking the page (CORS) or can't be
   * reached at all.
   */
  async function request(url: string, from: number, signal: AbortSignal): Promise<Response | 'blocked' | 'unreachable'> {
    try {
      return await device.fetch(url, from > 0 ? { headers: { Range: `bytes=${from}-` }, signal } : { signal })
    } catch {
      // Some browsers need the host's permission to send a Range header; ask for the whole file instead.
      if (from > 0 && !signal.aborted) {
        try {
          return await device.fetch(url, { signal })
        } catch {
          // Tell why below.
        }
      }
    }
    if (signal.aborted) return 'unreachable'
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
    remove,

    list: () =>
      [...states].flatMap(([episodeId, state]) =>
        isStored(state) ? [{ episodeId, episode: episodes.get(episodeId) ?? null, state }] : [],
      ),

    async removePodcast(podcastId) {
      await scanned
      const ids = [...episodes.values()].filter((episode) => episode.podcastId === podcastId).map(({ id }) => id)
      await Promise.all(ids.map(remove))
    },

    watchDevice() {
      const resumeInterrupted = () => [...interrupted.values()].forEach(download)
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') return
        // The system lets go of the screen whenever the app is hidden.
        syncScreenHold()
        resumeInterrupted()
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      const stopWatching = device.watchConnectivity(() => {
        if (device.isOnline()) resumeInterrupted()
      })
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        stopWatching()
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

/**
 * The next chunk, or 'cut' when the connection fails, nothing arrives within
 * `ms`, or the download is cancelled, which gives up on it.
 */
async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array> | 'cut'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<'cut'>((resolve) => {
    timer = setTimeout(() => resolve('cut'), ms)
    onAbort = () => resolve('cut')
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort)
  })
  try {
    const result = await Promise.race([reader.read().catch((): 'cut' => 'cut'), stopped])
    if (result === 'cut') void reader.cancel().catch(() => {})
    return result
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
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

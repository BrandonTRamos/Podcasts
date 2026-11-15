import type { DataApi, Device, DeviceStorage, Observer, QueueSnapshot } from './services'

/** Where the copy of each observed list is kept in device storage. */
const COPY_PREFIX = 'copy:'

/**
 * The data API, with a copy of what it last showed kept on this device so the
 * library renders with no network: the podcasts, each podcast's episodes once
 * opened, the latest episodes, listening state and the queue.
 *
 * Each observation shows the copy at once, if there is one, then what the
 * backend says, which replaces the copy. When the backend can't be reached
 * the copy stands, with no error, and the observation starts again by itself
 * once the device is back online, or the app returns to the foreground while
 * online (the browser can think it online when nothing is reachable). With no
 * copy, the error passes through as before, and the observation still starts
 * again later in the same way.
 *
 * Everything else, writes included, goes straight to the backend.
 */
export function withLocalCopy(data: DataApi, device: Pick<Device, 'storage' | 'isOnline' | 'watchConnectivity'>): DataApi {
  const { storage } = device

  function observeWithCopy<T>(
    key: string,
    observe: (observer: Observer<T>) => () => void,
    observer: Observer<T>,
    /** What of a value to keep: by default, all of it. */
    toCopy: (value: T) => T = (value) => value,
  ): () => void {
    const copy = readJson<T>(storage, COPY_PREFIX + key)
    let closed = false
    let delivered = false
    let stopLive: (() => void) | null = null
    let stopWaiting: (() => void) | null = null

    // A tick later, as a fresh observation would answer.
    if (copy !== undefined) {
      queueMicrotask(() => {
        if (closed || delivered) return
        delivered = true
        observer.next(copy)
      })
    }

    function startLive() {
      stopLive = observe({
        next(value) {
          if (closed) return
          delivered = true
          writeJson(storage, COPY_PREFIX + key, toCopy(value))
          observer.next(value)
        },
        error() {
          if (closed) return
          stopLive?.()
          stopLive = null
          if (!delivered && copy === undefined) observer.error()
          waitForNetwork()
        },
      })
    }

    function waitForNetwork() {
      stopWaiting?.()
      const retry = () => {
        if (closed || !device.isOnline() || document.visibilityState === 'hidden') return
        stopWaiting?.()
        stopWaiting = null
        startLive()
      }
      const stopWatching = device.watchConnectivity(retry)
      document.addEventListener('visibilitychange', retry)
      stopWaiting = () => {
        stopWatching()
        document.removeEventListener('visibilitychange', retry)
      }
    }

    startLive()
    return () => {
      closed = true
      stopLive?.()
      stopWaiting?.()
    }
  }

  return {
    ...data,
    observePodcasts: (observer) => observeWithCopy('podcasts', data.observePodcasts, observer),
    observeEpisodes: (podcastId, observer) =>
      observeWithCopy(`episodes:${podcastId}`, (o) => data.observeEpisodes(podcastId, o), observer),
    observeLatestEpisodes: (observer) => observeWithCopy('latest', data.observeLatestEpisodes, observer),
    observeEpisodeStates: (podcastId, observer) =>
      observeWithCopy(`states:${podcastId}`, (o) => data.observeEpisodeStates(podcastId, o), observer),
    observeQueue: (observer) => observeWithCopy('queue', data.observeQueue, observer, copyOfQueue),
  }
}

/**
 * A queue snapshot as kept. It may be shown long after it was taken, so it
 * claims to take account only of the saves it shows: none later. An episode
 * that left the queue before them is still known to have left.
 */
function copyOfQueue(snapshot: QueueSnapshot): QueueSnapshot {
  let asOf = snapshot.asOf ?? new Date(0).toISOString()
  for (const { state } of snapshot.entries) if (Date.parse(state.updatedAt) > Date.parse(asOf)) asOf = state.updatedAt
  return { entries: snapshot.entries, asOf }
}

/**
 * Forgets everything this device keeps of the library, changes not yet
 * synced included, as signing out does: every record but those `keep` picks.
 */
export function forgetLibrary(storage: DeviceStorage, keep: (key: string) => boolean) {
  for (const key of storage.keys()) if (!keep(key)) storage.remove(key)
}

export function readJson<T>(storage: DeviceStorage, key: string): T | undefined {
  try {
    const stored = storage.get(key)
    return stored === null ? undefined : (JSON.parse(stored) as T)
  } catch {
    return undefined
  }
}

/** Stores the value, if there is room: without it, the copy is just older. */
export function writeJson(storage: DeviceStorage, key: string, value: unknown) {
  try {
    storage.set(key, JSON.stringify(value))
  } catch {
    // Out of space, or storage is unavailable.
  }
}

import { useEffect, useSyncExternalStore } from 'react'
import type { DataApi, EpisodeState, EpisodeStateChange, SavedEpisodeState } from './services'

export type ListeningStatus = 'loading' | 'loaded' | 'failed'

/**
 * Where an episode should open: the saved position if it is part-played,
 * otherwise the beginning (a played episode starts over). Null if it has no
 * position to resume from.
 */
export function resumePosition(state: EpisodeState | undefined): number | null {
  return state && !state.played ? state.positionSeconds : null
}

/**
 * This device's copy of the listener's place in each episode and what they
 * have played. Changes made here show at once and are saved in the
 * background; saves from other devices arrive through the data API. Each save
 * changes only the fields it names, and of two saves the later wins.
 */
export interface ListeningStore {
  /** The episode's state as this device knows it, or undefined if it has never been played. */
  get(episodeId: string): EpisodeState | undefined
  /** Changes these fields of the episode's state here at once, and saves them. */
  update(episodeId: string, podcastId: string, change: EpisodeStateChange): void
  /** Keeps one podcast's episode states current. Returns a function that stops watching. */
  watch(podcastId: string): () => void
  /** Whether a watched podcast's states have arrived. */
  status(podcastId: string): ListeningStatus
  /** Fetches every watched podcast's states afresh, catching saves whose live update was missed. */
  refresh(): void
  /** Calls the listener whenever anything in the store changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /** Changes whenever anything in the store does. */
  getVersion(): number
}

/** A change made on this device that the backend does not have yet. */
interface LocalChange {
  write: number
  podcastId: string
  change: EpisodeStateChange
  /** Its save failed. It stays until a later save from anywhere replaces it. */
  failed: boolean
}

export function createListeningStore(data: Pick<DataApi, 'observeEpisodeStates' | 'saveEpisodeState'>): ListeningStore {
  /** As last saved, by any device. */
  const saved = new Map<string, SavedEpisodeState>()
  /** Changes made here, oldest first, laid over what was saved. */
  const local = new Map<string, LocalChange[]>()
  const watches = new Map<string, { watchers: number; status: ListeningStatus; stop: () => void }>()
  const listeners = new Set<() => void>()
  let version = 0
  let writes = 0

  function changed() {
    version++
    listeners.forEach((listener) => listener())
  }

  /** Keeps whichever of the two saves is later. A later one also replaces changes here whose save failed. */
  function keepLatest(state: SavedEpisodeState) {
    const current = saved.get(state.episodeId)
    const time = Date.parse(state.updatedAt)
    if (current && Date.parse(current.updatedAt) > time) return
    if (!current || time > Date.parse(current.updatedAt)) {
      const unsaved = local.get(state.episodeId)?.filter((change) => !change.failed)
      if (unsaved?.length) local.set(state.episodeId, unsaved)
      else local.delete(state.episodeId)
    }
    saved.set(state.episodeId, state)
  }

  function observe(podcastId: string) {
    return data.observeEpisodeStates(podcastId, {
      next(states) {
        states.forEach(keepLatest)
        const watch = watches.get(podcastId)
        if (watch) watch.status = 'loaded'
        changed()
      },
      error() {
        const watch = watches.get(podcastId)
        if (watch && watch.status === 'loading') watch.status = 'failed'
        changed()
      },
    })
  }

  function get(episodeId: string): EpisodeState | undefined {
    const base = saved.get(episodeId)
    const changes = local.get(episodeId)
    if (!base && !changes) return undefined
    let state: EpisodeState = base
      ? { episodeId, podcastId: base.podcastId, positionSeconds: base.positionSeconds, played: base.played }
      : { episodeId, podcastId: changes![0].podcastId, positionSeconds: 0, played: false }
    for (const { change } of changes ?? []) state = { ...state, ...change }
    return state
  }

  return {
    get,

    update(episodeId, podcastId, change) {
      const entry: LocalChange = { write: ++writes, podcastId, change, failed: false }
      local.set(episodeId, [...(local.get(episodeId) ?? []), entry])
      changed()
      data.saveEpisodeState(episodeId, podcastId, change).then(
        (result) => {
          const rest = local.get(episodeId)?.filter((other) => other !== entry)
          if (rest?.length) local.set(episodeId, rest)
          else local.delete(episodeId)
          keepLatest(result)
          changed()
        },
        () => {
          entry.failed = true
        },
      )
    },

    watch(podcastId) {
      const existing = watches.get(podcastId)
      if (existing) existing.watchers++
      else {
        const watch = { watchers: 1, status: 'loading' as ListeningStatus, stop: () => {} }
        watches.set(podcastId, watch)
        watch.stop = observe(podcastId)
      }
      let stopped = false
      return () => {
        const watch = watches.get(podcastId)
        if (stopped || !watch) return
        stopped = true
        if (--watch.watchers === 0) {
          watch.stop()
          watches.delete(podcastId)
        }
      }
    },

    status: (podcastId) => watches.get(podcastId)?.status ?? 'loading',

    refresh() {
      for (const [podcastId, watch] of watches) {
        watch.stop()
        watch.stop = observe(podcastId)
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    getVersion: () => version,
  }
}

/** Keeps a podcast's episode states current while the calling component is mounted, and re-renders it when they change. */
export function useEpisodeStates(store: ListeningStore, podcastId: string | null): ListeningStatus {
  useSyncExternalStore(store.subscribe, store.getVersion)
  useEffect(() => (podcastId === null ? undefined : store.watch(podcastId)), [store, podcastId])
  return podcastId === null ? 'loading' : store.status(podcastId)
}

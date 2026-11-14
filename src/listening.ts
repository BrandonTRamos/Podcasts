import { useEffect, useSyncExternalStore } from 'react'
import type { DataApi, Episode, EpisodeState, EpisodeStateChange, SavedEpisodeState } from './services'

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
 * This device's copy of the listener's place in each episode, what they have
 * played, and the queue. Changes made here show at once and are saved in the
 * background; saves from other devices arrive through the data API. Each save
 * changes only the fields it names, and of two saves the later wins.
 *
 * The queue is the episodes whose state has a queue order, lowest first.
 * Editing it never waits on the network, so the player can take the next
 * episode from it while the app is in the background.
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
  /** Fetches every watched podcast's states, and the queue, afresh, catching saves whose live update was missed. */
  refresh(): void
  /** Keeps the queue current, whatever podcasts it holds. Returns a function that stops watching. */
  watchQueue(): () => void
  /** Whether the watched queue has arrived. */
  queueStatus(): ListeningStatus
  /** The queued episodes, in the order they will play. */
  queue(): Episode[]
  /** Queues the episode last, or first to play next. One already queued moves there. */
  enqueue(episode: Episode, where: 'last' | 'next'): void
  /** Moves a queued episode to this place in the queue, counting from 0. */
  moveInQueue(episodeId: string, index: number): void
  /** Takes the episode off the queue, if it is on it. */
  dequeue(episodeId: string): void
  /** Takes the first episode off the queue and returns it, or null if the queue is empty. Never waits on the network. */
  takeNext(): Episode | null
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

export function createListeningStore(
  data: Pick<DataApi, 'observeEpisodeStates' | 'saveEpisodeState' | 'observeQueue'>,
): ListeningStore {
  /** As last saved, by any device. */
  const saved = new Map<string, SavedEpisodeState>()
  /** Changes made here, oldest first, laid over what was saved. */
  const local = new Map<string, LocalChange[]>()
  const watches = new Map<string, { watchers: number; status: ListeningStatus; stop: () => void }>()
  /** Details of every episode that has been queued, here or elsewhere, to show and play it. */
  const episodes = new Map<string, Episode>()
  const queueWatch = { watchers: 0, status: 'loading' as ListeningStatus, stop: () => {} }
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

  function observeQueue() {
    return data.observeQueue({
      next(entries) {
        // Each delivery is the whole queue, so one queued as last saved but
        // missing from it has since left. When is unknown, so its time stays.
        const queued = new Set(entries.map(({ episode }) => episode.id))
        for (const [episodeId, state] of saved) {
          if (state.queueOrder !== null && !queued.has(episodeId)) saved.set(episodeId, { ...state, queueOrder: null })
        }
        for (const { episode, state } of entries) {
          episodes.set(episode.id, episode)
          keepLatest(state)
        }
        queueWatch.status = 'loaded'
        changed()
      },
      error() {
        if (queueWatch.status === 'loading') queueWatch.status = 'failed'
        changed()
      },
    })
  }

  function get(episodeId: string): EpisodeState | undefined {
    const base = saved.get(episodeId)
    const changes = local.get(episodeId)
    if (!base && !changes) return undefined
    const { podcastId, positionSeconds, played, queueOrder } = base ?? {
      podcastId: changes![0].podcastId,
      positionSeconds: 0,
      played: false,
      queueOrder: null,
    }
    let state: EpisodeState = { episodeId, podcastId, positionSeconds, played, queueOrder }
    for (const { change } of changes ?? []) state = { ...state, ...change }
    return state
  }

  function update(episodeId: string, podcastId: string, change: EpisodeStateChange) {
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
  }

  /** Queued episodes with their places, in order. */
  function queued(): { episode: Episode; order: number }[] {
    const entries: { episode: Episode; order: number }[] = []
    for (const episodeId of new Set([...saved.keys(), ...local.keys()])) {
      const order = get(episodeId)?.queueOrder
      const episode = episodes.get(episodeId)
      if (order !== null && order !== undefined && episode) entries.push({ episode, order })
    }
    return entries.sort((a, b) => a.order - b.order || a.episode.id.localeCompare(b.episode.id))
  }

  function placeInQueue(episode: Episode, order: number) {
    episodes.set(episode.id, episode)
    update(episode.id, episode.podcastId, { queueOrder: order })
  }

  /** Puts the episode at this index among the others, numbering the whole queue afresh if there is no room between its neighbours. */
  function moveTo(episode: Episode, index: number) {
    const others = queued().filter((entry) => entry.episode.id !== episode.id)
    const at = Math.min(Math.max(index, 0), others.length)
    const before = others[at - 1]?.order
    const after = others[at]?.order
    const order =
      before === undefined ? (after === undefined ? 1 : after - 1) : after === undefined ? before + 1 : (before + after) / 2
    if (order !== before && order !== after) {
      placeInQueue(episode, order)
      return
    }
    const renumbered = others.map((entry) => entry.episode)
    renumbered.splice(at, 0, episode)
    renumbered.forEach((each, i) => placeInQueue(each, i + 1))
  }

  function dequeue(episodeId: string) {
    const state = get(episodeId)
    if (state && state.queueOrder !== null) update(episodeId, state.podcastId, { queueOrder: null })
  }

  return {
    get,
    update,

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
      if (queueWatch.watchers > 0) {
        queueWatch.stop()
        queueWatch.stop = observeQueue()
      }
    },

    watchQueue() {
      if (queueWatch.watchers++ === 0) {
        queueWatch.status = 'loading'
        queueWatch.stop = observeQueue()
      }
      let stopped = false
      return () => {
        if (stopped) return
        stopped = true
        if (--queueWatch.watchers === 0) queueWatch.stop()
      }
    },

    queueStatus: () => queueWatch.status,
    queue: () => queued().map(({ episode }) => episode),

    enqueue(episode, where) {
      moveTo(episode, where === 'next' ? 0 : Infinity)
    },

    moveInQueue(episodeId, index) {
      const episode = episodes.get(episodeId)
      if (episode && get(episodeId)?.queueOrder != null) moveTo(episode, index)
    },

    dequeue,

    takeNext() {
      const next = queued()[0]?.episode ?? null
      if (next) dequeue(next.id)
      return next
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

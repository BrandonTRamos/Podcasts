import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AudioElement } from './services'

export const SKIP_BACK_SECONDS = 15
export const SKIP_FORWARD_SECONDS = 30
/** While playing, the position is saved no more often than this. Each save is a write to the backend. */
export const SAVE_INTERVAL_MS = 60_000

/** What the player needs to play an episode and show what is playing. */
export interface PlayableEpisode {
  id: string
  podcastId: string
  title: string
  /** Streamed straight from the publisher's host. */
  enclosureUrl: string
  /** From the feed; stands in until the file says how long it is. */
  durationSeconds: number | null
  podcastTitle: string | null
  artworkUrl: string | null
}

export interface LoadedState {
  episode: PlayableEpisode
  playing: boolean
  /** Seconds from the start. */
  position: number
  /** Seconds: the file's own length once known, the feed's until then, null if neither says. */
  duration: number | null
  /** The publisher's file failed to load, or stopped loading part way. */
  failed: boolean
}

export type PlayerState = { episode: null } | LoadedState

/** Where the listener has got to in an episode; `played` is set once it reaches the end. */
export type Progress = { positionSeconds: number; played?: true }

/** Where the player keeps the listener's place. */
export type SaveProgress = (episode: PlayableEpisode, progress: Progress) => void

/**
 * The player engine: plays one episode at a time through a plain audio
 * element and reports what it is doing. The element's own events are the
 * source of truth for playing, position and length.
 *
 * It saves the position on pause, at the end (marking the episode played),
 * when another episode replaces it, when told the app is going to the
 * background, and while playing at most once every `SAVE_INTERVAL_MS`.
 */
export interface Player {
  getState(): PlayerState
  /** Calls the listener whenever the state changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /**
   * Streams this episode from `startAt` seconds (the start by default),
   * replacing whatever was loaded. The episode already loaded carries on from
   * where it is, unless it failed.
   */
  play(episode: PlayableEpisode, startAt?: number): void
  resume(): void
  pause(): void
  seekTo(seconds: number): void
  skipBack(): void
  skipForward(): void
  /** Saves the position now, if it has moved since it was last saved: the app is going to the background. */
  savePosition(): void
  /**
   * A position for this episode was saved elsewhere (another device). If it is
   * the episode loaded, it is paused, and the position differs from what this
   * player last saved, moves there so that playing on carries on from it.
   */
  adoptSavedPosition(episodeId: string, seconds: number): void
  /** Pauses, unloads the file and forgets the episode. */
  stop(): void
}

export function createPlayer(audio: AudioElement, saveProgress: SaveProgress): Player {
  let state: PlayerState = { episode: null }
  const listeners = new Set<() => void>()
  /** Bumped whenever a new file loads or the player stops, so a late answer about an earlier one is ignored. */
  let loadCount = 0
  /** The loaded episode's position as this player last saved it, or as it was opened at. */
  let savedPosition = 0
  let lastSaveAt = 0
  /** Where the loaded file should start, until its metadata has loaded or the listener seeks. */
  let pendingStart: number | null = null

  function set(next: PlayerState) {
    state = next
    listeners.forEach((listener) => listener())
  }

  function update(patch: Partial<Omit<LoadedState, 'episode'>>) {
    if (state.episode) set({ ...state, ...patch })
  }

  const fileDuration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null)

  /** Where the file is, or where it is about to start if the browser has not applied that seek yet. */
  const currentPosition = () => (pendingStart !== null && audio.currentTime === 0 ? pendingStart : audio.currentTime)

  function save(progress: Progress = { positionSeconds: currentPosition() }) {
    if (!state.episode || state.failed) return
    if (!progress.played && progress.positionSeconds === savedPosition) return
    savedPosition = progress.positionSeconds
    lastSaveAt = Date.now()
    saveProgress(state.episode, progress)
  }

  const handlers: Record<string, () => void> = {
    play: () => update({ playing: true }),
    pause: () => {
      update({ playing: false })
      // Reaching the end pauses first; `ended` saves that.
      if (!audio.ended) save()
    },
    ended: () => save({ positionSeconds: audio.currentTime, played: true }),
    timeupdate: () => {
      update({ position: audio.currentTime })
      if (state.episode && !audio.paused && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) save()
    },
    durationchange: () => {
      if (state.episode) update({ duration: fileDuration() ?? state.episode.durationSeconds })
    },
    // Some browsers ignore a seek made before the file's metadata has loaded.
    loadedmetadata: () => {
      if (pendingStart === null) return
      const start = pendingStart
      pendingStart = null
      if (audio.currentTime !== start) audio.currentTime = start
    },
    // A failed load leaves `paused` false, so the element's word on playing can't be trusted after it.
    error: () => update({ playing: false, failed: true }),
  }

  function attemptPlay() {
    const load = loadCount
    const started = audio.play()
    update({ playing: !audio.paused })
    started.catch(() => {
      // Refused (no user gesture) or aborted: show what the element is actually doing.
      if (load === loadCount && state.episode && !state.failed) update({ playing: !audio.paused })
    })
  }

  function seekTo(seconds: number) {
    if (!state.episode) return
    pendingStart = null
    // Only the file's own length bounds a seek: the feed's can be wrong.
    const position = Math.min(Math.max(seconds, 0), fileDuration() ?? Infinity)
    audio.currentTime = position
    update({ position })
  }

  return {
    getState: () => state,

    subscribe(listener) {
      if (listeners.size === 0) {
        for (const [type, handler] of Object.entries(handlers)) audio.addEventListener(type, handler)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          for (const [type, handler] of Object.entries(handlers)) audio.removeEventListener(type, handler)
        }
      }
    },

    play(episode, startAt = 0) {
      if (state.episode && state.episode.id === episode.id && !state.failed) {
        attemptPlay()
        return
      }
      // The element is about to be reused, so take its position for the episode it holds now.
      save()
      loadCount++
      const start = Math.max(startAt, 0)
      set({ episode, playing: false, position: start, duration: episode.durationSeconds, failed: false })
      savedPosition = start
      lastSaveAt = Date.now()
      audio.src = episode.enclosureUrl
      if (start > 0) {
        pendingStart = start
        audio.currentTime = start
      } else {
        pendingStart = null
      }
      // Called straight from the tap, as iOS only lets a user gesture start audio.
      attemptPlay()
    },

    resume() {
      if (state.episode && !state.failed) attemptPlay()
    },

    pause() {
      audio.pause()
      update({ playing: !audio.paused })
    },

    seekTo,
    skipBack() {
      if (state.episode) seekTo(state.position - SKIP_BACK_SECONDS)
    },
    skipForward() {
      if (state.episode) seekTo(state.position + SKIP_FORWARD_SECONDS)
    },

    savePosition: () => save(),

    adoptSavedPosition(episodeId, seconds) {
      if (!state.episode || state.episode.id !== episodeId || state.playing || state.failed) return
      if (seconds === savedPosition) return
      seekTo(seconds)
      savedPosition = seconds
    },

    stop() {
      loadCount++
      pendingStart = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      set({ episode: null })
    },
  }
}

/**
 * A player for this audio element, for the life of the calling component. It
 * saves the position whenever the app goes to the background. `saveProgress`
 * is taken once, when the player is made, so later values are ignored.
 */
export function usePlayer(audio: AudioElement, saveProgress: SaveProgress): { player: Player; state: PlayerState } {
  // The engine attaches to the element only while subscribed, so a discarded
  // instance (React may call the initialiser twice) leaves nothing behind.
  const [player] = useState(() => createPlayer(audio, saveProgress))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  useEffect(() => () => player.stop(), [player])
  useEffect(() => {
    const saveIfHidden = () => {
      if (document.visibilityState === 'hidden') player.savePosition()
    }
    document.addEventListener('visibilitychange', saveIfHidden)
    window.addEventListener('pagehide', player.savePosition)
    return () => {
      document.removeEventListener('visibilitychange', saveIfHidden)
      window.removeEventListener('pagehide', player.savePosition)
    }
  }, [player])
  return { player, state }
}

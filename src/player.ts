import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AudioElement } from './services'

export const SKIP_BACK_SECONDS = 15
export const SKIP_FORWARD_SECONDS = 30

/** What the player needs to play an episode and show what is playing. */
export interface PlayableEpisode {
  id: string
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

/**
 * The player engine: plays one episode at a time through a plain audio
 * element and reports what it is doing. The element's own events are the
 * source of truth for playing, position and length.
 */
export interface Player {
  getState(): PlayerState
  /** Calls the listener whenever the state changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /**
   * Streams this episode from the start, replacing whatever was loaded. The
   * episode already loaded carries on from where it is, unless it failed.
   */
  play(episode: PlayableEpisode): void
  resume(): void
  pause(): void
  seekTo(seconds: number): void
  skipBack(): void
  skipForward(): void
  /** Pauses, unloads the file and forgets the episode. */
  stop(): void
}

export function createPlayer(audio: AudioElement): Player {
  let state: PlayerState = { episode: null }
  const listeners = new Set<() => void>()
  /** Bumped whenever a new file loads or the player stops, so a late answer about an earlier one is ignored. */
  let loadCount = 0

  function set(next: PlayerState) {
    state = next
    listeners.forEach((listener) => listener())
  }

  function update(patch: Partial<Omit<LoadedState, 'episode'>>) {
    if (state.episode) set({ ...state, ...patch })
  }

  const fileDuration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null)

  const handlers: Record<string, () => void> = {
    play: () => update({ playing: true }),
    pause: () => update({ playing: false }),
    timeupdate: () => update({ position: audio.currentTime }),
    durationchange: () => {
      if (state.episode) update({ duration: fileDuration() ?? state.episode.durationSeconds })
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

    play(episode) {
      if (state.episode && state.episode.id === episode.id && !state.failed) {
        attemptPlay()
        return
      }
      loadCount++
      set({ episode, playing: false, position: 0, duration: episode.durationSeconds, failed: false })
      audio.src = episode.enclosureUrl
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

    stop() {
      loadCount++
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      set({ episode: null })
    },
  }
}

/** A player for this audio element, for the life of the calling component. */
export function usePlayer(audio: AudioElement): { player: Player; state: PlayerState } {
  // The engine attaches to the element only while subscribed, so a discarded
  // instance (React may call the initialiser twice) leaves nothing behind.
  const [player] = useState(() => createPlayer(audio))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  useEffect(() => () => player.stop(), [player])
  return { player, state }
}

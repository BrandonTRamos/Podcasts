import { useEffect, useState, useSyncExternalStore } from 'react'
import { connectMediaSession, offerNextTrack } from './mediaSession'
import type { AudioElement, MediaSessionControls } from './services'

/** How far each skip moves until the listener picks otherwise. */
export const DEFAULT_SKIP: SkipSeconds = { back: 15, forward: 30 }
/** The amounts a skip can be set to, in seconds. */
export const SKIP_CHOICES = [5, 10, 15, 30, 45, 60, 90] as const

/** How many seconds each skip button moves by. */
export interface SkipSeconds {
  back: number
  forward: number
}

export type SkipDirection = keyof SkipSeconds
/** While playing, the position is saved no more often than this. Each save is a write to the backend. */
export const SAVE_INTERVAL_MS = 60_000
/** The range of playback speeds the listener can slide between; 1 is normal speed. */
export const MIN_SPEED = 0.5
export const MAX_SPEED = 3
/** Speeds move in steps of 0.05. */
export const SPEED_STEP = 0.05
const STEPS_PER_UNIT = 20

/** The nearest speed on the slider's steps, within its range. Dividing a whole number of steps keeps 1.15 from becoming 1.1500000000000001. */
export function toSpeedStep(speed: number): number {
  const snapped = Math.round(speed * STEPS_PER_UNIT) / STEPS_PER_UNIT
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, snapped))
}

/** What the player needs to play an episode and show what is playing. */
export interface PlayableEpisode {
  id: string
  podcastId: string
  title: string
  /** On the publisher's host. Streamed from there when there is no stored copy. */
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
  /** The playback rate: 1 is normal speed. */
  speed: number
  skip: SkipSeconds
}

/** The speed and skips are the listener's choice for every episode, so they stay when none is loaded. */
export type PlayerState = { episode: null; speed: number; skip: SkipSeconds } | LoadedState

/** Where the listener has got to in an episode; `played` is set once it reaches the end. */
export type Progress = { positionSeconds: number; played?: true }

/** Where the player keeps the listener's place. */
export type SaveProgress = (episode: PlayableEpisode, progress: Progress) => void

/**
 * Takes the next episode off the queue, with where to start it, or returns
 * null if nothing is queued. Called from the audio element's `ended` event,
 * so it must answer at once: iOS throttles scripts while the screen is
 * locked, and awaiting anything there can stall the queue.
 */
export type TakeNext = () => { episode: PlayableEpisode; startAt: number } | null

/**
 * A URL to play the episode's copy stored on this device from, or null when
 * it has none. Must answer at once, for the same reason as `TakeNext`.
 */
export type LocalCopyOf = (episodeId: string) => string | null

/**
 * The player engine: plays one episode at a time through a plain audio
 * element and reports what it is doing. It plays the episode's stored copy
 * when there is one, and streams it from the publisher otherwise. The element's own events are the
 * source of truth for playing, position and length.
 *
 * It saves the position on pause, at the end (marking the episode played),
 * when another episode replaces it, when told the app is going to the
 * background, and while playing at most once every `SAVE_INTERVAL_MS`.
 *
 * When an episode plays to the end, it takes the next from the queue and
 * plays that, setting its source within the `ended` event itself.
 */
export interface Player {
  getState(): PlayerState
  /** Calls the listener whenever the state changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void
  /**
   * Plays this episode from `startAt` seconds (the start by default),
   * replacing whatever was loaded. The episode already loaded carries on from
   * where it is, unless it failed.
   */
  play(episode: PlayableEpisode, startAt?: number): void
  /**
   * Shows this episode as loaded, paused at `startAt` seconds, without
   * loading its file: that waits until it is played, so it then comes from
   * the stored copy if one has turned up since. Seeking moves where it will
   * start. Does nothing if an episode is already loaded.
   */
  cue(episode: PlayableEpisode, startAt: number): void
  resume(): void
  pause(): void
  seekTo(seconds: number): void
  skipBack(): void
  skipForward(): void
  /** Moves on to the next queued episode, keeping the place in this one. Does nothing if none is queued. */
  skipToNext(): void
  /** Plays this and every later episode at this speed (1 is normal), starting now. Snapped to the slider's steps and range. */
  setSpeed(speed: number): void
  /** Makes this skip move by this many seconds from now on. Ignores anything that is not a whole, positive number. */
  setSkip(direction: SkipDirection, seconds: number): void
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

export function createPlayer(
  audio: AudioElement,
  saveProgress: SaveProgress,
  initialSpeed: number,
  takeNext: TakeNext,
  localCopyOf: LocalCopyOf,
  initialSkip: SkipSeconds = DEFAULT_SKIP,
): Player {
  let state: PlayerState = { episode: null, speed: initialSpeed, skip: initialSkip }
  const listeners = new Set<() => void>()
  /** Bumped whenever a new file loads or the player stops, so a late answer about an earlier one is ignored. */
  let loadCount = 0
  /** The loaded episode's position as this player last saved it, or as it was opened at. */
  let savedPosition = 0
  let lastSaveAt = 0
  /** Where the loaded file should start, until its metadata has loaded or the listener seeks. */
  let pendingStart: number | null = null
  /** The loaded episode was cued, and its file has not loaded: the element holds nothing yet. */
  let cued = false

  function set(next: PlayerState) {
    state = next
    listeners.forEach((listener) => listener())
  }

  function update(patch: Partial<Omit<LoadedState, 'episode'>>) {
    if (state.episode) set({ ...state, ...patch })
  }

  /**
   * A new load returns the element to its default rate, and some browsers
   * (older iOS) reset it on loading or playing too, so this is applied again then.
   */
  function applySpeed() {
    audio.defaultPlaybackRate = state.speed
    if (audio.playbackRate !== state.speed) audio.playbackRate = state.speed
  }

  const fileDuration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null)

  /** Where the file is, or where it is about to start if the browser has not applied that seek yet. */
  function currentPosition() {
    if (cued && state.episode) return state.position
    return pendingStart !== null && audio.currentTime === 0 ? pendingStart : audio.currentTime
  }

  function save(progress: Progress = { positionSeconds: currentPosition() }) {
    if (!state.episode || state.failed) return
    if (!progress.played && progress.positionSeconds === savedPosition) return
    savedPosition = progress.positionSeconds
    lastSaveAt = Date.now()
    saveProgress(state.episode, progress)
  }

  const handlers: Record<string, () => void> = {
    play: () => {
      applySpeed()
      update({ playing: true })
    },
    pause: () => {
      update({ playing: false })
      // Reaching the end pauses first; `ended` saves that.
      if (!audio.ended) save()
    },
    ended: () => {
      save({ positionSeconds: audio.currentTime, played: true })
      // Straight away, with nothing awaited: see `TakeNext`.
      const next = takeNextOther()
      if (next) load(next.episode, next.startAt)
    },
    timeupdate: () => {
      update({ position: audio.currentTime })
      if (state.episode && !audio.paused && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) save()
    },
    durationchange: () => {
      if (state.episode) update({ duration: fileDuration() ?? state.episode.durationSeconds })
    },
    // Some browsers ignore a seek made before the file's metadata has loaded.
    loadedmetadata: () => {
      applySpeed()
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

  /** The next queued episode other than the one loaded, which, if queued too, leaves the queue. */
  function takeNextOther() {
    let next = takeNext()
    while (next && next.episode.id === state.episode?.id) next = takeNext()
    return next
  }

  /** Loads the episode in place of whatever is loaded, and starts it. */
  function load(episode: PlayableEpisode, startAt: number) {
    loadCount++
    cued = false
    const start = Math.max(startAt, 0)
    const duration = episode.durationSeconds
    set({ episode, playing: false, position: start, duration, failed: false, speed: state.speed, skip: state.skip })
    savedPosition = start
    lastSaveAt = Date.now()
    audio.src = localCopyOf(episode.id) ?? episode.enclosureUrl
    applySpeed()
    if (start > 0) {
      pendingStart = start
      audio.currentTime = start
    } else {
      pendingStart = null
    }
    attemptPlay()
  }

  function play(episode: PlayableEpisode, startAt = 0) {
    if (cued && state.episode && state.episode.id === episode.id) {
      load(episode, state.position)
      return
    }
    if (state.episode && state.episode.id === episode.id && !state.failed) {
      attemptPlay()
      return
    }
    // The element is about to be reused, so take its position for the episode it holds now.
    save()
    // Called straight from the tap, as iOS only lets a user gesture start audio.
    load(episode, startAt)
  }

  function seekTo(seconds: number) {
    if (!state.episode) return
    if (cued) {
      update({ position: Math.max(seconds, 0) })
      return
    }
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

    play,

    cue(episode, startAt) {
      if (state.episode) return
      cued = true
      const position = Math.max(startAt, 0)
      set({ episode, playing: false, position, duration: episode.durationSeconds, failed: false, speed: state.speed, skip: state.skip })
      savedPosition = position
    },

    resume() {
      if (cued && state.episode) load(state.episode, state.position)
      else if (state.episode && !state.failed) attemptPlay()
    },

    pause() {
      audio.pause()
      update({ playing: !audio.paused })
    },

    seekTo,
    skipBack() {
      if (state.episode) seekTo(state.position - state.skip.back)
    },
    skipForward() {
      if (state.episode) seekTo(state.position + state.skip.forward)
    },

    skipToNext() {
      const next = takeNextOther()
      if (next) play(next.episode, next.startAt)
    },

    setSpeed(requested) {
      if (!Number.isFinite(requested)) return
      const speed = toSpeedStep(requested)
      if (speed === state.speed) return
      set({ ...state, speed })
      applySpeed()
    },

    setSkip(direction, seconds) {
      if (!isSkipSeconds(seconds) || state.skip[direction] === seconds) return
      set({ ...state, skip: { ...state.skip, [direction]: seconds } })
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
      cued = false
      pendingStart = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      set({ episode: null, speed: state.speed, skip: state.skip })
    },
  }
}

const SPEED_KEY = 'tincan.playbackSpeed'

/** The speed last chosen on this device, or normal speed. */
function storedSpeed(): number {
  try {
    const speed = Number(localStorage.getItem(SPEED_KEY))
    return Number.isFinite(speed) && speed > 0 ? toSpeedStep(speed) : 1
  } catch {
    return 1
  }
}

function storeSpeed(speed: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed))
  } catch {
    // Storage can be unavailable (private browsing); the speed then lasts until the app closes.
  }
}

const SKIP_KEY = 'tincan.skipSeconds'

const isSkipSeconds = (seconds: unknown): seconds is number =>
  typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0

/** The skips last chosen on this device, or the defaults. */
function storedSkip(): SkipSeconds {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(SKIP_KEY) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return DEFAULT_SKIP
    const { back, forward } = stored as Record<string, unknown>
    return {
      back: isSkipSeconds(back) ? back : DEFAULT_SKIP.back,
      forward: isSkipSeconds(forward) ? forward : DEFAULT_SKIP.forward,
    }
  } catch {
    return DEFAULT_SKIP
  }
}

function storeSkip(skip: SkipSeconds) {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify(skip))
  } catch {
    // As with the speed, the skips then last until the app closes.
  }
}

/**
 * A player for this audio element, for the life of the calling component,
 * shown on and controlled from the OS media controls. It saves the position
 * whenever the app goes to the background, and keeps the chosen speed and skips on
 * this device for the next launch. `saveProgress`, `takeNext` and `localCopyOf`
 * are taken once, when the player is made, so later values are ignored. `hasNext` says
 * whether anything is queued, for the OS controls' next button.
 */
export function usePlayer(
  audio: AudioElement,
  mediaSession: MediaSessionControls,
  saveProgress: SaveProgress,
  takeNext: TakeNext,
  localCopyOf: LocalCopyOf,
  hasNext: boolean,
): { player: Player; state: PlayerState } {
  // The engine attaches to the element only while subscribed, so a discarded
  // instance (React may call the initialiser twice) leaves nothing behind.
  const [player] = useState(() => createPlayer(audio, saveProgress, storedSpeed(), takeNext, localCopyOf, storedSkip()))
  const state = useSyncExternalStore(player.subscribe, player.getState)
  useEffect(() => () => player.stop(), [player])
  useEffect(() => connectMediaSession(mediaSession, player), [mediaSession, player])
  useEffect(() => offerNextTrack(mediaSession, player, hasNext), [mediaSession, player, hasNext])
  useEffect(() => storeSpeed(state.speed), [state.speed])
  useEffect(() => storeSkip(state.skip), [state.skip])
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

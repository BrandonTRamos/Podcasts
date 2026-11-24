import { useEffect, useState, useSyncExternalStore } from 'react'
import { connectMediaSession, offerNextTrack } from './mediaSession'
import { type AudioElement, HAVE_FUTURE_DATA, type MediaSessionControls, type PlaybackLog } from './services'

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
/** A file played again that has not moved after this long is stuck. One that plays starts within a second or so. */
export const STUCK_MS = 4_000
/**
 * A file paused, with the app in the background, for at least this long is
 * loaded afresh when played again if its element no longer holds enough of
 * it to play (`HAVE_FUTURE_DATA`). iOS may let go of a paused file there, and
 * playing it on can then go nowhere.
 */
export const STALE_PAUSE_MS = 60_000
/**
 * A file that had played since it was loaded, played on, shows as loading
 * only once it has not moved for this long. It usually moves at once, and a
 * flash of loading then would only be noise.
 */
export const PLAY_ON_GRACE_MS = 1_000
/** How long the player waits before each further try at a file that failed while playing. */
export const RETRY_DELAYS_MS = [1_000, 4_000, 10_000]
/** A file tried again has settled once it has played on for this many seconds: a later failure gets every try anew. */
export const SETTLED_SECONDS = 10
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
  /**
   * Play was pressed (or the player is trying the file again) and the
   * position has not moved yet: it is playing in name only, and shown as loading.
   */
  loading: boolean
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
 *
 * A loaded file played again (after a pause) whose position has not moved
 * `STUCK_MS` later is loaded afresh at that position and played, once. On an
 * iPhone, pressing play on the lock screen after a long pause can leave the
 * element saying it plays while nothing comes out. A file loading for the
 * first time is left alone: a slow network is no reason to start over.
 * One paused in the background for `STALE_PAUSE_MS` whose element no longer
 * holds enough of it to play is loaded afresh at once when played again,
 * without waiting to see it stuck; one that still does is played on, with
 * the stuck check as its safety net.
 *
 * A file loaded at launch and never played is not held to the
 * background pause: it holds no more than its metadata by design.
 *
 * From play until the position first moves, the episode is shown as
 * loading. A file that had played since it was loaded, played on, is shown so
 * only after `PLAY_ON_GRACE_MS`, as it usually moves at once; one that had
 * not (loaded at launch, or paused before it moved) is shown so at once.
 *
 * A file iOS pauses as the app is hidden, before it has played since it was
 * loaded, nobody here having asked, is waiting to play rather than paused:
 * still playing in name and shown as loading, whether iOS pauses it before
 * or after the player is told the app is hidden. Once it can play, it is
 * tried once more, once while the app stays hidden, even if iOS takes that
 * try and pauses it again; it is tried again when the app shows (iOS may
 * start it by itself then too), and play on an OS control plays it. Pausing it makes
 * it an ordinary pause; its file failing makes it failed. Time spent waiting
 * does not count towards `STALE_PAUSE_MS`, and nothing is saved for it.
 *
 * A file that fails after it had got going (the network dropped under a
 * stream) keeps the listener's place. If it was playing, it is tried again
 * after each of `RETRY_DELAYS_MS`, and only then shown as failed; if it was
 * paused, it is quietly loaded again when next played. Pressing play on a
 * failed episode, as from the lock screen, tries it again too.
 *
 * It reports each rescue in a line, and a pause that neither it nor an OS
 * control (which pauses through it) asked for: iOS's own, as a rule. It tells
 * the playback log which episode is loaded, by its ID, so that every line
 * names it without the log reading the element.
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
   * Loads this episode's file, paused at `startAt` seconds, asking the browser
   * for no more than its metadata, so that it starts within a moment when
   * played. Played, it plays on as loaded, unless a stored copy has turned up
   * since: that is loaded instead, at the same place. Seeking moves where it
   * will start. A file that fails before it is played shows no failure and
   * saves nothing: it is loaded again when played. Does nothing if an episode
   * is already loaded.
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
  /**
   * The app has gone to the background (true) or come back (false). Going
   * there saves the position, if it has moved since it was last saved, as iOS
   * may close the app at any time after. Coming back does as `retryNow`.
   */
  inBackground(hidden: boolean): void
  /** A file waiting to be tried again is tried at once: the network is back, or the listener is. */
  retryNow(): void
  /**
   * A position for this episode was saved elsewhere (another device). If it is
   * the episode loaded, it is paused, and the position differs from what this
   * player last saved, moves there so that playing on carries on from it.
   */
  adoptSavedPosition(episodeId: string, seconds: number): void
  /** Pauses, unloads the file and forgets the episode. */
  stop(): void
}

/** Whether the page is hidden now, as the browser says, whether or not the player has been told yet. */
const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function createPlayer(
  audio: AudioElement,
  saveProgress: SaveProgress,
  initialSpeed: number,
  takeNext: TakeNext,
  localCopyOf: LocalCopyOf,
  initialSkip: SkipSeconds = DEFAULT_SKIP,
  /** Told, in a line, when the player steps in to rescue playback, or when nobody asked for a pause. */
  report: (line: string) => void = () => {},
  /** Told the episode loaded, by its ID, whenever that changes; null when none is. */
  loaded: (episodeId: string | null) => void = () => {},
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
  /**
   * The element holds nothing of the loaded episode: its file failed, or
   * failed before it was ever played. The position is then the state's own.
   */
  let fileFailed = false
  /** Runs out when the file played again has stayed put for `STUCK_MS`. */
  let stuckTimer: ReturnType<typeof setTimeout> | null = null
  /** The file's metadata has arrived since it was loaded: it is, or was, playable. */
  let gotGoing = false
  /** This load is the player's own, to rescue an episode that had got going. */
  let recovering = false
  /** Tries made at a failed file since one last settled. */
  let retries = 0
  /** The element's position at its last tick since the file loaded, and how many seconds it has played on since then. */
  let lastTick: number | null = null
  let playedOn = 0
  /** Runs out when it is time to try a failed file again. */
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let hidden = false
  /** Where the file was when it was played, until its position first moves from there. */
  let startingFrom: number | null = null
  /** Runs out when a file played on has been slow enough to move to show as loading. */
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  /** When the file came to be both paused and in the background, while it is. */
  let idleSince: number | null = null
  /** The longest it has been so, in one stretch, since it last played. */
  let idleFor = 0
  /**
   * The player, or an OS control through it, has asked the element to pause
   * (or unloaded its file) since it last played. A pause without it came from
   * nobody here: iOS, as a rule.
   */
  let pauseAsked = false
  /**
   * The file was loaded at launch, paused, and has not been played since: on
   * playing, a stored copy that has turned up since takes its place.
   */
  let primed = false
  /** Where the element's file was loaded from. */
  let source = ''
  /** The file has played since it was loaded: its position has moved on from where it was played. */
  let played = false
  /**
   * iOS paused the file, with the app hidden, before it had played: the
   * episode is waiting to play, still playing in name and shown as loading.
   */
  let waiting = false
  /**
   * The player engine has made its one further try at a waiting file, once it
   * could play, since the file was loaded or the app last showed: iOS may take
   * that try and pause the file again, and it is not tried again for that.
   */
  let triedWhileWaiting = false

  function set(next: PlayerState) {
    if (next.episode?.id !== state.episode?.id) loaded(next.episode?.id ?? null)
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
    if (fileFailed && state.episode) return state.position
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
      // A failed file is not playing, whatever its element says (iOS may start it as the app shows): played, it loads again.
      if (fileFailed) return
      pauseAsked = false
      waiting = false
      applySpeed()
      noLongerIdle()
      showPlaying(true)
      // Whoever pressed play: the listener, or iOS itself once a phone call is over.
      if (gotGoing && !fileFailed) watchForStuck()
    },
    pause: () => {
      // A failed file is not playing, whatever its element says of pausing.
      if (fileFailed) return
      const unasked = !pauseAsked && !audio.ended
      pauseAsked = false
      // iOS may pause the element before the player is told the app is hidden, so the page is asked too.
      const hiddenNow = hidden || pageHidden()
      // iOS pauses a file that has not yet produced sound as the app is hidden.
      if (unasked && hiddenNow && !played && state.episode && state.playing) {
        report(`paused at ${audio.currentTime.toFixed(1)}: nobody asked, waiting to play`)
        waiting = true
        update({ loading: true })
        tryWhileWaiting()
        return
      }
      if (unasked) report(`paused at ${audio.currentTime.toFixed(1)}: nobody asked`)
      if (hiddenNow) idleSince = Date.now()
      showPlaying(false)
      // Reaching the end pauses first; `ended` saves that.
      if (!audio.ended) save()
    },
    ended: () => {
      save({ positionSeconds: audio.currentTime, played: true })
      // Straight away, with nothing awaited: see `TakeNext`.
      const next = takeNextOther()
      if (next) load(next.episode, next.startAt)
    },
    canplay: () => tryWhileWaiting(),
    timeupdate: () => {
      // The element's position means nothing once its file has failed.
      if (fileFailed) return
      // A second or two on from the last tick is playback; anything else is a seek.
      const moved = lastTick === null ? 0 : audio.currentTime - lastTick
      lastTick = audio.currentTime
      if (!audio.paused && moved > 0 && moved < 2) {
        playedOn += moved
        if (playedOn >= SETTLED_SECONDS) retries = 0
      }
      update({ position: audio.currentTime })
      if (startingFrom !== null && !audio.paused && currentPosition() !== startingFrom) {
        played = true
        showPlaying(true, true)
      }
      if (state.episode && !audio.paused && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) save()
    },
    durationchange: () => {
      if (state.episode) update({ duration: fileDuration() ?? state.episode.durationSeconds })
    },
    // Some browsers ignore a seek made before the file's metadata has loaded.
    loadedmetadata: () => {
      gotGoing = true
      applySpeed()
      if (pendingStart === null) return
      const start = pendingStart
      pendingStart = null
      if (audio.currentTime !== start) audio.currentTime = start
    },
    // A failed load leaves `paused` false, so the element's word on playing can't be trusted after it.
    error: () => {
      if (!state.episode || fileFailed) return
      stopWatchingForStuck()
      // Failed, it is no longer waiting to play: nothing is to start it when the app shows.
      waiting = false
      if (primed) {
        // Not played yet, so nothing is lost: it is loaded again when it is.
        const position = currentPosition()
        primed = false
        fileFailed = true
        pendingStart = null
        update({ position })
        return
      }
      // Where it had got to, or was about to start: the place to pick up from.
      const position = pendingStart ?? state.position
      const started = gotGoing || recovering
      fileFailed = true
      pendingStart = null
      if (started && state.playing && retries < RETRY_DELAYS_MS.length) {
        report(`failed at ${position.toFixed(1)}: trying again`)
        // Still playing in name, as it is about to be tried again: shown as loading meanwhile.
        notStarting()
        startingFrom = position
        update({ position, loading: true })
        retryTimer = setTimeout(retry, RETRY_DELAYS_MS[retries++])
        return
      }
      // A file that had got going and was paused is just loaded again when next played.
      const failed = !started || state.playing
      if (started) {
        if (failed) report(`failed at ${position.toFixed(1)}: giving up`)
        // Nothing is saved for a failed episode, so its place is saved first.
        update({ position })
        save()
      }
      notStarting()
      update({ position, playing: false, loading: false, failed })
    },
  }

  /** Tries the failed file again now, rather than when its wait runs out. */
  function retryNow() {
    if (retryTimer === null) return
    stopRetrying()
    retry()
  }

  function retry() {
    retryTimer = null
    if (state.episode) load(state.episode, state.position, true)
  }

  function stopRetrying() {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  /** The waiting file is played once more, the first time it can play. iOS may refuse while the app is hidden. */
  function tryWhileWaiting() {
    if (!waiting || triedWhileWaiting || audio.readyState < HAVE_FUTURE_DATA) return
    triedWhileWaiting = true
    attemptPlay()
  }

  function noLongerIdle() {
    idleSince = null
    idleFor = 0
  }

  /** How long the file has sat paused in the background, at its longest, since it last played. */
  function longestIdle() {
    return Math.max(idleFor, idleSince === null ? 0 : Date.now() - idleSince)
  }

  /**
   * Shows the episode playing or not. Playing from not playing, it shows as
   * loading until its position first moves, or `moved` says it has.
   */
  function showPlaying(playing: boolean, moved = false) {
    if (!playing || moved) notStarting()
    else if (!state.episode || !state.playing) {
      startingFrom = currentPosition()
      if (played && !fileFailed) {
        graceTimer = setTimeout(() => {
          graceTimer = null
          update({ loading: true })
        }, PLAY_ON_GRACE_MS)
      }
    }
    update({ playing, loading: startingFrom !== null && graceTimer === null })
  }

  /** The file is not, or no longer, starting to play. */
  function notStarting() {
    startingFrom = null
    if (graceTimer !== null) clearTimeout(graceTimer)
    graceTimer = null
  }

  function attemptPlay() {
    // Waiting, it is already shown as playing; refused, it waits on. Its `play` event says when it starts.
    if (waiting) {
      audio.play().catch(() => {})
      return
    }
    const load = loadCount
    const started = audio.play()
    showPlaying(!audio.paused)
    started.catch(() => {
      // Refused (no user gesture) or aborted: show what the element is actually doing.
      if (load === loadCount && state.episode && !state.failed && !fileFailed) showPlaying(!audio.paused)
    })
  }

  /**
   * Plays the loaded file on from where it is, or loads it afresh at once if
   * it has sat paused in the background too long and its element no longer
   * holds enough of it to play. The element's `play` event then has it
   * watched, in case it stays put.
   */
  function playOn() {
    if (!state.episode) return
    if (primed) {
      primed = false
      // A stored copy that has turned up since launch is played instead, from the same place.
      const copy = localCopyOf(state.episode.id)
      if (copy !== null && copy !== source) {
        load(state.episode, currentPosition())
        return
      }
      audio.preload = 'auto'
    }
    const idle = longestIdle()
    // An ended file plays again from the start, which loading it at its end would not.
    if (idle >= STALE_PAUSE_MS && audio.readyState < HAVE_FUTURE_DATA && !audio.ended) {
      report(`paused ${Math.round(idle / 1000)}s in the background: loading afresh`)
      load(state.episode, currentPosition(), true)
      return
    }
    attemptPlay()
  }

  /** Loads the file afresh, where it is, if it has not moved from there in `STUCK_MS`. */
  function watchForStuck() {
    stopWatchingForStuck()
    const from = audio.currentTime
    stuckTimer = setTimeout(() => {
      stuckTimer = null
      if (!state.episode || state.failed || fileFailed || audio.paused || audio.currentTime !== from) return
      report(`stuck at ${from.toFixed(1)}: loading afresh`)
      load(state.episode, from, true)
    }, STUCK_MS)
  }

  function stopWatchingForStuck() {
    if (stuckTimer !== null) clearTimeout(stuckTimer)
    stuckTimer = null
  }

  /** The next queued episode other than the one loaded, which, if queued too, leaves the queue. */
  function takeNextOther() {
    let next = takeNext()
    while (next && next.episode.id === state.episode?.id) next = takeNext()
    return next
  }

  /**
   * Loads the episode in place of whatever is loaded, and starts it. A
   * `recovery` is the player loading again an episode that had got going.
   */
  function load(episode: PlayableEpisode, startAt: number, recovery = false) {
    loadFile(episode, startAt, 'auto', recovery)
    if (!recovery) lastSaveAt = Date.now()
    attemptPlay()
  }

  /**
   * Points the element at the episode's file, paused at `startAt` seconds, in
   * place of whatever is loaded, forgetting all the player knew of the file
   * before. A `recovery` keeps the tries made and the position last saved.
   */
  function loadFile(episode: PlayableEpisode, startAt: number, preload: AudioElement['preload'], recovery: boolean) {
    loadCount++
    stopWatchingForStuck()
    stopRetrying()
    noLongerIdle()
    notStarting()
    fileFailed = false
    primed = false
    gotGoing = false
    played = false
    waiting = false
    triedWhileWaiting = false
    recovering = recovery
    // A browser may pause the element as its source changes.
    pauseAsked = true
    if (!recovery) retries = 0
    lastTick = null
    playedOn = 0
    const start = Math.max(startAt, 0)
    set({ episode, playing: false, loading: false, position: start, duration: episode.durationSeconds, failed: false, speed: state.speed, skip: state.skip })
    // A recovery starts where the episode had got to, which may be past what was last saved.
    if (!recovery) savedPosition = start
    audio.preload = preload
    setSource(episode)
    applySpeed()
    startFrom(start)
  }

  /** Points the element at the episode's stored copy if there is one, and its stream otherwise. */
  function setSource(episode: PlayableEpisode) {
    source = localCopyOf(episode.id) ?? episode.enclosureUrl
    audio.src = source
  }

  /** Has the file just loaded start this far in, once the browser lets it. */
  function startFrom(start: number) {
    if (start > 0) {
      pendingStart = start
      audio.currentTime = start
    } else {
      pendingStart = null
    }
  }

  function play(episode: PlayableEpisode, startAt = 0) {
    if (fileFailed && state.episode && state.episode.id === episode.id) {
      load(episode, state.position)
      return
    }
    if (state.episode && state.episode.id === episode.id && !state.failed) {
      playOn()
      return
    }
    // The element is about to be reused, so take its position for the episode it holds now.
    save()
    // Called straight from the tap, as iOS only lets a user gesture start audio.
    load(episode, startAt)
  }

  function seekTo(seconds: number) {
    if (!state.episode) return
    if (fileFailed) {
      update({ position: Math.max(seconds, 0) })
      return
    }
    // Only the file's own length bounds a seek: the feed's can be wrong.
    const position = Math.min(Math.max(seconds, 0), fileDuration() ?? Infinity)
    // A timestamp (or another seek) can be tapped while the file is still
    // loading. Retry that latest choice when early seeks are ignored by iOS.
    pendingStart = fileDuration() === null ? position : null
    // A seek while loading is no sign of it playing: it is still to start, from there.
    if (startingFrom !== null) startingFrom = position
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
      // Only so much as to know the file: the rest waits until it is played.
      loadFile(episode, startAt, 'metadata', false)
      primed = true
    },

    resume() {
      if (fileFailed && state.episode) load(state.episode, state.position)
      else if (state.episode && !state.failed) playOn()
    },

    pause() {
      if (fileFailed) {
        // Nothing is playing; at most a failed file is waiting to be tried again.
        if (retryTimer === null) return
        stopRetrying()
        showPlaying(false)
        save()
        return
      }
      pauseAsked = true
      if (waiting) {
        // Already paused, by iOS: no `pause` event follows. Nothing is saved, as it never played.
        waiting = false
        if (hidden) idleSince = Date.now()
      }
      audio.pause()
      showPlaying(!audio.paused)
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

    inBackground(nowHidden) {
      hidden = nowHidden
      if (hidden) {
        // A file waiting to play is not paused, whatever its element says; one
        // loaded at launch and not yet played holds no more than its metadata anyway.
        if (idleSince === null && state.episode && !fileFailed && !waiting && !primed && audio.paused) idleSince = Date.now()
        save()
        return
      }
      idleFor = longestIdle()
      idleSince = null
      triedWhileWaiting = false
      if (waiting) attemptPlay()
      retryNow()
    },

    retryNow,

    adoptSavedPosition(episodeId, seconds) {
      if (!state.episode || state.episode.id !== episodeId || state.playing || state.failed) return
      if (seconds === savedPosition) return
      seekTo(seconds)
      savedPosition = seconds
    },

    stop() {
      loadCount++
      stopWatchingForStuck()
      stopRetrying()
      noLongerIdle()
      fileFailed = false
      primed = false
      waiting = false
      pendingStart = null
      notStarting()
      pauseAsked = true
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
 * shown on and controlled from the OS media controls. It is told whenever the
 * app goes to the background or comes back, and when the network does, and
 * keeps the chosen speed and skips on this device for the next launch.
 * `saveProgress`, `takeNext`, `localCopyOf` and `log` are taken once, when the
 * player is made, so later values are ignored. `hasNext` says whether anything
 * is queued, for the OS controls' next button.
 *
 * The state returned stands still while the app is hidden, but for changes
 * other than the position moving on: nothing is drawn then, and rendering the
 * app several times a second behind a locked screen only costs battery.
 */
export function usePlayer(
  audio: AudioElement,
  mediaSession: MediaSessionControls,
  saveProgress: SaveProgress,
  takeNext: TakeNext,
  localCopyOf: LocalCopyOf,
  hasNext: boolean,
  log: PlaybackLog,
): { player: Player; state: PlayerState } {
  // The engine attaches to the element only while subscribed, so a discarded
  // instance (React may call the initialiser twice) leaves nothing behind.
  const [player] = useState(() =>
    createPlayer(
      audio,
      saveProgress,
      storedSpeed(),
      takeNext,
      localCopyOf,
      storedSkip(),
      (line) => log.record(`player ${line}`),
      (episodeId) => log.loaded(episodeId),
    ),
  )
  const [shown] = useState(() => stateWhileVisible(player))
  const state = useSyncExternalStore(shown.subscribe, shown.getState)
  useEffect(() => () => player.stop(), [player])
  useEffect(() => connectMediaSession(mediaSession, player), [mediaSession, player])
  useEffect(() => offerNextTrack(mediaSession, player, hasNext), [mediaSession, player, hasNext])
  useEffect(() => storeSpeed(state.speed), [state.speed])
  useEffect(() => storeSkip(state.skip), [state.skip])
  useEffect(() => {
    const visibilityChanged = () => player.inBackground(document.visibilityState === 'hidden')
    const leaving = () => player.inBackground(true)
    visibilityChanged()
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', leaving)
    window.addEventListener('online', player.retryNow)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('pagehide', leaving)
      window.removeEventListener('online', player.retryNow)
    }
  }, [player])
  return { player, state }
}

/** Whether nothing differs between the two states but how far the same episode has played. */
function onlyPositionMoved(from: PlayerState, to: PlayerState): boolean {
  if (!from.episode || !to.episode) return false
  return (
    from.episode === to.episode &&
    from.playing === to.playing &&
    from.loading === to.loading &&
    from.duration === to.duration &&
    from.failed === to.failed &&
    from.speed === to.speed &&
    from.skip === to.skip
  )
}

/**
 * The player's state as there is any use in drawing it: while the app is
 * hidden, it stays as it was until something other than the position changes,
 * and catches up when the app shows again.
 */
function stateWhileVisible(player: Player): Pick<Player, 'getState' | 'subscribe'> {
  let shown = player.getState()
  return {
    getState() {
      const current = player.getState()
      if (current === shown) return shown
      if (document.visibilityState === 'hidden' && onlyPositionMoved(shown, current)) return shown
      shown = current
      return shown
    },
    subscribe(listener) {
      const unsubscribe = player.subscribe(listener)
      document.addEventListener('visibilitychange', listener)
      return () => {
        unsubscribe()
        document.removeEventListener('visibilitychange', listener)
      }
    },
  }
}

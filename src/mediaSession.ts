import type { PlayableEpisode, Player } from './player'
import type { MediaSessionControls, PlaybackLog } from './services'

/** How far, in seconds, the position may be from where the OS reckons it before the OS is told again. */
const POSITION_SLACK = 1

/**
 * Shows the player on the OS media controls (lock screen, notification
 * centre) and lets those controls, and headphone and Bluetooth buttons, drive
 * it. Works from the player's own state rather than React, so it keeps up
 * while the app is in the background. Returns a function that disconnects it
 * and clears the controls.
 *
 * The OS moves its progress bar on by itself from the position, rate and time
 * it was last told, so it is told again only when that would be wrong: on
 * play, pause, a seek, a change of speed or length, or when playback has
 * drifted from it. Telling it at every tick of the position, several times a
 * second, is work done behind a locked screen for nothing.
 */
export function connectMediaSession(session: MediaSessionControls, player: Player): () => void {
  const actions: [MediaSessionAction, (details: MediaSessionActionDetails) => void][] = [
    // A headset's play/pause button arrives as one of these two, by the playback state shown.
    ['play', () => player.resume()],
    ['pause', () => player.pause()],
    // The amounts chosen in the app, whatever offset the OS suggests.
    ['seekbackward', () => player.skipBack()],
    ['seekforward', () => player.skipForward()],
    ['seekto', ({ seekTime }) => seekTime !== undefined && player.seekTo(seekTime)],
    // No previous track, and next only while something is queued (`offerNextTrack`):
    // on iOS they take the place of the skip buttons.
  ]
  for (const [action, handler] of actions) session.setActionHandler(action, handler)

  let shown: PlayableEpisode | null = null
  let wasPlaying = false
  /** What the OS was last told of the position, and when; null when that was nothing. */
  let told: { playing: boolean; duration: number | null; position: number; speed: number; at: number } | null = null

  function show() {
    const state = player.getState()
    if (!state.episode) {
      if (shown) clear()
      return
    }
    // Set again each time playback starts too, as Safari can drop it when a file loads.
    const starting = state.playing && !wasPlaying
    wasPlaying = state.playing
    if (state.episode !== shown || starting) {
      shown = state.episode
      // Safari can drop the position along with the metadata, so that is told again too.
      told = null
      session.setMetadata({
        title: shown.title,
        artist: shown.podcastTitle ?? '',
        artwork: shown.artworkUrl ? [{ src: shown.artworkUrl }] : [],
      })
    }
    const { playing, duration, speed } = state
    // The OS rejects a position past the end, which a feed's understated length would allow.
    const position = duration === null ? state.position : Math.min(state.position, duration)
    const now = Date.now()
    if (told && told.playing === playing && told.duration === duration && told.speed === speed) {
      const reckoned = told.position + (playing ? ((now - told.at) / 1000) * speed : 0)
      if (Math.abs(position - reckoned) <= POSITION_SLACK) return
    }
    told = { playing, duration, position, speed, at: now }
    session.setPlaybackState(playing ? 'playing' : 'paused')
    session.setPositionState(duration === null ? null : { duration, position, playbackRate: speed })
  }

  function clear() {
    shown = null
    wasPlaying = false
    told = null
    session.setMetadata(null)
    session.setPlaybackState('none')
    session.setPositionState(null)
  }

  show()
  const unsubscribe = player.subscribe(show)
  return () => {
    unsubscribe()
    for (const [action] of actions) session.setActionHandler(action, null)
    clear()
  }
}

/**
 * Offers the OS controls' next-track button, which skips to the next queued
 * episode, while something is queued. With nothing queued it is left off, so
 * iOS shows its skip-forward button in that place. Returns a function that
 * takes it away again.
 */
export function offerNextTrack(session: MediaSessionControls, player: Player, hasNext: boolean): () => void {
  if (!hasNext) return () => {}
  session.setActionHandler('nexttrack', () => player.skipToNext())
  return () => session.setActionHandler('nexttrack', null)
}

/**
 * The browser's media session, or controls that do nothing where it has none.
 * Each call is guarded, as browsers throw on actions or states they do not support.
 * Every control pressed goes in the log, before the app acts on it.
 */
export function browserMediaSession(log: PlaybackLog): MediaSessionControls {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return { setMetadata() {}, setPlaybackState() {}, setPositionState() {}, setActionHandler() {} }
  }
  const session = navigator.mediaSession
  const attempt = (call: () => void) => {
    try {
      call()
    } catch {
      // Unsupported here: the OS controls just lack it.
    }
  }
  return {
    setMetadata: (metadata) => attempt(() => (session.metadata = metadata && new MediaMetadata(metadata))),
    setPlaybackState: (state) => attempt(() => (session.playbackState = state)),
    // Called with nothing, it clears the position.
    setPositionState: (state) => attempt(() => (state ? session.setPositionState(state) : session.setPositionState())),
    setActionHandler: (action, handler) =>
      attempt(() =>
        session.setActionHandler(
          action,
          handler &&
            ((details) => {
              log.record(`control ${action}`)
              handler(details)
            }),
        ),
      ),
  }
}

/** TypeScript's DOM types lack the Audio Session API. */
type WithAudioSession = { audioSession?: { type: string } }

/**
 * Tells Safari the app plays media (its Audio Session API, iOS 16.4+). Left on
 * its default, Safari lets go of the audio once playback pauses, and iOS hands
 * the lock screen and headset buttons back to Apple Music within seconds: taking
 * a Bluetooth headset off, which pauses, then pressing play started Music instead.
 * Does nothing in browsers without it.
 */
export function claimPlaybackAudioSession(browser: WithAudioSession = navigator as WithAudioSession) {
  if (!browser.audioSession) return
  try {
    browser.audioSession.type = 'playback'
  } catch {
    // Refused: the app plays as before, just without the hold on the lock screen.
  }
}

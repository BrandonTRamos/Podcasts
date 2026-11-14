import type { PlayableEpisode, Player } from './player'
import type { MediaSessionControls } from './services'

/**
 * Shows the player on the OS media controls (lock screen, notification
 * centre) and lets those controls, and headphone and Bluetooth buttons, drive
 * it. Works from the player's own state rather than React, so it keeps up
 * while the app is in the background. Returns a function that disconnects it
 * and clears the controls.
 */
export function connectMediaSession(session: MediaSessionControls, player: Player): () => void {
  const actions: [MediaSessionAction, (details: MediaSessionActionDetails) => void][] = [
    // A headset's play/pause button arrives as one of these two, by the playback state shown.
    ['play', () => player.resume()],
    ['pause', () => player.pause()],
    // Fixed amounts, as in the app, whatever offset the OS suggests.
    ['seekbackward', () => player.skipBack()],
    ['seekforward', () => player.skipForward()],
    ['seekto', ({ seekTime }) => seekTime !== undefined && player.seekTo(seekTime)],
    // No previous track, and next only while something is queued (`offerNextTrack`):
    // on iOS they take the place of the skip buttons.
  ]
  for (const [action, handler] of actions) session.setActionHandler(action, handler)

  let shown: PlayableEpisode | null = null
  let wasPlaying = false

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
      session.setMetadata({
        title: shown.title,
        artist: shown.podcastTitle ?? '',
        artwork: shown.artworkUrl ? [{ src: shown.artworkUrl }] : [],
      })
    }
    session.setPlaybackState(state.playing ? 'playing' : 'paused')
    const { duration, position, speed } = state
    session.setPositionState(
      // The OS rejects a position past the end, which a feed's understated length would allow.
      duration === null ? null : { duration, position: Math.min(position, duration), playbackRate: speed },
    )
  }

  function clear() {
    shown = null
    wasPlaying = false
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
 */
export function browserMediaSession(): MediaSessionControls {
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
    setActionHandler: (action, handler) => attempt(() => session.setActionHandler(action, handler)),
  }
}

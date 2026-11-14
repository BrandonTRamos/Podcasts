import { formatClock } from './format'
import { Artwork } from './LibraryScreen'
import { type LoadedState, type Player, SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS, SPEEDS } from './player'

/** Stays at the foot of every screen while an episode is loaded. */
export function MiniPlayer({ state, player, onOpen }: { state: LoadedState; player: Player; onOpen: () => void }) {
  return (
    <section className="mini-player" aria-label="Mini player">
      <button type="button" className="mini-player-open" onClick={onOpen} aria-description="Opens now playing">
        <Artwork url={state.episode.artworkUrl} />
        <span className="mini-player-title">{state.episode.title}</span>
      </button>
      {state.failed ? (
        <FailedMessage />
      ) : (
        <PlayPauseButton state={state} player={player} />
      )}
    </section>
  )
}

/** The focused view of what is playing, with the full set of controls. */
export function NowPlayingScreen({ state, player, onClose }: { state: LoadedState; player: Player; onClose: () => void }) {
  const { episode, position, duration, failed } = state
  return (
    <main className="now-playing">
      <nav>
        <button type="button" onClick={onClose} aria-label="Close now playing">
          ‹ Back
        </button>
      </nav>
      <Artwork url={episode.artworkUrl} size="hero" />
      <h1>{episode.title}</h1>
      {episode.podcastTitle && <p className="podcast-author">{episode.podcastTitle}</p>}
      {failed && <FailedMessage />}
      <input
        type="range"
        className="seek-bar"
        aria-label="Seek"
        aria-valuetext={`${formatClock(position)} of ${duration === null ? 'unknown length' : formatClock(duration)}`}
        min={0}
        max={duration ?? 0}
        step={1}
        value={Math.min(position, duration ?? 0)}
        disabled={failed || duration === null}
        onChange={(e) => player.seekTo(Number(e.target.value))}
      />
      <p className="seek-times">
        <span>{formatClock(position)}</span>
        <span>{duration === null ? '--:--' : formatClock(duration)}</span>
      </p>
      <div className="transport">
        <button type="button" onClick={player.skipBack} disabled={failed} aria-label={`Skip back ${SKIP_BACK_SECONDS} seconds`}>
          ↺ {SKIP_BACK_SECONDS}
        </button>
        <PlayPauseButton state={state} player={player} />
        <button
          type="button"
          onClick={player.skipForward}
          disabled={failed}
          aria-label={`Skip forward ${SKIP_FORWARD_SECONDS} seconds`}
        >
          {SKIP_FORWARD_SECONDS} ↻
        </button>
      </div>
      <select
        className="speed"
        aria-label="Playback speed"
        value={state.speed}
        onChange={(e) => player.setSpeed(Number(e.target.value))}
      >
        {SPEEDS.map((speed) => (
          <option key={speed} value={speed}>
            {speed}×
          </option>
        ))}
      </select>
    </main>
  )
}

function FailedMessage() {
  return (
    <p role="alert" className="player-error">
      Couldn’t load this episode from the publisher. Try again later, or play something else.
    </p>
  )
}

function PlayPauseButton({ state, player }: { state: LoadedState; player: Player }) {
  return state.playing ? (
    <button type="button" className="play-pause" onClick={player.pause} aria-label="Pause">
      ❚❚
    </button>
  ) : (
    <button type="button" className="play-pause" onClick={player.resume} disabled={state.failed} aria-label="Play">
      ▶
    </button>
  )
}

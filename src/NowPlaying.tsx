import { formatClock } from './format'
import { ChevronDownIcon, PauseIcon, PlayIcon, QueueIcon, SkipBackIcon, SkipForwardIcon } from './Icons'
import { Artwork } from './LibraryScreen'
import { type LoadedState, type Player, SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS, SPEEDS } from './player'

/** Stays at the foot of every screen but now playing while an episode is loaded. */
export function MiniPlayer({ state, player, onOpen }: { state: LoadedState; player: Player; onOpen: () => void }) {
  return (
    <section className="mini-player" aria-label="Mini player">
      <button type="button" className="mini-player-open" onClick={onOpen} aria-description="Opens now playing">
        <Artwork url={state.episode.artworkUrl} size="mini" />
        <span className="mini-player-text">
          <span className="mini-player-title">{state.episode.title}</span>
          {state.episode.podcastTitle && <span className="mini-player-podcast">{state.episode.podcastTitle}</span>}
        </span>
      </button>
      {state.failed ? <FailedMessage /> : <PlayPauseButton state={state} player={player} iconSize={24} />}
    </section>
  )
}

/** The focused view of what is playing, with the full set of controls. */
export function NowPlayingScreen({
  state,
  player,
  onClose,
  onOpenQueue,
}: {
  state: LoadedState
  player: Player
  onClose: () => void
  onOpenQueue: () => void
}) {
  const { episode, position, duration, failed } = state
  return (
    <main className="now-playing">
      <nav>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close now playing">
          <ChevronDownIcon size={26} />
        </button>
      </nav>
      <Artwork url={episode.artworkUrl} size="hero" />
      <div className="now-playing-titles">
        {episode.podcastTitle && <p className="podcast-author">{episode.podcastTitle}</p>}
        <h1>{episode.title}</h1>
      </div>
      {failed && <FailedMessage />}
      <div className="seek">
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
      </div>
      <div className="transport">
        <button
          type="button"
          className="icon-button"
          onClick={player.skipBack}
          disabled={failed}
          aria-label={`Skip back ${SKIP_BACK_SECONDS} seconds`}
        >
          <SkipBackIcon size={34} seconds={SKIP_BACK_SECONDS} />
        </button>
        <PlayPauseButton state={state} player={player} iconSize={32} />
        <button
          type="button"
          className="icon-button"
          onClick={player.skipForward}
          disabled={failed}
          aria-label={`Skip forward ${SKIP_FORWARD_SECONDS} seconds`}
        >
          <SkipForwardIcon size={34} seconds={SKIP_FORWARD_SECONDS} />
        </button>
      </div>
      <div className="now-playing-extras">
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
        <button type="button" className="text-button" onClick={onOpenQueue}>
          <QueueIcon size={22} />
          Queue
        </button>
      </div>
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

function PlayPauseButton({ state, player, iconSize }: { state: LoadedState; player: Player; iconSize: number }) {
  return state.playing ? (
    <button type="button" className="play-pause" onClick={player.pause} aria-label="Pause">
      <PauseIcon size={iconSize} />
    </button>
  ) : (
    <button type="button" className="play-pause" onClick={player.resume} disabled={state.failed} aria-label="Play">
      <PlayIcon size={iconSize} />
    </button>
  )
}

import { type CSSProperties, useEffect, useState } from 'react'
import { type Chapter, chapterIndexAt, nextChapterStart, previousChapterStart, useChapters } from './chapters'
import { formatClock } from './format'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon, PauseIcon, PlayIcon, QueueIcon, SkipBackIcon, SkipForwardIcon } from './Icons'
import { Artwork } from './LibraryScreen'
import { useLongPress } from './longPress'
import { type LoadedState, type Player, MAX_SPEED, MIN_SPEED, SKIP_CHOICES, type SkipDirection, SPEED_STEP } from './player'
import type { DataApi } from './services'

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
  data,
  state,
  player,
  onClose,
  onOpenShowNotes,
  onOpenQueue,
}: {
  /** Where the episode's show notes, and so its chapters, come from. */
  data: Pick<DataApi, 'getShowNotes'>
  state: LoadedState
  player: Player
  onClose: () => void
  /** Opens the screen of the episode playing, with its show notes. */
  onOpenShowNotes: () => void
  onOpenQueue: () => void
}) {
  const { episode, position, duration, failed } = state
  // The slider stays out of the way until the speed shown is tapped.
  const [speedOpen, setSpeedOpen] = useState(false)
  // Holding a skip button asks how far it should skip.
  const [choosingSkip, setChoosingSkip] = useState<SkipDirection | null>(null)
  const holdBack = useLongPress(() => setChoosingSkip('back'))
  const holdForward = useLongPress(() => setChoosingSkip('forward'))
  const chapters = playableChapters(useChapters(data, episode.id), duration)
  return (
    <main className="now-playing">
      <nav>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close now playing">
          <ChevronDownIcon size={26} />
        </button>
        <button type="button" className="icon-button" onClick={onOpenShowNotes} aria-label="Show notes">
          <InfoIcon size={26} />
        </button>
      </nav>
      <header className="now-playing-header tray">
        <div className="now-playing-cover">
          <Artwork url={episode.artworkUrl} size="hero" />
        </div>
        <div className="now-playing-titles">
          {episode.podcastTitle && <p className="podcast-author">{episode.podcastTitle}</p>}
          <h1>{episode.title}</h1>
        </div>
      </header>
      {failed && <FailedMessage />}
      <div className="seek tray">
        {chapters.length > 0 && (
          <ChapterSteps chapters={chapters} position={position} disabled={failed} onSeek={player.seekTo} />
        )}
        <input
          type="range"
          className="seek-bar"
          style={chapterMarks(chapters, duration)}
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
          {...holdBack}
          onClick={player.skipBack}
          disabled={failed}
          aria-label={`Skip back ${state.skip.back} seconds`}
          aria-description="Hold to change how far it skips"
        >
          <SkipBackIcon size={34} seconds={state.skip.back} />
        </button>
        <PlayPauseButton state={state} player={player} iconSize={32} />
        <button
          type="button"
          className="icon-button"
          {...holdForward}
          onClick={player.skipForward}
          disabled={failed}
          aria-label={`Skip forward ${state.skip.forward} seconds`}
          aria-description="Hold to change how far it skips"
        >
          <SkipForwardIcon size={34} seconds={state.skip.forward} />
        </button>
      </div>
      {choosingSkip && (
        <SkipDialog
          direction={choosingSkip}
          seconds={state.skip[choosingSkip]}
          onChoose={(seconds) => {
            player.setSkip(choosingSkip, seconds)
            setChoosingSkip(null)
          }}
          onClose={() => setChoosingSkip(null)}
        />
      )}
      <div className="now-playing-extras">
        <div className={speedOpen ? 'speed speed-open' : 'speed'}>
          <button
            type="button"
            className="speed-value"
            onClick={() => setSpeedOpen((open) => !open)}
            aria-expanded={speedOpen}
            aria-controls="speed-controls"
            aria-label={`Speed ${formatSpeed(state.speed)}. ${speedOpen ? 'Hide' : 'Change'} speed`}
          >
            {formatSpeed(state.speed)}
          </button>
          {speedOpen && (
            <div id="speed-controls" className="speed-controls">
              <input
                type="range"
                className="seek-bar speed-bar"
                aria-label="Playback speed"
                aria-valuetext={formatSpeed(state.speed)}
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={SPEED_STEP}
                value={state.speed}
                onChange={(e) => player.setSpeed(Number(e.target.value))}
              />
              <button
                type="button"
                className="speed-reset"
                onClick={() => player.setSpeed(1)}
                disabled={state.speed === 1}
                aria-label="Reset to normal speed"
              >
                1×
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={onOpenQueue}>
          <QueueIcon size={18} />
          Queue
        </button>
      </div>
    </main>
  )
}

/** The chapters inside the episode's length, if two or more are: a feed's list can run past the file's end. */
function playableChapters(chapters: Chapter[], duration: number | null): Chapter[] {
  const playable = duration === null ? chapters : chapters.filter((chapter) => chapter.start < duration)
  return playable.length >= 2 ? playable : NO_CHAPTERS
}

const NO_CHAPTERS: Chapter[] = []

/**
 * The chapter playing, and buttons to the one before and the one after. Back
 * returns to the start of this chapter, unless only just into it.
 */
function ChapterSteps({ chapters, position, disabled, onSeek }: {
  chapters: Chapter[]
  position: number
  disabled: boolean
  onSeek: (seconds: number) => void
}) {
  const index = chapterIndexAt(chapters, position)
  const previous = previousChapterStart(chapters, position)
  const next = nextChapterStart(chapters, position)
  return (
    <div className="chapter">
      <p className="chapter-title">
        {index < 0 ? (
          `${chapters.length} chapters`
        ) : (
          <>
            <span className="chapter-number" aria-hidden="true">
              Ch {index + 1} / {chapters.length}
            </span>
            <span className="visually-hidden">
              Chapter {index + 1} of {chapters.length}:{' '}
            </span>
            <span aria-hidden="true"> · </span>
            {chapters[index].title}
          </>
        )}
      </p>
      <button
        type="button"
        className="chapter-step"
        aria-label="Previous chapter"
        disabled={disabled || previous === null}
        onClick={() => previous !== null && onSeek(previous)}
      >
        <ChevronLeftIcon size={20} />
      </button>
      <button
        type="button"
        className="chapter-step"
        aria-label="Next chapter"
        disabled={disabled || next === null}
        onClick={() => next !== null && onSeek(next)}
      >
        <ChevronRightIcon size={20} />
      </button>
    </div>
  )
}

/**
 * A notch in the seek bar's track where each chapter after the first starts,
 * under where the thumb's centre sits at that time. Drawn as gradients the
 * track's own CSS layers over its colour.
 */
function chapterMarks(chapters: Chapter[], duration: number | null): CSSProperties | undefined {
  if (!duration || chapters.length === 0) return undefined
  const marks = chapters
    .filter((chapter) => chapter.start > 0)
    .map((chapter) => {
      const at = `(0.5rem + (100% - 1rem) * ${chapter.start / duration})`
      return `linear-gradient(to right, transparent calc(${at} - 1px), var(--mark) 0 calc(${at} + 1px), transparent 0)`
    })
  return marks.length > 0 ? ({ '--chapter-marks': marks.join(', ') } as CSSProperties) : undefined
}

/**
 * Asks how many seconds a skip button should move by, over the screen. Picking
 * one closes it; so do Cancel, Escape and a tap outside it.
 */
function SkipDialog({
  direction,
  seconds,
  onChoose,
  onClose,
}: {
  direction: SkipDirection
  /** What it skips by now. */
  seconds: number
  onChoose: (seconds: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const title = direction === 'back' ? 'Skip back by' : 'Skip forward by'
  return (
    <div className="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="skip-dialog-title">
        <h2 id="skip-dialog-title">{title}</h2>
        <div className="skip-choices" role="group" aria-label={title}>
          {SKIP_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={choice === seconds}
              aria-label={`${choice} seconds`}
              onClick={() => onChoose(choice)}
            >
              {choice}s
            </button>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}

/** Two decimals always, so the readout keeps its width as the slider moves: 1.00×, 1.05×. */
function formatSpeed(speed: number) {
  return `${speed.toFixed(2)}×`
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

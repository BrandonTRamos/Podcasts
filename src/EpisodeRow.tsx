import { type ReactNode, useEffect, useRef, useState } from 'react'
import { DownloadControl, DownloadedBadge } from './DownloadControl'
import type { DownloadState } from './downloads'
import { formatDate, formatDuration } from './format'
import { MoreIcon, PauseIcon, PlayIcon } from './Icons'
import type { QueuePlace } from './listening'
import type { Episode, EpisodeState } from './services'

/** What a listener can do with an episode in a list. */
export interface EpisodeActions {
  onPlay: (episode: Episode) => void
  /** Pauses what is playing. */
  onPause: () => void
  /** Whether it is the episode playing now. */
  isPlaying: (episodeId: string) => boolean
  /** Opens the episode's own screen, with its show notes. */
  onOpen: (episode: Episode) => void
  onQueue: (episode: Episode, where: QueuePlace) => void
  /** Marking an episode unplayed also takes it back to the start. */
  onMarkPlayed: (episode: Episode, played: boolean) => void
  /** Downloads it to this device, or resumes its download. */
  onDownload: (episode: Episode) => void
  /** Its download on this device. */
  downloadOf: (episodeId: string) => DownloadState
  /** Whether it can't play now: the device is offline and it is not downloaded. */
  unavailable: (episodeId: string) => boolean
}

/**
 * One episode in a list: its date, its title (tap to play, as the play button
 * beside its length does), how far through it is, and whether it is queued or
 * downloaded. While it plays, that button pauses it instead. Everything else a listener can do with it (mark it played, read
 * its show notes, queue it, download it) is behind its "More actions" button.
 * Shows its podcast's title too when the list mixes podcasts.
 */
export function EpisodeRow({
  episode,
  state,
  podcastTitle,
  onPlay,
  onPause,
  isPlaying,
  onOpen,
  onQueue,
  onMarkPlayed,
  onDownload,
  downloadOf,
  unavailable: unavailableNow,
}: {
  episode: Episode
  state: EpisodeState | undefined
  podcastTitle?: string
} & EpisodeActions) {
  const played = state?.played ?? false
  const unavailable = unavailableNow(episode.id)
  const download = downloadOf(episode.id)
  return (
    <li className={played ? 'episode-row episode-row-played' : 'episode-row'}>
      <div className="episode-row-main">
        <EpisodeMeta episode={episode} podcastTitle={podcastTitle} withDuration={false} />
        <h2>
          <button type="button" className="plain" onClick={() => onPlay(episode)} disabled={unavailable}>
            {episode.title}
          </button>
        </h2>
        <div className="episode-line">
          {isPlaying(episode.id) ? (
            <button type="button" className="play-circle" onClick={onPause} aria-label={`Pause ${episode.title}`}>
              <PauseIcon size={16} />
            </button>
          ) : (
            // A second way to the title's action for a pointer or a thumb; the title carries it for everyone else.
            <button
              type="button"
              className="play-circle"
              tabIndex={-1}
              aria-hidden="true"
              onClick={() => onPlay(episode)}
              disabled={unavailable}
            >
              <PlayIcon size={16} />
            </button>
          )}
          <ListeningProgress episode={episode} state={state} />
          {state?.queueOrder != null && <span className="episode-queued">Queued</span>}
          {download.status === 'downloaded' && <DownloadedBadge />}
        </div>
        {unavailable && <UnavailableOffline />}
        {download.status !== 'none' && download.status !== 'downloaded' && (
          <DownloadControl download={download} onDownload={() => onDownload(episode)} />
        )}
      </div>
      <MoreActions>
        <button type="button" onClick={() => onMarkPlayed(episode, !played)}>
          {played ? 'Mark unplayed' : 'Mark played'}
        </button>
        <button type="button" onClick={() => onOpen(episode)}>
          Show notes
        </button>
        <button type="button" onClick={() => onQueue(episode, 'next')}>
          Play next
        </button>
        <button type="button" onClick={() => onQueue(episode, 'last')}>
          Add to queue
        </button>
        {download.status === 'none' && (
          <button type="button" onClick={() => onDownload(episode)}>
            Download
          </button>
        )}
      </MoreActions>
    </li>
  )
}

/**
 * A button that shows the actions given, in a panel beside it. Choosing one
 * closes the panel, as do Escape and a tap anywhere else.
 */
function MoreActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Clear of the bars at the foot of the screen, which would otherwise cover the last rows' actions.
    panel.current?.scrollIntoView?.({ block: 'nearest' })
    const closeOnOutsideTap = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideTap)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideTap)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="more-actions" ref={container}>
      <button
        type="button"
        className="icon-button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon size={22} />
      </button>
      {open && (
        <div
          className="more-actions-panel"
          role="group"
          aria-label="More actions"
          ref={panel}
          onClick={(event) => {
            if ((event.target as Element).closest('button')) setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Marks an episode that can't play while the device is offline, as it is not downloaded. */
export function UnavailableOffline() {
  return <p className="episode-unavailable">Not available offline</p>
}

/** An episode's podcast (when given), date and (unless left out) duration, those it has, run together. */
export function EpisodeMeta({
  episode,
  podcastTitle,
  withDuration = true,
}: {
  episode: Episode
  podcastTitle?: string
  withDuration?: boolean
}) {
  const parts = [
    podcastTitle && <span key="podcast">{podcastTitle}</span>,
    episode.publishedAt && (
      <time key="date" dateTime={episode.publishedAt}>
        {formatDate(episode.publishedAt)}
      </time>
    ),
    withDuration && episode.durationSeconds !== null && <span key="duration">{formatDuration(episode.durationSeconds)}</span>,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return <p className="episode-meta">{parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}</p>
}

/** The episode's length, then played or new; or, part-played, how far through it is. */
function ListeningProgress({ episode, state }: { episode: Episode; state: EpisodeState | undefined }) {
  const duration = episode.durationSeconds
  const length = duration !== null && <span>{formatDuration(duration)}</span>
  if (state?.played) {
    return (
      <>
        {length}
        <span className="episode-played">Played</span>
      </>
    )
  }
  if (!state || state.positionSeconds <= 0) {
    return (
      <>
        {length}
        <span className="episode-new">New</span>
      </>
    )
  }
  if (duration === null || duration <= 0) {
    return <span>{formatDuration(state.positionSeconds)} in</span>
  }
  const position = Math.min(state.positionSeconds, duration)
  return (
    <span className="episode-progress">
      <progress aria-label="Listened" max={duration} value={position} />
      <span>{formatDuration(duration - position)} left</span>
    </span>
  )
}

import { DownloadControl } from './DownloadControl'
import type { DownloadState } from './downloads'
import { formatDate, formatDuration } from './format'
import type { QueuePlace } from './listening'
import type { Episode, EpisodeState } from './services'

/** What a listener can do with an episode in a list. */
export interface EpisodeActions {
  onPlay: (episode: Episode) => void
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
 * One episode in a list: its title (tap to play), date, duration and how far
 * through it is, with controls to queue it, mark it played and download it.
 * Shows its podcast's title too when the list mixes podcasts.
 */
export function EpisodeRow({
  episode,
  state,
  podcastTitle,
  onPlay,
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
  return (
    <li>
      <h2>
        <button type="button" onClick={() => onPlay(episode)} disabled={unavailable}>
          {episode.title}
        </button>
      </h2>
      <EpisodeMeta episode={episode} podcastTitle={podcastTitle} />
      {unavailable && <UnavailableOffline />}
      <div className="episode-state">
        <ListeningProgress episode={episode} state={state} />
        {state?.queueOrder != null && <span className="episode-queued">Queued</span>}
        <button type="button" onClick={() => onMarkPlayed(episode, !played)}>
          {played ? 'Mark unplayed' : 'Mark played'}
        </button>
      </div>
      <div className="episode-queue">
        <button type="button" onClick={() => onOpen(episode)}>
          Show notes
        </button>
        <button type="button" onClick={() => onQueue(episode, 'next')}>
          Play next
        </button>
        <button type="button" onClick={() => onQueue(episode, 'last')}>
          Add to queue
        </button>
      </div>
      <DownloadControl download={downloadOf(episode.id)} onDownload={() => onDownload(episode)} />
    </li>
  )
}

/** Marks an episode that can't play while the device is offline, as it is not downloaded. */
export function UnavailableOffline() {
  return <p className="episode-unavailable">Not available offline</p>
}

/** An episode's podcast (when given), date and duration, those it has, run together. */
export function EpisodeMeta({ episode, podcastTitle }: { episode: Episode; podcastTitle?: string }) {
  return (
    <p className="episode-meta">
      {[
        podcastTitle && <span key="podcast">{podcastTitle}</span>,
        episode.publishedAt && (
          <time key="date" dateTime={episode.publishedAt}>
            {formatDate(episode.publishedAt)}
          </time>
        ),
        episode.durationSeconds !== null && <span key="duration">{formatDuration(episode.durationSeconds)}</span>,
      ]
        .filter(Boolean)
        .flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
    </p>
  )
}

/** Played, part-played (with how far through), or new. */
function ListeningProgress({ episode, state }: { episode: Episode; state: EpisodeState | undefined }) {
  if (state?.played) return <span className="episode-played">Played</span>
  if (!state || state.positionSeconds <= 0) return <span className="episode-new">New</span>
  const duration = episode.durationSeconds
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

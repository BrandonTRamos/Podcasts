import { DownloadControl, DownloadedBadge } from './DownloadControl'
import type { DownloadState } from './downloads'
import { formatDate, formatDuration } from './format'
import { InfoIcon, PauseIcon, PlayIcon } from './Icons'
import { Artwork } from './LibraryScreen'
import type { QueuePlace } from './listening'
import { MoreActions } from './MoreActions'
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
 * downloaded. While it plays, that button pauses it instead. The "i" beside
 * that button opens its show notes. Everything else a listener can do with it
 * (mark it played, queue it, download it) is behind its "More actions" button.
 * Shows its podcast's title and artwork too when the list mixes podcasts.
 * On its podcast's own screen it has an Add button as well, which puts it in
 * the podcast's Recently Added, or, once added, takes it back out.
 */
export function EpisodeRow({
  episode,
  state,
  podcastTitle,
  artworkUrl,
  isNew = false,
  onSetAdded,
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
  /** Its podcast's artwork, shown at the start of the row; left out, the row has none. */
  artworkUrl?: string | null
  /** Whether to call it new (see `newEpisodeIds`), which shows unless it is started or played. */
  isNew?: boolean
  /** Adds it to its podcast's Recently Added, or takes it out. Left out, the row has no Add button. */
  onSetAdded?: (episode: Episode, added: boolean) => void
} & EpisodeActions) {
  const played = state?.played ?? false
  const unavailable = unavailableNow(episode.id)
  const download = downloadOf(episode.id)
  const withArtwork = artworkUrl !== undefined
  const added = state?.addedAt != null
  const className = [
    'episode-row',
    withArtwork && 'episode-row-with-artwork',
    onSetAdded && 'episode-row-with-add',
    played && 'episode-row-played',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <li className={className}>
      {withArtwork && <Artwork url={artworkUrl} />}
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
          <ShowNotesButton episode={episode} onOpen={onOpen} />
          <ListeningProgress episode={episode} state={state} isNew={isNew} />
          {state?.queueOrder != null && <span className="episode-queued">Queued</span>}
          {download.status === 'downloaded' && <DownloadedBadge />}
        </div>
        {unavailable && <UnavailableOffline />}
        {download.status !== 'none' && download.status !== 'downloaded' && (
          <DownloadControl download={download} onDownload={() => onDownload(episode)} />
        )}
      </div>
      {onSetAdded && (
        <button
          type="button"
          className={added ? 'add-pill added' : 'add-pill outline'}
          aria-label={`Add ${episode.title}`}
          aria-pressed={added}
          onClick={() => onSetAdded(episode, !added)}
        >
          {added ? 'Added' : 'Add'}
        </button>
      )}
      <MoreActions>
        <button type="button" onClick={() => onMarkPlayed(episode, !played)}>
          {played ? 'Mark unplayed' : 'Mark played'}
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
 * Opens an episode's show notes: the small "i" wherever an episode is shown.
 * Named for its episode, so those in a list are told apart.
 */
export function ShowNotesButton<E extends { title: string }>({ episode, onOpen }: { episode: E; onOpen: (episode: E) => void }) {
  return (
    <button
      type="button"
      className="show-notes-button"
      onClick={() => onOpen(episode)}
      aria-label={`Show notes for ${episode.title}`}
    >
      <InfoIcon size={24} />
    </button>
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

/**
 * The episode's length, then played, or new if it is; or, part-played, how
 * far through it is. Any other never started has its length alone.
 */
function ListeningProgress({
  episode,
  state,
  isNew,
}: {
  episode: Episode
  state: EpisodeState | undefined
  isNew: boolean
}) {
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
        {isNew && <span className="episode-new">New</span>}
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

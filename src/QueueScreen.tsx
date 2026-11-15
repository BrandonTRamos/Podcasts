import { DownloadedBadge } from './DownloadControl'
import { UnavailableOffline } from './EpisodeRow'
import { formatDuration } from './format'
import { ArrowDownIcon, ArrowUpIcon } from './Icons'
import type { ListeningStatus } from './listening'
import type { Episode } from './services'

/** The episodes lined up to play after the current one, in order, for reordering and removing. */
export function QueueScreen({
  queue,
  status,
  podcastTitleOf,
  onPlay,
  onMove,
  onRemove,
  downloaded,
  unavailable,
}: {
  queue: Episode[]
  status: ListeningStatus
  podcastTitleOf: (podcastId: string) => string | undefined
  onPlay: (episode: Episode) => void
  /** Moves the episode to this place in the queue, counting from 0. */
  onMove: (episodeId: string, index: number) => void
  onRemove: (episodeId: string) => void
  /** Whether the episode is stored on this device. */
  downloaded: (episodeId: string) => boolean
  /** Whether the episode can't play now: the device is offline and it is not downloaded. */
  unavailable: (episodeId: string) => boolean
}) {
  return (
    <main className="queue">
      <h1>Queue</h1>
      {status === 'failed' && <p role="alert">Couldn’t load the queue.</p>}
      {queue.length === 0 ? (
        status === 'loading' ? <p>Loading…</p> : <p>Nothing queued.</p>
      ) : (
        <ol className="queued" aria-label="Queued episodes">
          {queue.map((episode, index) => {
            const podcastTitle = podcastTitleOf(episode.podcastId)
            return (
              <li key={episode.id}>
                <div className="queued-episode">
                  <h2>
                    <button type="button" className="plain" onClick={() => onPlay(episode)} disabled={unavailable(episode.id)}>
                      {episode.title}
                    </button>
                  </h2>
                  <p className="episode-meta">
                    {podcastTitle}
                    {podcastTitle && episode.durationSeconds !== null && ' · '}
                    {episode.durationSeconds !== null && formatDuration(episode.durationSeconds)}
                  </p>
                  {downloaded(episode.id) && <DownloadedBadge />}
                  {unavailable(episode.id) && <UnavailableOffline />}
                </div>
                <div className="queued-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onMove(episode.id, index - 1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    <ArrowUpIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onMove(episode.id, index + 1)}
                    disabled={index === queue.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDownIcon />
                  </button>
                  <button type="button" onClick={() => onRemove(episode.id)}>
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </main>
  )
}

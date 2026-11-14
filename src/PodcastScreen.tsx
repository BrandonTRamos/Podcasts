import { useEffect, useState } from 'react'
import { formatDate, formatDuration } from './format'
import { Artwork } from './LibraryScreen'
import { type ListeningStore, useEpisodeStates } from './listening'
import type { DataApi, Episode, EpisodeState, Podcast } from './services'
import type { LoadState } from './SignedInApp'

export function PodcastScreen({
  data,
  podcastId,
  podcast,
  listening,
  onBack,
  onPlayEpisode,
  onQueueEpisode,
}: {
  data: DataApi
  podcastId: string
  /** Undefined until the library has loaded it. */
  podcast: Podcast | undefined
  listening: ListeningStore
  onBack: () => void
  onPlayEpisode: (episode: Episode) => void
  onQueueEpisode: (episode: Episode, where: 'last' | 'next') => void
}) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })
  const [unplayedOnly, setUnplayedOnly] = useState(false)
  const statesStatus = useEpisodeStates(listening, podcastId)

  useEffect(
    () =>
      data.observeEpisodes(podcastId, {
        next: (items) => setEpisodes({ status: 'loaded', items }),
        error: () => setEpisodes({ status: 'failed' }),
      }),
    [data, podcastId],
  )

  return (
    <main className="podcast">
      <nav>
        <button type="button" onClick={onBack} aria-label="Back to library">
          ‹ Library
        </button>
      </nav>
      {podcast ? (
        <header>
          <Artwork url={podcast.artworkUrl} size="large" />
          <div>
            <h1>{podcast.title}</h1>
            {podcast.author && <p className="podcast-author">{podcast.author}</p>}
          </div>
        </header>
      ) : (
        <p>Loading…</p>
      )}
      {/* Wait for the listening state too, so an episode tapped at once still resumes. */}
      {(episodes.status === 'loading' || statesStatus === 'loading') && podcast && <p>Loading episodes…</p>}
      {episodes.status === 'failed' && <p role="alert">Couldn’t load the episodes.</p>}
      {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
      {episodes.status === 'loaded' &&
        statesStatus !== 'loading' &&
        (episodes.items.length === 0 ? (
          podcast && <p>No episodes yet.</p>
        ) : (
          <EpisodeList
            episodes={episodes.items}
            stateOf={(episodeId) => listening.get(episodeId)}
            unplayedOnly={unplayedOnly}
            onUnplayedOnlyChange={setUnplayedOnly}
            onPlay={onPlayEpisode}
            onQueue={onQueueEpisode}
            onMarkPlayed={(episode, played) =>
              listening.update(episode.id, episode.podcastId, played ? { played } : { played, positionSeconds: 0 })
            }
          />
        ))}
    </main>
  )
}

function EpisodeList({
  episodes,
  stateOf,
  unplayedOnly,
  onUnplayedOnlyChange,
  onPlay,
  onQueue,
  onMarkPlayed,
}: {
  episodes: Episode[]
  stateOf: (episodeId: string) => EpisodeState | undefined
  unplayedOnly: boolean
  onUnplayedOnlyChange: (unplayedOnly: boolean) => void
  onPlay: (episode: Episode) => void
  onQueue: (episode: Episode, where: 'last' | 'next') => void
  /** Marking an episode unplayed also takes it back to the start. */
  onMarkPlayed: (episode: Episode, played: boolean) => void
}) {
  const shown = newestFirst(episodes).filter((episode) => !unplayedOnly || !stateOf(episode.id)?.played)
  return (
    <>
      <label className="episode-filter">
        <input type="checkbox" checked={unplayedOnly} onChange={(e) => onUnplayedOnlyChange(e.target.checked)} />
        Unplayed only
      </label>
      {shown.length === 0 ? (
        <p>No unplayed episodes.</p>
      ) : (
        <ol className="episodes" aria-label="Episodes">
          {shown.map((episode) => {
            const state = stateOf(episode.id)
            const played = state?.played ?? false
            return (
              <li key={episode.id}>
                <h2>
                  <button type="button" onClick={() => onPlay(episode)}>
                    {episode.title}
                  </button>
                </h2>
                <p className="episode-meta">
                  {episode.publishedAt && <time dateTime={episode.publishedAt}>{formatDate(episode.publishedAt)}</time>}
                  {episode.publishedAt && episode.durationSeconds !== null && ' · '}
                  {episode.durationSeconds !== null && <span>{formatDuration(episode.durationSeconds)}</span>}
                </p>
                <div className="episode-state">
                  <ListeningProgress episode={episode} state={state} />
                  {state?.queueOrder != null && <span className="episode-queued">Queued</span>}
                  <button type="button" onClick={() => onMarkPlayed(episode, !played)}>
                    {played ? 'Mark unplayed' : 'Mark played'}
                  </button>
                </div>
                <div className="episode-queue">
                  <button type="button" onClick={() => onQueue(episode, 'next')}>
                    Play next
                  </button>
                  <button type="button" onClick={() => onQueue(episode, 'last')}>
                    Add to queue
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </>
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

/** Dated episodes newest first; undated ones last. */
function newestFirst(episodes: Episode[]): Episode[] {
  const time = (episode: Episode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

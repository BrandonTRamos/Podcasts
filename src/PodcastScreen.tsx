import { useEffect, useState } from 'react'
import { formatDate, formatDuration } from './format'
import { Artwork } from './LibraryScreen'
import type { DataApi, Episode, Podcast } from './services'
import type { LoadState } from './SignedInApp'

export function PodcastScreen({
  data,
  podcastId,
  podcast,
  onBack,
}: {
  data: DataApi
  podcastId: string
  /** Undefined until the library has loaded it. */
  podcast: Podcast | undefined
  onBack: () => void
}) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })

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
      {episodes.status === 'loading' && podcast && <p>Loading episodes…</p>}
      {episodes.status === 'failed' && <p role="alert">Couldn’t load the episodes.</p>}
      {episodes.status === 'loaded' &&
        (episodes.items.length === 0 ? (
          podcast && <NoEpisodes podcast={podcast} />
        ) : (
          <ol className="episodes" aria-label="Episodes">
            {newestFirst(episodes.items).map((episode) => (
              <li key={episode.id}>
                <h2>{episode.title}</h2>
                <p className="episode-meta">
                  {episode.publishedAt && <time dateTime={episode.publishedAt}>{formatDate(episode.publishedAt)}</time>}
                  {episode.publishedAt && episode.durationSeconds !== null && ' · '}
                  {episode.durationSeconds !== null && <span>{formatDuration(episode.durationSeconds)}</span>}
                </p>
              </li>
            ))}
          </ol>
        ))}
    </main>
  )
}

function NoEpisodes({ podcast }: { podcast: Podcast }) {
  if (podcast.lastFetchError) return <p role="alert">Couldn’t fetch episodes. {podcast.lastFetchError}</p>
  return <p>{podcast.lastFetchedAt ? 'No episodes.' : 'Fetching episodes…'}</p>
}

/** Dated episodes newest first; undated ones last. */
function newestFirst(episodes: Episode[]): Episode[] {
  const time = (episode: Episode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

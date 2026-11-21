import { useEffect, useState } from 'react'
import { type EpisodeActions, EpisodeRow } from './EpisodeRow'
import { type LatestFilter, newEpisodeIds, newestFirst, passesFilter } from './episodes'
import { StarIcon } from './Icons'
import { type ListeningStore, useEpisodeStatesOfEach } from './listening'
import type { DataApi, Episode, Podcast } from './services'
import type { LoadState } from './SignedInApp'

const emptyMessages: Record<Exclude<LatestFilter, 'all'>, string> = {
  unplayed: 'No unplayed episodes.',
  favorites: 'No episodes from your favorites.',
  short: 'No episodes under 30 minutes.',
}

/**
 * The newest episodes across every subscription, newest first, kept current as
 * refreshes find new ones. Quick filters over the list narrow it to those
 * unplayed, from a favorite, or short.
 */
export function LatestScreen({
  data,
  listening,
  podcastOf,
  ...actions
}: {
  data: Pick<DataApi, 'observeLatestEpisodes'>
  listening: ListeningStore
  podcastOf: (podcastId: string) => Pick<Podcast, 'title' | 'artworkUrl' | 'favoriteOrder'> | undefined
} & EpisodeActions) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })
  const [filter, setFilter] = useState<LatestFilter>('all')
  const [statesArrived, setStatesArrived] = useState(false)
  const podcastIds = episodes.status === 'loaded' ? episodes.items.map((episode) => episode.podcastId) : []
  const statesStatus = useEpisodeStatesOfEach(listening, podcastIds)

  useEffect(
    () =>
      data.observeLatestEpisodes({
        next: (items) => setEpisodes({ status: 'loaded', items }),
        error: () => setEpisodes({ status: 'failed' }),
      }),
    [data],
  )

  // Wait for the listening state once, so an episode tapped at once still
  // resumes; a podcast that joins the list later does not hide it again.
  const loaded = episodes.status === 'loaded' && statesStatus !== 'loading'
  if (loaded && !statesArrived) setStatesArrived(true)

  let content
  if (episodes.status === 'failed') content = <p role="alert">Couldn’t load the latest episodes.</p>
  else if (episodes.status === 'loading' || !(loaded || statesArrived)) content = <p>Loading episodes…</p>
  else if (episodes.items.length === 0) content = <p>No episodes yet.</p>
  else {
    // The list holds the most recent episode of every podcast it holds any of, so new is judged within it.
    const fresh = newEpisodeIds(episodes.items, (episodeId) => listening.get(episodeId))
    const isFavorite = (podcastId: string) => (podcastOf(podcastId)?.favoriteOrder ?? null) !== null
    const shown = newestFirst(episodes.items).filter((episode) =>
      passesFilter(filter, episode, listening.get(episode.id), isFavorite),
    )
    const filters = (
      <div className="quick-filters" role="group" aria-label="Quick filters">
        {(
          [
            ['all', `All (${episodes.items.length})`],
            ['unplayed', 'Unplayed'],
            [
              'favorites',
              <>
                <StarIcon filled size={12} />
                Favorites
              </>,
            ],
            ['short', '< 30 min'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>
    )
    content = (
      <>
        {filters}
        {shown.length === 0 && filter !== 'all' ? (
          <p>{emptyMessages[filter]}</p>
        ) : (
          <ol className="episodes" aria-label="Latest episodes">
            {shown.map((episode) => {
              const podcast = podcastOf(episode.podcastId)
              return (
                <EpisodeRow
                  key={episode.id}
                  episode={episode}
                  state={listening.get(episode.id)}
                  isNew={fresh.has(episode.id)}
                  podcastTitle={podcast?.title}
                  artworkUrl={podcast?.artworkUrl ?? null}
                  {...actions}
                />
              )
            })}
          </ol>
        )}
      </>
    )
  }

  return (
    <main className="latest">
      <div className="tray">
        <h1>Latest episodes</h1>
        {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
        {content}
      </div>
    </main>
  )
}

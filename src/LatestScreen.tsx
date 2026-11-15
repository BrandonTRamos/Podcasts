import { useEffect, useState } from 'react'
import { type EpisodeActions, EpisodeRow } from './EpisodeRow'
import { newestFirst } from './episodes'
import { type ListeningStore, useEpisodeStatesOfEach } from './listening'
import type { DataApi, Episode } from './services'
import type { LoadState } from './SignedInApp'

/** The newest episodes across every subscription, newest first, kept current as refreshes find new ones. */
export function LatestScreen({
  data,
  listening,
  podcastTitleOf,
  ...actions
}: {
  data: Pick<DataApi, 'observeLatestEpisodes'>
  listening: ListeningStore
  podcastTitleOf: (podcastId: string) => string | undefined
} & EpisodeActions) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })
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
    content = (
      <ol className="episodes" aria-label="Latest episodes">
        {newestFirst(episodes.items).map((episode) => (
          <EpisodeRow
            key={episode.id}
            episode={episode}
            state={listening.get(episode.id)}
            podcastTitle={podcastTitleOf(episode.podcastId)}
            {...actions}
          />
        ))}
      </ol>
    )
  }

  return (
    <main className="latest">
      <h1>Latest episodes</h1>
      {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
      {content}
    </main>
  )
}

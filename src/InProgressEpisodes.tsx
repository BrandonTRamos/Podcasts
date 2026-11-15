import { useEffect, useState } from 'react'
import { type EpisodeActions, EpisodeRow } from './EpisodeRow'
import { isInProgress } from './episodes'
import { type ListeningStore, useEpisodeStatesOfEach } from './listening'
import type { DataApi, InProgressEpisode, Podcast } from './services'
import type { LoadState } from './SignedInApp'

/**
 * Every episode started but not finished, whatever its podcast, the one
 * listened to last first. Kept current as any device plays them; one finished
 * or marked played on this device leaves at once.
 */
export function InProgressEpisodes({
  data,
  listening,
  podcastOf,
  ...actions
}: {
  data: Pick<DataApi, 'observeInProgress'>
  listening: ListeningStore
  podcastOf: (podcastId: string) => Pick<Podcast, 'title' | 'artworkUrl'> | undefined
} & EpisodeActions) {
  const [started, setStarted] = useState<LoadState<InProgressEpisode>>({ status: 'loading' })
  const [statesArrived, setStatesArrived] = useState(false)
  const podcastIds = started.status === 'loaded' ? started.items.map(({ episode }) => episode.podcastId) : []
  // Watched so each row shows, and resumes from, the place as this device has it.
  const statesStatus = useEpisodeStatesOfEach(listening, podcastIds)

  useEffect(
    () =>
      data.observeInProgress({
        next: (items) => setStarted({ status: 'loaded', items }),
        error: () => setStarted({ status: 'failed' }),
      }),
    [data],
  )

  // Wait for the listening state once, so an episode tapped at once still
  // resumes; a podcast that joins the list later does not hide it again.
  const loaded = started.status === 'loaded' && statesStatus !== 'loading'
  if (loaded && !statesArrived) setStatesArrived(true)

  if (started.status === 'failed') return <p role="alert">Couldn’t load the episodes in progress.</p>
  if (started.status === 'loading' || !(loaded || statesArrived)) return <p>Loading episodes…</p>

  const shown = started.items
    .filter(({ episode }) => isInProgress(listening.get(episode.id)))
    .sort((a, b) => Date.parse(b.state.updatedAt) - Date.parse(a.state.updatedAt))

  return (
    <>
      {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
      {shown.length === 0 ? (
        <p className="in-progress-empty">Nothing in progress. Episodes you start and don’t finish show here.</p>
      ) : (
        <ol className="episodes" aria-label="In progress">
          {shown.map(({ episode }) => {
            const podcast = podcastOf(episode.podcastId)
            return (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                state={listening.get(episode.id)}
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

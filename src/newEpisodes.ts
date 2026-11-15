import { useEffect, useState } from 'react'
import { isNew } from './episodes'
import { type ListeningStore, useEpisodeStatesOfEach } from './listening'
import type { DataApi, Episode } from './services'

/**
 * How many new episodes each podcast has, by podcast ID, kept current as
 * refreshes find episodes and the listener plays them. A podcast with none,
 * or whose listening state has not arrived, is left out, so a count never
 * shows only to vanish. Counted from the latest episodes across the library,
 * which reach back further than a week unless the library is very busy.
 */
export function useNewEpisodeCounts(
  data: Pick<DataApi, 'observeLatestEpisodes'>,
  listening: ListeningStore,
): ReadonlyMap<string, number> {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  // On failure the counts stay as they were: they are a hint, not the list itself.
  useEffect(() => data.observeLatestEpisodes({ next: setEpisodes, error: () => {} }), [data])
  useEpisodeStatesOfEach(
    listening,
    episodes.map((episode) => episode.podcastId),
  )

  const counts = new Map<string, number>()
  for (const episode of episodes) {
    if (listening.status(episode.podcastId) !== 'loaded') continue
    if (isNew(episode, listening.get(episode.id))) {
      counts.set(episode.podcastId, (counts.get(episode.podcastId) ?? 0) + 1)
    }
  }
  return counts
}

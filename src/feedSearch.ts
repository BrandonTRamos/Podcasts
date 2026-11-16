import { useRef, useState } from 'react'
import type { DataApi, EpisodeSearch } from './services'

/** How a search of a podcast's whole feed stands. */
export type FeedSearchLoad =
  | { status: 'loading' }
  | { status: 'done'; search: EpisodeSearch }
  /** The call itself failed. */
  | { status: 'offline' }

/**
 * Searches of one podcast's whole feed, asked for one at a time: `shown` is
 * the search last asked for and how it stands, or null before any. An earlier
 * search answering late is dropped.
 */
export function useFeedSearch(data: Pick<DataApi, 'searchEpisodes'>, podcastId: string) {
  const [shown, setShown] = useState<{ term: string; load: FeedSearchLoad } | null>(null)
  /** The number of the search last asked for. */
  const latest = useRef(0)

  async function search(term: string) {
    const number = ++latest.current
    setShown({ term, load: { status: 'loading' } })
    let load: FeedSearchLoad
    try {
      load = { status: 'done', search: await data.searchEpisodes(podcastId, term) }
    } catch {
      load = { status: 'offline' }
    }
    if (latest.current === number) setShown({ term, load })
  }

  return { shown, search }
}

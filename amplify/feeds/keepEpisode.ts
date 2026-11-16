import type { FeedStore } from './feedStore'
import { withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'
import { episodeId, storeEpisode } from './storeEpisodes'

export interface KeepEpisodeEvent {
  arguments: { podcastId: string; episodeId: string }
}

export interface KeepEpisodeResult {
  outcome:
    | 'kept'
    /** The feed no longer lists the episode, or the podcast has left the library. */
    | 'notFound'
    | 'feedUnavailable'
}

/**
 * The `keepEpisode` mutation: stores one episode from a podcast's feed, found
 * by `searchEpisodes`, that the feed's newest (all that subscribing and
 * refreshing store) don't reach. From then on it is an episode like any other:
 * it plays, resumes, queues and downloads, and unsubscribing removes it.
 *
 * The feed is fetched again rather than the episode taken from the caller, so
 * what is stored is what the publisher lists, show notes included. Safe to
 * run again: an episode already stored is brought up to date, not duplicated.
 */
export function createKeepEpisodeHandler({ store }: { store: FeedStore }) {
  return withUrlsRedactedFromErrors(
    'keepEpisode',
    async ({ arguments: { podcastId, episodeId: wanted } }: KeepEpisodeEvent): Promise<KeepEpisodeResult> => {
      const podcast = await store.getPodcast(podcastId)
      if (!podcast) return { outcome: 'notFound' }

      const fetched = await fetchFeed(podcast.feedUrl)
      if (!fetched.ok) return { outcome: 'feedUnavailable' }

      const episode = fetched.feed.episodes.find(({ guid }) => episodeId(podcastId, guid) === wanted)
      if (!episode) return { outcome: 'notFound' }
      await storeEpisode(store, podcastId, episode)
      return { outcome: 'kept' }
    },
  )
}

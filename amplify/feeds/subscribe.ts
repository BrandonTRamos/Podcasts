import type { FeedStore } from './feedStore'
import { normaliseFeedUrl, withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'

export type SubscribeOutcome = 'subscribed' | 'alreadySubscribed' | 'invalidUrl' | 'unreachable' | 'notAFeed'

export interface SubscribeEvent {
  arguments: { feedUrl: string }
}

export interface SubscribeResult {
  outcome: SubscribeOutcome
  /** The new podcast, or the existing one when already subscribed. */
  podcastId: string | null
}

/**
 * Subscribes to a feed. It fetches the feed once to check it is a real podcast
 * feed and to read its title, author and artwork, then creates the podcast and
 * returns. Episodes are ingested by a background refresh, so a feed with
 * thousands of items cannot hold the request up.
 */
export function createSubscribeHandler({ store }: { store: FeedStore }) {
  return withUrlsRedactedFromErrors('subscribe', async (event: SubscribeEvent): Promise<SubscribeResult> => {
    const feedUrl = normaliseFeedUrl(event.arguments.feedUrl)
    if (!feedUrl) return { outcome: 'invalidUrl', podcastId: null }

    const existing = await store.findPodcastByFeedUrl(feedUrl)
    if (existing) return { outcome: 'alreadySubscribed', podcastId: existing.id }

    const fetched = await fetchFeed(feedUrl)
    if (!fetched.ok) return { outcome: fetched.reason, podcastId: null }

    const podcast = await store.createPodcast({
      feedUrl,
      ...fetched.feed.podcast,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastFetchError: null,
    })
    try {
      await store.requestRefresh(podcast.id)
    } catch (error) {
      // A podcast whose episodes will never arrive is broken: take it back out.
      await store.deletePodcast(podcast.id)
      throw error
    }
    return { outcome: 'subscribed', podcastId: podcast.id }
  })
}

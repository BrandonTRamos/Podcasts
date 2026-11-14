import type { FeedStore } from './feedStore'
import { normaliseFeedUrl, withUrlsRedactedFromErrors } from './feedUrl'

export interface SubscribeEvent {
  arguments: { feedUrl: string }
}

export type SubscribeResult =
  /** The feed is being checked and ingested in the background; watch the request for the outcome. */
  | { outcome: 'pending'; requestId: string; podcastId: null }
  | { outcome: 'alreadySubscribed'; requestId: null; podcastId: string }
  | { outcome: 'invalidUrl'; requestId: null; podcastId: null }

/**
 * The `subscribe` mutation. Returns at once: it only checks the URL is http or
 * https and not already in the library, then records a subscribe request.
 * Fetching, checking and ingesting the feed happen in the background (see
 * `ingestFeed.ts`), and the client learns the outcome by watching the request.
 */
export function createSubscribeHandler({ store }: { store: FeedStore }) {
  return withUrlsRedactedFromErrors('subscribe', async (event: SubscribeEvent): Promise<SubscribeResult> => {
    const feedUrl = normaliseFeedUrl(event.arguments.feedUrl)
    if (!feedUrl) return { outcome: 'invalidUrl', requestId: null, podcastId: null }

    const existing = await store.findPodcastByFeedUrl(feedUrl)
    if (existing) return { outcome: 'alreadySubscribed', requestId: null, podcastId: existing.id }

    const request = await store.createSubscribeRequest(feedUrl)
    return { outcome: 'pending', requestId: request.id, podcastId: null }
  })
}

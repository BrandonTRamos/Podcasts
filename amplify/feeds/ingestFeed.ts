import type { FeedHandlerOptions, PodcastRecord, SubscribeRequestRecord } from './feedStore'
import { withUrlsRedactedFromErrors } from './feedUrl'
import { type FeedVersion, fetchFeed } from './fetchFeed'
import type { ParsedFeed } from './parseFeed'
import { storeEpisodes } from './storeEpisodes'

/** The DynamoDB stream event for the subscribe-request table: only the fields used here. */
export interface SubscribeRequestStreamEvent {
  Records: { eventName?: string; dynamodb?: { Keys?: Record<string, { S?: string }> } }[]
}

/**
 * The background half of subscribing, run for each new subscribe request. It
 * fetches and checks the feed, and only if it is a real podcast feed adds the
 * podcast, so a bad feed leaves nothing in the library. It then marks the
 * request with the outcome and ingests the newest `episodeLimit` episodes, so a
 * feed carrying thousands of items is not ingested in full.
 *
 * Safe to run twice for a request: a settled request is not checked again, and
 * re-ingesting a subscribed one creates no duplicate episodes.
 */
export function createIngestFeedHandler({
  store,
  episodeLimit,
  now = () => new Date(),
}: FeedHandlerOptions) {
  async function ingest(request: SubscribeRequestRecord) {
    if (request.status === 'subscribed' && request.podcastId) {
      // A retry after a failure part-way through ingesting episodes.
      const fetched = await fetchFeed(request.feedUrl)
      if (fetched.ok) await storeFeed(request.podcastId, fetched)
      return
    }
    if (request.status !== 'pending') return

    let podcast: PodcastRecord | null = null
    try {
      const fetched = await fetchFeed(request.feedUrl)
      if (!fetched.ok) {
        await store.settleSubscribeRequest(request.id, { status: fetched.reason, podcastId: null })
        return
      }
      // Another request for the same feed may have finished first.
      const existing = await store.findPodcastByFeedUrl(request.feedUrl)
      if (existing) {
        await store.settleSubscribeRequest(request.id, { status: 'alreadySubscribed', podcastId: existing.id })
        return
      }
      podcast = await store.createPodcast({
        feedUrl: request.feedUrl,
        ...fetched.feed.podcast,
        etag: null,
        lastModified: null,
        lastFetchedAt: now().toISOString(),
        lastFetchError: null,
      })
      await store.settleSubscribeRequest(request.id, { status: 'subscribed', podcastId: podcast.id })
      await storeFeed(podcast.id, fetched)
    } catch (error) {
      if (!podcast) await store.settleSubscribeRequest(request.id, { status: 'failed', podcastId: null })
      throw error
    }
  }

  /**
   * Stores the episodes, then remembers the feed's version so the first refresh
   * can ask whether it has changed. Only then: had storing failed part-way, a
   * refresh told "unchanged" would never add the episodes left out.
   */
  async function storeFeed(podcastId: string, fetched: { feed: ParsedFeed; version: FeedVersion }) {
    await storeEpisodes(store, podcastId, fetched.feed.episodes, episodeLimit)
    if (fetched.version.etag || fetched.version.lastModified) await store.updatePodcast(podcastId, fetched.version)
  }

  return withUrlsRedactedFromErrors('ingestFeed', async (event: SubscribeRequestStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      const id = record.dynamodb?.Keys?.id?.S
      if (record.eventName !== 'INSERT' || !id) continue
      const request = await store.getSubscribeRequest(id)
      if (request) await ingest(request)
    }
  })
}

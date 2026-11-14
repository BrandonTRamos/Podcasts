import { createHash } from 'node:crypto'
import type { EpisodeRecord, FeedStore, PodcastRecord, SubscribeRequestRecord } from './feedStore'
import { withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'
import type { ParsedEpisode } from './parseFeed'

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
export function createIngestFeedHandler({ store, episodeLimit }: { store: FeedStore; episodeLimit: number }) {
  async function ingest(request: SubscribeRequestRecord) {
    if (request.status === 'subscribed' && request.podcastId) {
      // A retry after a failure part-way through ingesting episodes.
      const fetched = await fetchFeed(request.feedUrl)
      if (fetched.ok) await addEpisodes(request.podcastId, fetched.feed.episodes)
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
      podcast = await store.createPodcast({ feedUrl: request.feedUrl, ...fetched.feed.podcast })
      await store.settleSubscribeRequest(request.id, { status: 'subscribed', podcastId: podcast.id })
      await addEpisodes(podcast.id, fetched.feed.episodes)
    } catch (error) {
      if (!podcast) await store.settleSubscribeRequest(request.id, { status: 'failed', podcastId: null })
      throw error
    }
  }

  async function addEpisodes(podcastId: string, episodes: ParsedEpisode[]) {
    for (const parsed of newestFirst(episodes).slice(0, episodeLimit)) {
      const episode: EpisodeRecord = { id: episodeId(podcastId, parsed.guid), podcastId, ...parsed }
      if (!(await store.getEpisode(episode.id))) await store.createEpisode(episode)
    }
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

/** Dated episodes newest first, then undated ones in feed order (most feeds list newest first). */
function newestFirst(episodes: ParsedEpisode[]): ParsedEpisode[] {
  const time = (episode: ParsedEpisode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

/** Stable per podcast and GUID, whatever characters the GUID contains. */
function episodeId(podcastId: string, guid: string): string {
  return `${podcastId}:${createHash('sha256').update(guid).digest('hex').slice(0, 32)}`
}

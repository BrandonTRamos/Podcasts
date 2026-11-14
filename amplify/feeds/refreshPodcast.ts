import { createHash } from 'node:crypto'
import type { EpisodeRecord, FeedStore } from './feedStore'
import { withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'
import type { ParsedEpisode } from './parseFeed'

export interface RefreshPodcastEvent {
  arguments: { podcastId: string }
}

/**
 * Feed refresher for one podcast: fetches its feed and upserts the newest
 * `episodeLimit` episodes, so that a feed carrying thousands of items is not
 * ingested in full. Re-running it creates no duplicates.
 */
export function createRefreshPodcastHandler({ store, episodeLimit }: { store: FeedStore; episodeLimit: number }) {
  return withUrlsRedactedFromErrors('refreshPodcast', async (event: RefreshPodcastEvent): Promise<void> => {
    const podcast = await store.getPodcast(event.arguments.podcastId)
    if (!podcast) return

    const fetched = await fetchFeed(podcast.feedUrl)
    if (!fetched.ok) {
      await store.updatePodcast(podcast.id, { lastFetchError: fetchErrors[fetched.reason] })
      return
    }

    for (const parsed of newestFirst(fetched.feed.episodes).slice(0, episodeLimit)) {
      const episode: EpisodeRecord = { id: episodeId(podcast.id, parsed.guid), podcastId: podcast.id, ...parsed }
      const existing = await store.getEpisode(episode.id)
      if (!existing) await store.createEpisode(episode)
    }

    await store.updatePodcast(podcast.id, {
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      lastFetchedAt: new Date().toISOString(),
      lastFetchError: null,
    })
  })
}

/** Recorded against the podcast for the listener to see. They never include the feed URL. */
const fetchErrors = {
  invalidUrl: 'The feed URL is not an http or https URL.',
  unreachable: 'The feed could not be reached.',
  notAFeed: 'The feed is no longer a valid podcast feed.',
} as const

/** Dated episodes newest first, then undated ones in feed order (most feeds list newest first). */
function newestFirst(episodes: ParsedEpisode[]): ParsedEpisode[] {
  const time = (episode: ParsedEpisode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

/** Stable per podcast and GUID, whatever characters the GUID contains. */
function episodeId(podcastId: string, guid: string): string {
  return `${podcastId}:${createHash('sha256').update(guid).digest('hex').slice(0, 32)}`
}

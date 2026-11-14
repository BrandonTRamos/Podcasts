import type { FeedHandlerOptions, PodcastRecord } from './feedStore'
import { redactUrls, withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'
import { storeEpisodes } from './storeEpisodes'

/**
 * What the refresher is invoked with: the `refreshPodcast` mutation's event,
 * with its arguments (AppSync invokes it asynchronously), to refresh one
 * podcast; or the hourly schedule's event, with none, to refresh every podcast.
 */
export interface RefreshFeedsEvent {
  arguments?: { podcastId?: string | null }
}

/** Feeds fetched at once in an hourly run. */
const CONCURRENCY = 5

/**
 * Refreshes podcasts' feeds: every podcast on the hourly schedule, or one on
 * demand. Each feed is fetched with a conditional GET, so one the server says
 * is unchanged is written nothing. A changed feed's newest `episodeLimit`
 * episodes are stored (new ones added, changed ones updated in place), then its
 * podcast's details, version and refresh time.
 *
 * A feed that fails is recorded against its podcast and does not stop the
 * others. If storing a feed fails unexpectedly, the rest are still refreshed
 * and the run then fails, so the failure is seen.
 */
export function createRefreshFeedsHandler({
  store,
  episodeLimit,
  now = () => new Date(),
}: FeedHandlerOptions) {
  async function refresh(podcast: PodcastRecord) {
    const fetched = await fetchFeed(podcast.feedUrl, { etag: podcast.etag, lastModified: podcast.lastModified })

    if (!fetched.ok) {
      // Recorded once: a feed that keeps failing the same way is not written every hour.
      if (podcast.lastFetchError !== fetched.reason) {
        await store.updatePodcast(podcast.id, { lastFetchError: fetched.reason })
      }
      return
    }

    if (!fetched.changed) {
      // Nothing was fetched in full, so `lastFetchedAt` stays; only a recorded failure is cleared.
      if (podcast.lastFetchError !== null) await store.updatePodcast(podcast.id, { lastFetchError: null })
      return
    }

    await storeEpisodes(store, podcast.id, fetched.feed.episodes, episodeLimit)
    // Last, so a run that fails part-way leaves the old version, and the next fetches the feed in full again.
    await store.updatePodcast(podcast.id, {
      ...fetched.feed.podcast,
      ...fetched.version,
      lastFetchedAt: now().toISOString(),
      lastFetchError: null,
    })
  }

  /** Refreshes each podcast, a few at a time. Resolves once all are done; rejects then if any failed unexpectedly. */
  async function refreshEach(podcasts: PodcastRecord[]) {
    const waiting = [...podcasts]
    let failures = 0
    async function worker() {
      for (let podcast = waiting.shift(); podcast; podcast = waiting.shift()) {
        try {
          await refresh(podcast)
        } catch (error) {
          failures++
          console.error(`Refreshing podcast ${podcast.id} failed: ${redactUrls(String(error))}`)
          await store.updatePodcast(podcast.id, { lastFetchError: 'failed' }).catch(() => {})
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (failures) throw new Error(`${failures} of ${podcasts.length} podcasts could not be refreshed`)
  }

  return withUrlsRedactedFromErrors('refreshFeeds', async (event: RefreshFeedsEvent | null): Promise<void> => {
    const podcastId = event?.arguments?.podcastId
    if (podcastId) {
      const podcast = await store.getPodcast(podcastId)
      if (podcast) await refreshEach([podcast])
      return
    }
    await refreshEach(await store.listPodcasts())
  })
}

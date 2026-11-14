import { createIngestFeedHandler } from '../feeds/ingestFeed'
import { createRefreshFeedsHandler } from '../feeds/refreshFeeds'
import { createSubscribeHandler } from '../feeds/subscribe'
import { fakeFeedStore } from './fakes'

/**
 * The feed handlers over one fake store: the `subscribe` mutation, the
 * background ingest the request table's stream triggers, and the refresher
 * (run hourly by the scheduler, and for one podcast by the `refreshPodcast`
 * mutation). The clock reads `now`, which a test may move on.
 */
export function feedHandlers({ episodeLimit = 100 } = {}) {
  const data = fakeFeedStore()
  const clock = { now: new Date('2026-11-14T09:00:00.000Z') }
  const now = () => clock.now
  const subscribeHandler = createSubscribeHandler({ store: data.store })
  const ingest = createIngestFeedHandler({ store: data.store, episodeLimit, now })
  const refresh = createRefreshFeedsHandler({ store: data.store, episodeLimit, now })

  return {
    data,
    clock,
    ingest,
    subscribe: (feedUrl: string) => subscribeHandler({ arguments: { feedUrl } }),
    /** Delivers the stream's pending inserts to the background ingest, as Lambda does. */
    runBackground: () => ingest(data.takeStreamEvent()),
    /** Subscribes and lets the background step finish; returns the settled request. */
    async subscribeAndIngest(feedUrl: string) {
      const { requestId } = await subscribeHandler({ arguments: { feedUrl } })
      await ingest(data.takeStreamEvent())
      return data.request(requestId!)!
    },
    /** The hourly run, as EventBridge Scheduler invokes it (with an empty event). */
    refreshAll: () => refresh({}),
    /** The `refreshPodcast` mutation, as AppSync invokes its handler asynchronously. */
    refreshPodcast: (podcastId: string) => refresh({ arguments: { podcastId } }),
  }
}

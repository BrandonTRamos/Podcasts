import { createIngestFeedHandler } from '../feeds/ingestFeed'
import { createSubscribeHandler } from '../feeds/subscribe'
import { fakeFeedStore } from './fakes'

/**
 * Both halves of subscribing over one fake store: the `subscribe` mutation and
 * the background ingest the request table's stream triggers.
 */
export function subscribeFlow({ episodeLimit = 100 } = {}) {
  const data = fakeFeedStore()
  const subscribeHandler = createSubscribeHandler({ store: data.store })
  const ingest = createIngestFeedHandler({ store: data.store, episodeLimit })

  return {
    data,
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
  }
}

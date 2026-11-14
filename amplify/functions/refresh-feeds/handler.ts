import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createRefreshFeedsHandler, type RefreshFeedsEvent } from '../../feeds/refreshFeeds'

const episodeLimit = Number(process.env.EPISODE_LIMIT)
if (!Number.isInteger(episodeLimit) || episodeLimit < 1) {
  throw new Error('EPISODE_LIMIT must be a positive integer (see refresh-feeds/resource.ts)')
}

const refresh = createRefreshFeedsHandler({ store: await amplifyFeedStore(), episodeLimit })

/** Invoked by the hourly schedule, and asynchronously by the `refreshPodcast` mutation. */
export const handler = (event: RefreshFeedsEvent | null) => refresh(event)

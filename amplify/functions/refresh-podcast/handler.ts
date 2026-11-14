import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createRefreshPodcastHandler } from '../../feeds/refreshPodcast'

const episodeLimit = Number(process.env.EPISODE_LIMIT)
if (!Number.isInteger(episodeLimit) || episodeLimit < 1) {
  throw new Error('EPISODE_LIMIT must be a positive integer (see refresh-podcast/resource.ts)')
}

const refreshPodcast = createRefreshPodcastHandler({ store: await amplifyFeedStore(), episodeLimit })

export const handler: Schema['refreshPodcast']['functionHandler'] = (event) => refreshPodcast(event)

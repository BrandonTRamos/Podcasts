import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createRefreshPodcastHandler } from '../../feeds/refreshPodcast'

const refreshPodcast = createRefreshPodcastHandler({
  store: await amplifyFeedStore(),
  episodeLimit: Number(process.env.EPISODE_LIMIT),
})

export const handler: Schema['refreshPodcast']['functionHandler'] = (event) => refreshPodcast(event)

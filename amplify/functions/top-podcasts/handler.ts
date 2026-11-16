import type { Schema } from '../../data/resource'
import { createTopPodcastsHandler } from '../../directory/topPodcasts'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'

const top = createTopPodcastsHandler({ store: await amplifyFeedStore() })

export const handler: Schema['topPodcasts']['functionHandler'] = (event) => top(event)

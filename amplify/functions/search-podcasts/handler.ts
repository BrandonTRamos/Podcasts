import type { Schema } from '../../data/resource'
import { createSearchPodcastsHandler } from '../../directory/searchPodcasts'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'

const search = createSearchPodcastsHandler({ store: await amplifyFeedStore() })

export const handler: Schema['searchPodcasts']['functionHandler'] = (event) => search(event)

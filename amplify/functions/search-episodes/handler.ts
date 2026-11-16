import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createSearchEpisodesHandler } from '../../feeds/searchEpisodes'

const search = createSearchEpisodesHandler({ store: await amplifyFeedStore() })

export const handler: Schema['searchEpisodes']['functionHandler'] = (event) => search(event)

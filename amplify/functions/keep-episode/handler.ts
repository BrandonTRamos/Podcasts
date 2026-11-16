import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createKeepEpisodeHandler } from '../../feeds/keepEpisode'

const keep = createKeepEpisodeHandler({ store: await amplifyFeedStore() })

export const handler: Schema['keepEpisode']['functionHandler'] = (event) => keep(event)

import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createSubscribeHandler } from '../../feeds/subscribe'

const subscribe = createSubscribeHandler({ store: await amplifyFeedStore() })

export const handler: Schema['subscribe']['functionHandler'] = (event) => subscribe(event)

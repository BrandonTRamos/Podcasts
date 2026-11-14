import type { Schema } from '../../data/resource'
import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createUnsubscribeHandler } from '../../feeds/unsubscribe'

const unsubscribe = createUnsubscribeHandler({ store: await amplifyFeedStore() })

export const handler: Schema['unsubscribe']['functionHandler'] = (event) => unsubscribe(event)

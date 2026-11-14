import { defineFunction } from '@aws-amplify/backend'

/** The `subscribe` mutation: checks a feed and adds the podcast. Episodes follow via `refreshPodcast`. */
export const subscribeFunction = defineFunction({
  name: 'subscribe',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  timeoutSeconds: 30,
})

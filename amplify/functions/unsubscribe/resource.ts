import { defineFunction } from '@aws-amplify/backend'

/** The `unsubscribe` mutation: removes a podcast, its episodes and their listening state. */
export const unsubscribeFunction = defineFunction({
  name: 'unsubscribe',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // As long as AppSync waits for it. One that runs out leaves the podcast, and trying again carries on.
  timeoutSeconds: 30,
})

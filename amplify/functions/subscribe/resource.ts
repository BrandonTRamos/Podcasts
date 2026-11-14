import { defineFunction } from '@aws-amplify/backend'

/** The `subscribe` mutation: checks the URL and records a subscribe request, then returns. */
export const subscribeFunction = defineFunction({
  name: 'subscribe',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  timeoutSeconds: 10,
})

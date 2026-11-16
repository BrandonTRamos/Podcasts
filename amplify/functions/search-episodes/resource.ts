import { defineFunction } from '@aws-amplify/backend'

/** The `searchEpisodes` query: fetches a podcast's feed and finds the episodes in it that match, however old. */
export const searchEpisodesFunction = defineFunction({
  name: 'search-episodes',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // As long as AppSync waits for it: the feed is given 15 seconds to answer, and a long one takes a while to read.
  timeoutSeconds: 30,
  // A feed with thousands of episodes runs to tens of megabytes, held whole and again as parsed.
  memoryMB: 1024,
})

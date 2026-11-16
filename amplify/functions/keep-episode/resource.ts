import { defineFunction } from '@aws-amplify/backend'

/** The `keepEpisode` mutation: stores one episode, found by `searchEpisodes`, from further back in a feed than is kept. */
export const keepEpisodeFunction = defineFunction({
  name: 'keep-episode',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // As long as AppSync waits for it: the feed is given 15 seconds to answer, and a long one takes a while to read.
  timeoutSeconds: 30,
  // A feed with thousands of episodes runs to tens of megabytes, held whole and again as parsed.
  memoryMB: 1024,
})

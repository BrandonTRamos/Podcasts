import { defineFunction } from '@aws-amplify/backend'

/** The `searchPodcasts` query: asks the public podcast directory, and marks the results already in the library. */
export const searchPodcastsFunction = defineFunction({
  name: 'search-podcasts',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // The directory is given 8 seconds to answer.
  timeoutSeconds: 15,
})

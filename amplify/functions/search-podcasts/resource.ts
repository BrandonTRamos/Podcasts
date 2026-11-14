import { defineFunction } from '@aws-amplify/backend'

/** The `searchPodcasts` query: asks the public podcast directory, and marks the results already in the library. */
export const searchPodcastsFunction = defineFunction({
  name: 'search-podcasts',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // Longer than the directory is given to answer (see directory/searchPodcasts.ts).
  timeoutSeconds: 15,
})

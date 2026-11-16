import { defineFunction } from '@aws-amplify/backend'

/** The `topPodcasts` query: reads one of the public podcast directory's charts, and marks the podcasts already in the library. */
export const topPodcastsFunction = defineFunction({
  name: 'top-podcasts',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // Longer than the directory is given to answer twice over (see directory/topPodcasts.ts).
  timeoutSeconds: 25,
})

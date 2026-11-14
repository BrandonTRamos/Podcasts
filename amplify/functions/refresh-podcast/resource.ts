import { defineFunction } from '@aws-amplify/backend'

/**
 * Most episodes taken from one feed. Some feeds carry thousands, so the first
 * ingest takes only the newest this many. Change it here to configure the cap.
 */
export const EPISODE_LIMIT = 100

/** The async `refreshPodcast` mutation: fetches one podcast's feed and ingests its episodes. */
export const refreshPodcastFunction = defineFunction({
  name: 'refresh-podcast',
  entry: './handler.ts',
  // Calls the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  timeoutSeconds: 300,
  environment: { EPISODE_LIMIT: String(EPISODE_LIMIT) },
})

import { defineFunction } from '@aws-amplify/backend'

/**
 * Most episodes taken from a feed on subscribing. Some feeds carry thousands,
 * so the first ingest takes only the newest this many. Change it here to
 * configure the cap.
 */
export const FIRST_INGEST_EPISODE_LIMIT = 100

/**
 * The background half of subscribing: run for each new subscribe request by the
 * request table's stream (wired in `backend.ts`). Checks the feed, adds the
 * podcast and ingests its episodes.
 */
export const ingestFeedFunction = defineFunction({
  name: 'ingest-feed',
  entry: './handler.ts',
  // Triggered by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  timeoutSeconds: 300,
  environment: { FIRST_INGEST_EPISODE_LIMIT: String(FIRST_INGEST_EPISODE_LIMIT) },
})

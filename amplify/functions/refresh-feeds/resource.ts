import { defineFunction } from '@aws-amplify/backend'
import { FIRST_INGEST_EPISODE_LIMIT } from '../ingest-feed/resource'

/**
 * Refreshes feeds: every subscribed podcast each hour (EventBridge Scheduler),
 * and one podcast when the `refreshPodcast` mutation asks (invoked
 * asynchronously, so the mutation returns at once). Each refresh looks at the
 * newest `EPISODE_LIMIT` items of a feed, the same cap as the first ingest.
 */
export const refreshFeedsFunction = defineFunction({
  name: 'refresh-feeds',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  schedule: 'every 1h',
  // Feeds are fetched a few at a time, each with a 15-second timeout.
  timeoutSeconds: 900,
  environment: { EPISODE_LIMIT: String(FIRST_INGEST_EPISODE_LIMIT) },
})

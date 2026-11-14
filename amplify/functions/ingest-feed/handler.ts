import { amplifyFeedStore } from '../../feeds/amplifyFeedStore'
import { createIngestFeedHandler } from '../../feeds/ingestFeed'

const episodeLimit = Number(process.env.FIRST_INGEST_EPISODE_LIMIT)
if (!Number.isInteger(episodeLimit) || episodeLimit < 1) {
  throw new Error('FIRST_INGEST_EPISODE_LIMIT must be a positive integer (see ingest-feed/resource.ts)')
}

export const handler = createIngestFeedHandler({ store: await amplifyFeedStore(), episodeLimit })

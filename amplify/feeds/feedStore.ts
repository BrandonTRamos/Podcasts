/**
 * The feed handlers' boundary with the data API. `amplifyFeedStore.ts`
 * implements it against AppSync (so that clients' data subscriptions see every
 * write); backend tests substitute an in-memory fake.
 */

export interface PodcastRecord {
  id: string
  /** Treated as a secret: private feeds carry access tokens. Never logged. */
  feedUrl: string
  title: string
  author: string | null
  artworkUrl: string | null
}

export interface EpisodeRecord {
  /** Derived from the podcast and the item's GUID, so re-ingesting is idempotent. */
  id: string
  podcastId: string
  /** The item's GUID, or its enclosure URL when the feed gives none. */
  guid: string
  title: string
  publishedAt: string | null
  durationSeconds: number | null
  enclosureUrl: string
  enclosureType: string | null
  showNotes: string | null
}

/** How a subscribe request ended, or `pending` while the background check runs. */
export type SubscribeStatus =
  | 'pending'
  | 'subscribed'
  | 'alreadySubscribed'
  | 'invalidUrl'
  | 'unreachable'
  | 'notAFeed'
  | 'failed'

/**
 * One subscribe in progress. Creating it is what starts the background ingest
 * (the table's stream triggers it); the client watches it for the outcome.
 */
export interface SubscribeRequestRecord {
  id: string
  feedUrl: string
  status: SubscribeStatus
  /** Set once the request ends with `subscribed` or `alreadySubscribed`. */
  podcastId: string | null
}

export interface FeedStore {
  findPodcastByFeedUrl(feedUrl: string): Promise<PodcastRecord | null>
  createPodcast(podcast: Omit<PodcastRecord, 'id'>): Promise<PodcastRecord>
  getEpisode(id: string): Promise<EpisodeRecord | null>
  /** Fails if an episode with this ID already exists. */
  createEpisode(episode: EpisodeRecord): Promise<void>
  createSubscribeRequest(feedUrl: string): Promise<SubscribeRequestRecord>
  getSubscribeRequest(id: string): Promise<SubscribeRequestRecord | null>
  settleSubscribeRequest(id: string, outcome: { status: SubscribeStatus; podcastId: string | null }): Promise<void>
}

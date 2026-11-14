/**
 * The backend handlers' boundary with the data API. `amplifyFeedStore.ts`
 * implements it against AppSync (so that clients' data subscriptions see every
 * write); backend tests substitute an in-memory fake.
 */

/** Why the last refresh of a feed failed: the fetch reasons from `fetchFeed`, or an unexpected error. */
export type FeedError = 'invalidUrl' | 'unreachable' | 'notAFeed' | 'failed'

export interface PodcastRecord {
  id: string
  /** Treated as a secret: private feeds carry access tokens. Never logged. */
  feedUrl: string
  title: string
  author: string | null
  artworkUrl: string | null
  /** The feed's version as last fetched in full, sent back to ask whether it has changed since. */
  etag: string | null
  lastModified: string | null
  /** When the feed was last fetched in full (ISO 8601). A feed found unchanged leaves it. */
  lastFetchedAt: string | null
  /** Why the latest attempt to refresh the feed failed; null when it succeeded. */
  lastFetchError: FeedError | null
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
  /** Every podcast in the library. */
  listPodcasts(): Promise<PodcastRecord[]>
  getPodcast(id: string): Promise<PodcastRecord | null>
  createPodcast(podcast: Omit<PodcastRecord, 'id'>): Promise<PodcastRecord>
  /** Changes only the given fields. */
  updatePodcast(id: string, changes: Partial<Omit<PodcastRecord, 'id' | 'feedUrl'>>): Promise<void>
  /**
   * The production store may write too, the first time, to bring an episode
   * stored under an older schema up to date (see `amplifyFeedStore.ts`).
   */
  getEpisode(id: string): Promise<EpisodeRecord | null>
  /** Fails if an episode with this ID already exists. */
  createEpisode(episode: EpisodeRecord): Promise<void>
  /** Replaces an existing episode's fields. */
  updateEpisode(episode: EpisodeRecord): Promise<void>
  createSubscribeRequest(feedUrl: string): Promise<SubscribeRequestRecord>
  getSubscribeRequest(id: string): Promise<SubscribeRequestRecord | null>
  settleSubscribeRequest(id: string, outcome: { status: SubscribeStatus; podcastId: string | null }): Promise<void>
  /** Removes the podcast record alone. Does nothing if there is none. */
  deletePodcast(id: string): Promise<void>
  /** The IDs of every episode stored for the podcast. */
  listEpisodeIds(podcastId: string): Promise<string[]>
  /** Does nothing if there is no such episode. */
  deleteEpisode(id: string): Promise<void>
  /** The IDs of the listening states (each its episode's ID) kept for the podcast's episodes. */
  listEpisodeStateIds(podcastId: string): Promise<string[]>
  /** Does nothing if there is no such state. */
  deleteEpisodeState(id: string): Promise<void>
}

/** What the feed handlers that store episodes are built with. */
export interface FeedHandlerOptions {
  store: FeedStore
  /** Most items taken from a feed: the newest this many. */
  episodeLimit: number
  /** The clock, for refresh times. */
  now?: () => Date
}

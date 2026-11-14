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
  etag: string | null
  lastModified: string | null
  /** When episodes were last ingested. Null until the first ingest finishes. */
  lastFetchedAt: string | null
  lastFetchError: string | null
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

export type NewPodcast = Omit<PodcastRecord, 'id'>
export type PodcastChanges = Partial<NewPodcast>

export interface FeedStore {
  findPodcastByFeedUrl(feedUrl: string): Promise<PodcastRecord | null>
  getPodcast(id: string): Promise<PodcastRecord | null>
  createPodcast(podcast: NewPodcast): Promise<PodcastRecord>
  updatePodcast(id: string, changes: PodcastChanges): Promise<void>
  getEpisode(id: string): Promise<EpisodeRecord | null>
  /** Fails if an episode with this ID already exists. */
  createEpisode(episode: EpisodeRecord): Promise<void>
  /** Starts a background refresh of one podcast (the data API's async `refreshPodcast`). */
  requestRefresh(podcastId: string): Promise<void>
}

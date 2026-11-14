/**
 * The client's boundary with the outside world: the backend, the browser's
 * audio element and the OS media controls. The UI depends only on these
 * interfaces; `amplifyServices.ts` implements auth and data against Cognito
 * and the data API, `main.tsx` passes a plain `<audio>` element and the
 * browser's media session, and tests substitute in-memory fakes.
 */

export interface User {
  email: string
}

export type SignInResult = { ok: true; user: User } | { ok: false; message: string }

export interface AuthService {
  /** The signed-in user from a stored session, or null when signed out. */
  currentUser(): Promise<User | null>
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
}

/** Why the latest refresh of a podcast's feed failed. */
export type FeedError = 'invalidUrl' | 'unreachable' | 'notAFeed' | 'failed'

export interface Podcast {
  id: string
  title: string
  author: string | null
  artworkUrl: string | null
  /** When the feed was last fetched in full (ISO 8601); null if never. A check that finds it unchanged leaves this. */
  lastFetchedAt: string | null
  /** Why the latest refresh failed; null if it succeeded. */
  lastFetchError: FeedError | null
}

export interface Episode {
  id: string
  podcastId: string
  title: string
  publishedAt: string | null
  durationSeconds: number | null
  /** The audio file on the publisher's host. Streamed from there directly. */
  enclosureUrl: string
}

/** The listener's place in an episode and whether they have heard it. Synced across devices. */
export interface EpisodeState {
  episodeId: string
  podcastId: string
  /** Seconds from the start. */
  positionSeconds: number
  played: boolean
  /**
   * Where it stands in the queue: queued episodes play lowest first. Null when
   * it is not queued. Fractional, so moving one episode is a single write.
   */
  queueOrder: number | null
}

/** Some fields of an episode's listening state, to change while leaving the others as they are. */
export type EpisodeStateChange = Partial<Pick<EpisodeState, 'positionSeconds' | 'played' | 'queueOrder'>>

export interface SavedEpisodeState extends EpisodeState {
  /** When the backend stored it (ISO 8601). The later of two saves wins. */
  updatedAt: string
}

/** An episode in the queue, with the listening state that places it there. */
export interface QueuedEpisode {
  episode: Episode
  state: SavedEpisodeState
}

/** The whole queue, as one delivery of it shows it. */
export interface QueueSnapshot {
  entries: QueuedEpisode[]
  /**
   * The latest save it takes account of (ISO 8601): an episode missing from it
   * has left the queue only if it was saved as queued before then. Null for a
   * fresh fetch, which takes account of every save so far.
   */
  asOf: string | null
}

/** What the subscribe call says straight away. */
export type SubscribeStart =
  /** The feed is being checked in the background: watch the request for the outcome. */
  | { outcome: 'pending'; requestId: string }
  | { outcome: 'alreadySubscribed'; podcastId: string }
  | { outcome: 'invalidUrl' }

/** A subscribe request as the background check moves it on. */
export type SubscribeRequestState =
  | { status: 'pending' }
  | { status: 'subscribed' | 'alreadySubscribed'; podcastId: string }
  | { status: 'invalidUrl' | 'unreachable' | 'notAFeed' | 'failed' }

export const LATEST_EPISODES_LIMIT = 50

export interface Observer<T> {
  next(value: T): void
  error(): void
}

export interface DataApi {
  /** The library, kept current as podcasts are added. Returns a function that stops observing. */
  observePodcasts(observer: Observer<Podcast[]>): () => void
  /** One podcast's episodes, in no particular order, kept current as they are ingested. */
  observeEpisodes(podcastId: string, observer: Observer<Episode[]>): () => void
  /**
   * The newest dated episodes across every podcast, newest first, up to
   * `LATEST_EPISODES_LIMIT` of them, kept current as new ones are found.
   * Episodes without a publish date are left out.
   */
  observeLatestEpisodes(observer: Observer<Episode[]>): () => void
  /**
   * Asks for the podcast's feed to be refreshed. Returns once asked; the refresh
   * runs in the background, and its outcome arrives through `observePodcasts`
   * (the refresh time or error) and `observeEpisodes` (new episodes). A feed
   * found unchanged changes nothing, so nothing arrives.
   */
  refreshPodcast(podcastId: string): Promise<void>
  /** Returns at once; the feed is fetched and checked in the background. */
  subscribeToFeed(feedUrl: string): Promise<SubscribeStart>
  /** A subscribe request's state, now and as it changes. */
  observeSubscribeRequest(requestId: string, observer: Observer<SubscribeRequestState>): () => void
  /**
   * The listening state of one podcast's episodes, all of it once fetched and
   * then as any device saves it. Episodes never played have none.
   */
  observeEpisodeStates(podcastId: string, observer: Observer<SavedEpisodeState[]>): () => void
  /**
   * Changes only the given fields of an episode's listening state, so a change
   * made elsewhere to another field survives. An episode with no state yet
   * starts at the beginning, unplayed. Returns the whole state as saved.
   */
  saveEpisodeState(episodeId: string, podcastId: string, change: EpisodeStateChange): Promise<SavedEpisodeState>
  /**
   * Every queued episode, whatever its podcast, with its details and listening
   * state: all of them once fetched, then again whenever any device changes the
   * queue. Each delivery is the whole queue, so an episode missing from it has
   * left (see `QueueSnapshot.asOf`).
   */
  observeQueue(observer: Observer<QueueSnapshot>): () => void
}

/**
 * The parts of a plain HTML audio element the player uses. Playback goes
 * through an `<audio>` element, never the Web Audio API, which iOS suspends
 * in the background.
 */
export interface AudioElement extends EventTarget {
  src: string
  currentTime: number
  /** 1 is normal speed. A new load resets it to `defaultPlaybackRate`. */
  playbackRate: number
  defaultPlaybackRate: number
  /** NaN until the file's metadata has loaded; Infinity for an endless stream. */
  readonly duration: number
  readonly paused: boolean
  /** True once playback has reached the end, until it is played or sought again. */
  readonly ended: boolean
  play(): Promise<void>
  pause(): void
  /** With `removeAttribute('src')`, unloads the file and stops fetching it. */
  load(): void
  removeAttribute(name: 'src'): void
}

/**
 * The OS media controls: lock screen, notification centre, and headphone and
 * Bluetooth buttons. A thin wrapper over `navigator.mediaSession`
 * (`browserMediaSession` in `mediaSession.ts`), with plain data for metadata.
 */
export interface MediaSessionControls {
  /** What is playing, or null for nothing. */
  setMetadata(metadata: MediaMetadataInit | null): void
  setPlaybackState(state: MediaSessionPlaybackState): void
  /** Position, length and rate, from which the OS draws its progress bar; null clears it. */
  setPositionState(state: MediaPositionState | null): void
  /** A null handler removes the control. */
  setActionHandler(action: MediaSessionAction, handler: ((details: MediaSessionActionDetails) => void) | null): void
}

export interface Services {
  auth: AuthService
  data: DataApi
  /** The one audio element the app plays through, for its whole lifetime. */
  audio: AudioElement
  mediaSession: MediaSessionControls
}

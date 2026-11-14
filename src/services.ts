/**
 * The client's boundary with the outside world: the backend and the browser's
 * audio element. The UI depends only on these interfaces; `amplifyServices.ts`
 * implements auth and data against Cognito and the data API, `main.tsx` passes
 * a plain `<audio>` element, and tests substitute in-memory fakes.
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

export interface Podcast {
  id: string
  title: string
  author: string | null
  artworkUrl: string | null
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

export interface Observer<T> {
  next(value: T): void
  error(): void
}

export interface DataApi {
  /** The library, kept current as podcasts are added. Returns a function that stops observing. */
  observePodcasts(observer: Observer<Podcast[]>): () => void
  /** One podcast's episodes, in no particular order, kept current as they are ingested. */
  observeEpisodes(podcastId: string, observer: Observer<Episode[]>): () => void
  /** Returns at once; the feed is fetched and checked in the background. */
  subscribeToFeed(feedUrl: string): Promise<SubscribeStart>
  /** A subscribe request's state, now and as it changes. */
  observeSubscribeRequest(requestId: string, observer: Observer<SubscribeRequestState>): () => void
}

/**
 * The parts of a plain HTML audio element the player uses. Playback goes
 * through an `<audio>` element, never the Web Audio API, which iOS suspends
 * in the background.
 */
export interface AudioElement extends EventTarget {
  src: string
  currentTime: number
  /** NaN until the file's metadata has loaded; Infinity for an endless stream. */
  readonly duration: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
  /** With `removeAttribute('src')`, unloads the file and stops fetching it. */
  load(): void
  removeAttribute(name: 'src'): void
}

export interface Services {
  auth: AuthService
  data: DataApi
  /** The one audio element the app plays through, for its whole lifetime. */
  audio: AudioElement
}

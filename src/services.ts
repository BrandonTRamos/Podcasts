/**
 * The client's boundary with the backend. The UI depends only on these
 * interfaces; `amplifyServices.ts` implements them against Cognito and the
 * data API, and tests substitute in-memory fakes.
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

export interface Services {
  auth: AuthService
  data: DataApi
}

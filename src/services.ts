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
  /** When episodes were last ingested. Null until the first ingest after subscribing finishes. */
  lastFetchedAt: string | null
}

export interface Episode {
  id: string
  podcastId: string
  title: string
  publishedAt: string | null
  durationSeconds: number | null
}

export type SubscribeResult =
  | { outcome: 'subscribed' | 'alreadySubscribed'; podcastId: string }
  | { outcome: 'invalidUrl' | 'unreachable' | 'notAFeed' }

/** Receives the full current list each time it changes. */
export interface ListObserver<T> {
  next(items: T[]): void
  error(): void
}

export interface DataApi {
  /** The library, kept current as podcasts are added. Returns a function that stops observing. */
  observePodcasts(observer: ListObserver<Podcast>): () => void
  /** One podcast's episodes, in no particular order, kept current as they are ingested. */
  observeEpisodes(podcastId: string, observer: ListObserver<Episode>): () => void
  /** Returns once the podcast is in the library; its episodes follow through `observeEpisodes`. */
  subscribeToFeed(feedUrl: string): Promise<SubscribeResult>
}

export interface Services {
  auth: AuthService
  data: DataApi
}

import type {
  AuthService,
  DataApi,
  Episode,
  ListObserver,
  Podcast,
  SignInResult,
  SubscribeResult,
  User,
} from '../services'

const SESSION_KEY = 'fake-auth-session'

/**
 * In-memory stand-in for Cognito. Like Amplify, it keeps the session in
 * `localStorage`, so rendering a fresh `<App>` behaves like a page reload.
 */
export function fakeAuth(account: { email: string; password: string }): AuthService {
  return {
    async currentUser() {
      const stored = localStorage.getItem(SESSION_KEY)
      return stored ? (JSON.parse(stored) as User) : null
    },
    async signIn(email, password): Promise<SignInResult> {
      if (email !== account.email || password !== account.password) {
        return { ok: false, message: 'Incorrect email or password.' }
      }
      const user = { email }
      localStorage.setItem(SESSION_KEY, JSON.stringify(user))
      return { ok: true, user }
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY)
    },
  }
}

type ListenerSet<T> = Set<ListObserver<T>>

/**
 * In-memory stand-in for the data API and the backend behind it. Feeds the
 * fake "internet" knows are added with `publishFeed`; subscribing to any other
 * URL fails as unreachable. `ingest` delivers episodes the way the background
 * refresh does, to whoever is observing.
 */
export function fakeDataApi() {
  const podcasts: (Podcast & { feedUrl: string })[] = []
  const episodes: Episode[] = []
  const feeds = new Map<string, Pick<Podcast, 'title' | 'author' | 'artworkUrl'>>()
  const notFeeds = new Set<string>()
  const podcastListeners: ListenerSet<Podcast> = new Set()
  const episodeListeners = new Map<string, ListenerSet<Episode>>()
  let failNext = false
  let nextId = 1

  const publicPodcasts = () => podcasts.map(({ feedUrl: _feedUrl, ...podcast }) => podcast)
  const notifyPodcasts = () => podcastListeners.forEach((listener) => listener.next(publicPodcasts()))
  const notifyEpisodes = (podcastId: string) =>
    episodeListeners.get(podcastId)?.forEach((listener) => listener.next(episodesOf(podcastId)))
  const episodesOf = (podcastId: string) => episodes.filter((episode) => episode.podcastId === podcastId)

  const api: DataApi = {
    observePodcasts(observer) {
      podcastListeners.add(observer)
      queueMicrotask(() => podcastListeners.has(observer) && observer.next(publicPodcasts()))
      return () => podcastListeners.delete(observer)
    },
    observeEpisodes(podcastId, observer) {
      const listeners = episodeListeners.get(podcastId) ?? new Set()
      episodeListeners.set(podcastId, listeners.add(observer))
      queueMicrotask(() => listeners.has(observer) && observer.next(episodesOf(podcastId)))
      return () => listeners.delete(observer)
    },
    async subscribeToFeed(feedUrl): Promise<SubscribeResult> {
      if (failNext) {
        failNext = false
        throw new Error('Network error')
      }
      if (!/^https?:\/\//.test(feedUrl)) return { outcome: 'invalidUrl' }
      const existing = podcasts.find((podcast) => podcast.feedUrl === feedUrl)
      if (existing) return { outcome: 'alreadySubscribed', podcastId: existing.id }
      if (notFeeds.has(feedUrl)) return { outcome: 'notAFeed' }
      const feed = feeds.get(feedUrl)
      if (!feed) return { outcome: 'unreachable' }
      const podcast = { id: `podcast-${nextId++}`, feedUrl, ...feed, lastFetchedAt: null, lastFetchError: null }
      podcasts.push(podcast)
      notifyPodcasts()
      return { outcome: 'subscribed', podcastId: podcast.id }
    },
  }

  return Object.assign(api, {
    /** Makes a feed reachable. */
    publishFeed(feedUrl: string, podcast: Pick<Podcast, 'title'> & Partial<Pick<Podcast, 'author' | 'artworkUrl'>>) {
      feeds.set(feedUrl, { author: null, artworkUrl: null, ...podcast })
    },
    /** Makes a URL reachable but not a podcast feed (a web page, say). */
    publishWebPage(url: string) {
      notFeeds.add(url)
    },
    /** The next request fails as if the network were down. */
    failNextRequest() {
      failNext = true
    },
    podcastIdFor(feedUrl: string) {
      return podcasts.find((podcast) => podcast.feedUrl === feedUrl)?.id
    },
    /** Records a failed ingest against the podcast, as the background refresh does. */
    failIngest(podcastId: string, message: string) {
      const podcast = podcasts.find((p) => p.id === podcastId)
      if (podcast) podcast.lastFetchError = message
      notifyPodcasts()
    },
    /** Delivers ingested episodes, as the background refresh does after subscribing. */
    ingest(podcastId: string, newEpisodes: Omit<Episode, 'podcastId' | 'id'>[]) {
      for (const episode of newEpisodes) episodes.push({ id: `episode-${nextId++}`, podcastId, ...episode })
      const podcast = podcasts.find((p) => p.id === podcastId)
      if (podcast) podcast.lastFetchedAt = new Date().toISOString()
      notifyPodcasts()
      notifyEpisodes(podcastId)
    },
  })
}

export type FakeDataApi = ReturnType<typeof fakeDataApi>

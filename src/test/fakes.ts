import type {
  AuthService,
  DataApi,
  Episode,
  Observer,
  Podcast,
  SignInResult,
  SubscribeRequestState,
  SubscribeStart,
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

/**
 * In-memory stand-in for the data API and the backend behind it. Feeds the
 * fake "internet" knows are added with `publishFeed`; a subscribe to any other
 * URL ends as unreachable. Subscribing returns a pending request, as the real
 * API does; `finishSubscribing` runs the background check, and `ingest`
 * delivers episodes, to whoever is observing.
 */
export function fakeDataApi() {
  const podcasts: (Podcast & { feedUrl: string })[] = []
  const episodes: Episode[] = []
  const feeds = new Map<string, Pick<Podcast, 'title' | 'author' | 'artworkUrl'> | 'notAFeed' | 'failed'>()
  const requests = new Map<string, { feedUrl: string; state: SubscribeRequestState }>()
  const podcastListeners = new Set<Observer<Podcast[]>>()
  const episodeListeners = new Map<string, Set<Observer<Episode[]>>>()
  const requestListeners = new Map<string, Set<Observer<SubscribeRequestState>>>()
  let failNext = false
  let nextId = 1

  const publicPodcasts = () => podcasts.map(({ feedUrl: _feedUrl, ...podcast }) => podcast)
  const episodesOf = (podcastId: string) => episodes.filter((episode) => episode.podcastId === podcastId)
  const notifyPodcasts = () => podcastListeners.forEach((listener) => listener.next(publicPodcasts()))

  function listen<T>(listeners: Set<Observer<T>>, observer: Observer<T>, current: () => T) {
    listeners.add(observer)
    queueMicrotask(() => listeners.has(observer) && observer.next(current()))
    return () => void listeners.delete(observer)
  }

  function addPodcast(feedUrl: string, feed: Pick<Podcast, 'title' | 'author' | 'artworkUrl'>) {
    const podcast = { id: `podcast-${nextId++}`, feedUrl, ...feed }
    podcasts.push(podcast)
    notifyPodcasts()
    return podcast.id
  }

  function settle(requestId: string, state: SubscribeRequestState) {
    requests.get(requestId)!.state = state
    requestListeners.get(requestId)?.forEach((listener) => listener.next(state))
  }

  const api: DataApi = {
    observePodcasts(observer) {
      return listen(podcastListeners, observer, publicPodcasts)
    },
    observeEpisodes(podcastId, observer) {
      const listeners = episodeListeners.get(podcastId) ?? new Set()
      episodeListeners.set(podcastId, listeners)
      return listen(listeners, observer, () => episodesOf(podcastId))
    },
    async subscribeToFeed(feedUrl): Promise<SubscribeStart> {
      if (failNext) {
        failNext = false
        throw new Error('Network error')
      }
      if (!/^https?:\/\//.test(feedUrl)) return { outcome: 'invalidUrl' }
      const existing = podcasts.find((podcast) => podcast.feedUrl === feedUrl)
      if (existing) return { outcome: 'alreadySubscribed', podcastId: existing.id }
      const requestId = `request-${nextId++}`
      requests.set(requestId, { feedUrl, state: { status: 'pending' } })
      return { outcome: 'pending', requestId }
    },
    observeSubscribeRequest(requestId, observer) {
      const listeners = requestListeners.get(requestId) ?? new Set()
      requestListeners.set(requestId, listeners)
      return listen(listeners, observer, () => requests.get(requestId)!.state)
    },
  }

  return Object.assign(api, {
    /** Makes a feed reachable. */
    publishFeed(feedUrl: string, podcast: Pick<Podcast, 'title'> & Partial<Pick<Podcast, 'author' | 'artworkUrl'>>) {
      feeds.set(feedUrl, { author: null, artworkUrl: null, ...podcast })
    },
    /** Makes a URL reachable but not a podcast feed (a web page, say). */
    publishWebPage(url: string) {
      feeds.set(url, 'notAFeed')
    },
    /** The background check for this URL fails unexpectedly. */
    breakBackgroundFor(url: string) {
      feeds.set(url, 'failed')
    },
    /** The next request fails as if the network were down. */
    failNextRequest() {
      failNext = true
    },
    /** Runs the background check of every pending subscribe, as the backend does. */
    finishSubscribing() {
      for (const [requestId, { feedUrl, state }] of requests) {
        if (state.status !== 'pending') continue
        const feed = feeds.get(feedUrl)
        if (feed === undefined) settle(requestId, { status: 'unreachable' })
        else if (typeof feed === 'string') settle(requestId, { status: feed })
        else settle(requestId, { status: 'subscribed', podcastId: addPodcast(feedUrl, feed) })
      }
    },
    /** A podcast already in the library. Returns its ID. */
    seedPodcast(feedUrl: string, podcast: Pick<Podcast, 'title'> & Partial<Pick<Podcast, 'author' | 'artworkUrl'>>) {
      return addPodcast(feedUrl, { author: null, artworkUrl: null, ...podcast })
    },
    podcastIdFor(feedUrl: string) {
      return podcasts.find((podcast) => podcast.feedUrl === feedUrl)?.id
    },
    /** Delivers ingested episodes, as the background step does after adding the podcast. */
    ingest(podcastId: string, newEpisodes: Omit<Episode, 'podcastId' | 'id'>[]) {
      for (const episode of newEpisodes) episodes.push({ id: `episode-${nextId++}`, podcastId, ...episode })
      episodeListeners.get(podcastId)?.forEach((listener) => listener.next(episodesOf(podcastId)))
    },
  })
}

export type FakeDataApi = ReturnType<typeof fakeDataApi>

import {
  type AudioElement,
  type AuthService,
  type DataApi,
  type Device,
  type DeviceFiles,
  type DeviceStorage,
  type Category,
  type DirectoryGenre,
  type DirectoryPodcast,
  type Episode,
  type EpisodeSearch,
  type EpisodeState,
  type EpisodeStateChange,
  type FeedError,
  type Fetch,
  type FileAppender,
  type InProgressEpisode,
  type MediaSessionControls,
  type Observer,
  type Podcast,
  type PodcastSearch,
  type QueuedEpisode,
  type QueueSnapshot,
  type SavedEpisodeState,
  type ScreenHold,
  type SettledStaging,
  type SignInResult,
  type StagingState,
  type StoredSession,
  type SubscribeRequestState,
  type SubscribeStart,
  type User,
  LATEST_EPISODES_LIMIT,
} from '../services'
import { isInProgress, newestFirst } from '../episodes'
import { createPlaybackLog, memoryText } from '../playbackLog'
import { wordMatcher } from '../../amplify/feeds/matchWords'

const SESSION_KEY = 'fake-auth-session'

interface FakeSession {
  user: User
  /** Its tokens have expired: renewing them needs the network. */
  expired?: boolean
  /** It can be renewed; false once its refresh token has expired too. */
  renewable?: boolean
}

function readSession(): FakeSession | null {
  const stored = localStorage.getItem(SESSION_KEY)
  return stored ? (JSON.parse(stored) as FakeSession) : null
}

/**
 * In-memory stand-in for Cognito. Like Amplify, it keeps the session in
 * `localStorage`, so rendering a fresh `<App>` behaves like a page reload.
 * A session can be expired (`expireSession`), as it does after an hour;
 * confirming it then renews it, which needs the `device` to be online.
 */
export function fakeAuth(account: { email: string; password: string }, { device }: { device?: Pick<Device, 'isOnline'> } = {}) {
  return {
    async storedSession(): Promise<StoredSession> {
      const session = readSession()
      if (!session) return { status: 'signedOut' }
      if (session.expired) {
        if (device && !device.isOnline()) return { status: 'unconfirmed' }
        if (session.renewable === false) {
          localStorage.removeItem(SESSION_KEY)
          return { status: 'signedOut' }
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify({ user: session.user }))
      }
      return { status: 'signedIn', user: session.user }
    },
    async signIn(email: string, password: string): Promise<SignInResult> {
      if (email !== account.email || password !== account.password) {
        return { ok: false, message: 'Incorrect email or password.' }
      }
      const user = { email }
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user }))
      return { ok: true, user }
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY)
    },
    /**
     * The stored session's tokens expire, as they do an hour after they were
     * issued. Unless `renewable` is false (its refresh token has expired too),
     * the next check online renews it.
     */
    expireSession({ renewable = true }: { renewable?: boolean } = {}) {
      const session = readSession()
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expired: true, renewable }))
    },
  } satisfies AuthService & Record<string, unknown>
}

/** A device's connection to the fake backend. */
interface Connection {
  /** Its live updates are not arriving, as when iOS suspends a backgrounded app. */
  asleep: boolean
  /** This device alone has lost its network. */
  offline: boolean
}

/**
 * In-memory stand-in for the data API and the backend behind it. Feeds the
 * fake "internet" knows are added with `publishFeed`; a subscribe to any other
 * URL ends as unreachable. Subscribing returns a pending request, as the real
 * API does; `finishSubscribing` runs the background check, and `ingest`
 * delivers episodes, to whoever is observing.
 *
 * The returned API is one device's view of the backend; `anotherDevice` gives
 * a second view of the same data, as another phone or computer would have. A
 * device that is `asleep` misses live updates, and does not get them later.
 * `goOffline` takes the network away from every device at once, ending every
 * live observation with an error, as a dropped connection does; `goOnline`
 * brings it back, for new observations. A device's `disconnect` and
 * `reconnect` do the same for that device alone.
 *
 * Of two saves to an episode's listening state, the one whose change was made
 * later wins, whichever arrives last.
 */
export function fakeDataApi() {
  const podcasts: (Podcast & { feedUrl: string })[] = []
  const episodes: Episode[] = []
  /** Each episode's show notes, by ID, kept apart as the client fetches them apart. */
  const showNotes = new Map<string, string | null>()
  /** Episodes each podcast's feed lists further back than the library keeps, until one is kept. */
  const olderEpisodes: Episode[] = []
  /** The podcasts whose feeds can't be fetched just now. */
  const unreachableFeeds = new Set<string>()
  /** Every search of a feed for episodes, in order. */
  const episodeSearches: { podcastId: string; term: string }[] = []
  /** The episode searches asked for and not yet answered, while they are held. */
  let heldEpisodeSearches: (() => void)[] | null = null
  const states = new Map<string, SavedEpisodeState>()
  /** When the change each state holds was made, by episode. */
  const changeTimes = new Map<string, string>()
  /** Every listening-state change the backend received, in order. */
  const stateWrites: EpisodeStateChange[] = []
  const feeds = new Map<string, Pick<Podcast, 'title' | 'author' | 'artworkUrl'> | 'notAFeed' | 'failed'>()
  const requests = new Map<string, { feedUrl: string; state: SubscribeRequestState }>()
  /** The public podcast directory's listings. */
  const directory: (Omit<DirectoryPodcast, 'podcastId'> & { genre: DirectoryGenre | null })[] = []
  let directoryBroken = false
  /** Every chart asked for, in order: a genre, or null for the chart of all podcasts. */
  const chartRequests: (DirectoryGenre | null)[] = []
  /** The charts asked for and not yet answered, while they are held. */
  let heldCharts: (() => void)[] | null = null
  const podcastListeners = new Set<Listener<Podcast[]>>()
  const categories: Category[] = []
  const categoryListeners = new Set<Listener<Category[]>>()
  const episodeListeners = new Map<string, Set<Listener<Episode[]>>>()
  const latestListeners = new Set<Listener<Episode[]>>()
  /** The podcasts asked to be refreshed, in order. */
  const refreshRequests: string[] = []
  const stateListeners = new Map<string, Set<Listener<SavedEpisodeState[]>>>()
  const requestListeners = new Map<string, Set<Listener<SubscribeRequestState>>>()
  const queueListeners = new Set<Listener<QueueSnapshot>>()
  const inProgressListeners = new Set<Listener<InProgressEpisode[]>>()
  /** Temporary copies asked for and not yet settled, oldest first, each with who is watching it. */
  const stagings: { episodeId: string; listener: Listener<StagingState> }[] = []
  /** Every episode a temporary copy was asked for, in order. */
  const stagingRequests: string[] = []
  let failNext = false
  let offline = false
  /** Saves that have reached the backend but not been applied, while `holdSaves` holds them. */
  let heldSaves: (() => void)[] | null = null
  let nextId = 1
  /** The backend's clock, for each state's updated time: a second on with every write. */
  let tick = 0
  const timeAt = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()

  const publicPodcasts = () => podcasts.map(({ feedUrl: _feedUrl, ...podcast }) => podcast)
  const episodesOf = (podcastId: string) => episodes.filter((episode) => episode.podcastId === podcastId)
  /** As the backend's date index gives them: dated only, newest first. */
  const latestEpisodes = () =>
    episodes
      .filter((episode) => episode.publishedAt !== null)
      .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
      .slice(0, LATEST_EPISODES_LIMIT)
  const statesOf = (podcastId: string) => [...states.values()].filter((state) => state.podcastId === podcastId)
  const queue = (): QueuedEpisode[] =>
    [...states.values()]
      .filter((state) => state.queueOrder !== null)
      .map((state) => ({ state, episode: episodes.find((episode) => episode.id === state.episodeId)! }))
  const inProgress = (): InProgressEpisode[] =>
    [...states.values()]
      .filter(isInProgress)
      .map((state) => ({ state, episode: episodes.find((episode) => episode.id === state.episodeId)! }))

  function listenersFor<T>(map: Map<string, Set<Listener<T>>>, key: string) {
    const listeners = map.get(key) ?? new Set()
    map.set(key, listeners)
    return listeners
  }

  function listen<T>(connection: Connection, listeners: Set<Listener<T>>, observer: Observer<T>, current: () => T) {
    const listener = { connection, observer }
    listeners.add(listener)
    queueMicrotask(() => {
      if (!listeners.has(listener)) return
      if (!offline && !connection.offline) return observer.next(current())
      listeners.delete(listener)
      observer.error()
    })
    return () => void listeners.delete(listener)
  }

  const everyListenerSet = (): Set<Listener<never>>[] =>
    [
      podcastListeners,
      categoryListeners,
      latestListeners,
      queueListeners,
      inProgressListeners,
      ...episodeListeners.values(),
      ...stateListeners.values(),
      ...requestListeners.values(),
    ] as Set<Listener<never>>[]

  function notify<T>(listeners: Set<Listener<T>> | undefined, value: T) {
    listeners?.forEach(({ connection, observer }) => connection.asleep || connection.offline || offline || observer.next(value))
  }

  /** The directory's listings that pass, in the order listed, each marked if it is in the library. */
  function listed(pass: (listing: (typeof directory)[number]) => boolean): DirectoryPodcast[] {
    return directory.filter(pass).map(({ genre: _genre, ...listing }) => ({
      ...listing,
      podcastId: podcasts.find((podcast) => podcast.feedUrl === listing.feedUrl)?.id ?? null,
    }))
  }

  /** Fails the request if the network is down. */
  function reach(connection: Connection) {
    if (offline || connection.offline) throw new Error('Network error')
    if (failNext) {
      failNext = false
      throw new Error('Network error')
    }
  }

  const notifyPodcasts = () => notify(podcastListeners, publicPodcasts())
  const notifyCategories = () => notify(categoryListeners, categories.map((category) => ({ ...category })))

  function addPodcast(feedUrl: string, feed: Omit<Podcast, 'id'>) {
    const podcast = { id: `podcast-${nextId++}`, feedUrl, ...feed }
    podcasts.push(podcast)
    notifyPodcasts()
    return podcast.id
  }

  function settle(requestId: string, state: SubscribeRequestState) {
    requests.get(requestId)!.state = state
    notify(requestListeners.get(requestId), state)
  }

  function storeState(
    episodeId: string,
    podcastId: string,
    change: EpisodeStateChange,
    changedAt?: string,
  ): SavedEpisodeState {
    const saved = {
      episodeId,
      podcastId,
      positionSeconds: 0,
      played: false,
      queueOrder: null,
      addedAt: null,
      ...states.get(episodeId),
      ...change,
      updatedAt: timeAt(++tick),
    }
    states.set(episodeId, saved)
    changeTimes.set(episodeId, changedAt ?? saved.updatedAt)
    return saved
  }

  function view(connection: Connection): DataApi {
    return {
      observePodcasts(observer) {
        return listen(connection, podcastListeners, observer, publicPodcasts)
      },
      observeCategories(observer) {
        return listen(connection, categoryListeners, observer, () => categories.map((category) => ({ ...category })))
      },
      async createCategory(name) {
        reach(connection)
        const category = { id: `category-${nextId++}`, name }
        categories.push(category)
        queueMicrotask(notifyCategories)
        return { ...category }
      },
      async renameCategory(categoryId, name) {
        reach(connection)
        const category = categories.find((c) => c.id === categoryId)
        if (!category) throw new Error('No such category')
        category.name = name
        queueMicrotask(notifyCategories)
      },
      async deleteCategory(categoryId) {
        reach(connection)
        removeWhere(categories, (category) => category.id === categoryId)
        queueMicrotask(notifyCategories)
      },
      async setPodcastCategory(podcastId, categoryId) {
        reach(connection)
        const podcast = podcasts.find((p) => p.id === podcastId)
        if (!podcast) throw new Error('No such podcast')
        podcast.categoryId = categoryId
        podcast.libraryOrder = null
        queueMicrotask(notifyPodcasts)
      },
      async placePodcast(podcastId, categoryId, libraryOrder) {
        reach(connection)
        const podcast = podcasts.find((p) => p.id === podcastId)
        if (!podcast) throw new Error('No such podcast')
        podcast.categoryId = categoryId
        podcast.libraryOrder = libraryOrder
        queueMicrotask(notifyPodcasts)
      },
      async placeFavorite(podcastId, favoriteOrder) {
        reach(connection)
        const podcast = podcasts.find((p) => p.id === podcastId)
        if (!podcast) throw new Error('No such podcast')
        podcast.favoriteOrder = favoriteOrder
        queueMicrotask(notifyPodcasts)
      },
      observeEpisodes(podcastId, observer) {
        return listen(connection, listenersFor(episodeListeners, podcastId), observer, () => episodesOf(podcastId))
      },
      observeLatestEpisodes(observer) {
        return listen(connection, latestListeners, observer, latestEpisodes)
      },
      async getShowNotes(episodeId) {
        reach(connection)
        return showNotes.get(episodeId) ?? null
      },
      async refreshPodcast(podcastId) {
        reach(connection)
        refreshRequests.push(podcastId)
      },
      async searchEpisodes(podcastId, term): Promise<EpisodeSearch> {
        reach(connection)
        episodeSearches.push({ podcastId, term })
        if (heldEpisodeSearches) await new Promise<void>((release) => heldEpisodeSearches!.push(release))
        if (unreachableFeeds.has(podcastId)) return { outcome: 'feedUnavailable' }
        const matches = wordMatcher(term)
        const inFeed = [...episodesOf(podcastId), ...olderEpisodes.filter((episode) => episode.podcastId === podcastId)]
        const found = newestFirst(inFeed).filter(
          (episode) => matches?.(`${episode.title}\n${showNotes.get(episode.id) ?? ''}`) ?? false,
        )
        return { outcome: 'found', episodes: found.slice(0, 50).map((episode) => ({ ...episode })), more: found.length > 50 }
      },
      async keepEpisode(podcastId, episodeId) {
        reach(connection)
        if (unreachableFeeds.has(podcastId)) return 'feedUnavailable'
        if (episodes.some((episode) => episode.id === episodeId)) return 'kept'
        const index = olderEpisodes.findIndex((episode) => episode.id === episodeId && episode.podcastId === podcastId)
        if (index === -1) return 'notFound'
        episodes.push(...olderEpisodes.splice(index, 1))
        // The new episode reaches observers a little after the call answers, as a live update does.
        queueMicrotask(() => {
          notify(episodeListeners.get(podcastId), episodesOf(podcastId))
          notify(latestListeners, latestEpisodes())
        })
        return 'kept'
      },
      async searchPodcasts(term): Promise<PodcastSearch> {
        reach(connection)
        if (directoryBroken) return { outcome: 'directoryUnavailable' }
        const wanted = term.trim().toLowerCase()
        return { outcome: 'found', podcasts: listed((listing) => wanted !== '' && listing.title.toLowerCase().includes(wanted)) }
      },
      async topPodcasts(genre): Promise<PodcastSearch> {
        reach(connection)
        chartRequests.push(genre)
        if (heldCharts) await new Promise<void>((release) => heldCharts!.push(release))
        if (directoryBroken) return { outcome: 'directoryUnavailable' }
        return { outcome: 'found', podcasts: listed((listing) => genre === null || listing.genre === genre) }
      },
      async subscribeToFeed(feedUrl): Promise<SubscribeStart> {
        reach(connection)
        if (!/^https?:\/\//.test(feedUrl)) return { outcome: 'invalidUrl' }
        const existing = podcasts.find((podcast) => podcast.feedUrl === feedUrl)
        if (existing) return { outcome: 'alreadySubscribed', podcastId: existing.id }
        const requestId = `request-${nextId++}`
        requests.set(requestId, { feedUrl, state: { status: 'pending' } })
        return { outcome: 'pending', requestId }
      },
      async unsubscribe(podcastId) {
        reach(connection)
        removeWhere(podcasts, (podcast) => podcast.id === podcastId)
        removeWhere(episodes, (episode) => episode.podcastId === podcastId)
        for (const state of statesOf(podcastId)) states.delete(state.episodeId)
        notifyPodcasts()
        notify(episodeListeners.get(podcastId), [])
        notify(latestListeners, latestEpisodes())
        notify(stateListeners.get(podcastId), [])
        notify(queueListeners, { entries: queue(), asOf: timeAt(++tick) })
        notify(inProgressListeners, inProgress())
      },
      observeSubscribeRequest(requestId, observer) {
        return listen(connection, listenersFor(requestListeners, requestId), observer, () => requests.get(requestId)!.state)
      },
      observeEpisodeStates(podcastId, observer) {
        return listen(connection, listenersFor(stateListeners, podcastId), observer, () => statesOf(podcastId))
      },
      async saveEpisodeState(episodeId, podcastId, change, changedAt) {
        reach(connection)
        if (heldSaves) await new Promise<void>((resolve) => heldSaves!.push(resolve))
        stateWrites.push({ ...change })
        const held = states.get(episodeId)
        const heldChangedAt = changeTimes.get(episodeId)
        // A change made later is already saved: it wins.
        if (held && heldChangedAt && Date.parse(heldChangedAt) > Date.parse(changedAt)) return held
        const saved = storeState(episodeId, podcastId, change, changedAt)
        // The write's own subscription event arrives separately from its response, as with the real API.
        queueMicrotask(() => {
          notify(stateListeners.get(podcastId), statesOf(podcastId))
          notify(queueListeners, { entries: queue(), asOf: saved.updatedAt })
          notify(inProgressListeners, inProgress())
        })
        return saved
      },
      observeQueue(observer) {
        return listen(connection, queueListeners, observer, () => ({ entries: queue(), asOf: null }))
      },
      observeInProgress(observer) {
        return listen(connection, inProgressListeners, observer, inProgress)
      },
      stageDownload(episodeId, observer) {
        const listener = { connection, observer }
        const staging = { episodeId, listener }
        queueMicrotask(() => {
          if (offline || connection.offline) return observer.error()
          stagingRequests.push(episodeId)
          stagings.push(staging)
          observer.next({ status: 'preparing' })
        })
        return () => removeWhere(stagings, (pending) => pending === staging)
      },
    }
  }

  /** Ends the live observations of every device, or of the one given, with an error. */
  function dropObservers(connection?: Connection) {
    for (const listeners of everyListenerSet()) {
      for (const listener of [...listeners]) {
        if (connection && listener.connection !== connection) continue
        listeners.delete(listener)
        listener.observer.error()
      }
    }
    for (const staging of stagings.filter(({ listener }) => !connection || listener.connection === connection)) {
      removeWhere(stagings, (pending) => pending === staging)
      staging.listener.observer.error()
    }
  }

  function device() {
    const connection: Connection = { asleep: false, offline: false }
    return Object.assign(view(connection), {
      /** Live updates stop arriving, as when iOS suspends the app in the background. */
      sleep() {
        connection.asleep = true
      },
      /** Live updates arrive again. Those missed while asleep are not replayed. */
      wake() {
        connection.asleep = false
      },
      /** This device alone loses its network: its requests fail, and its live observations end with an error. */
      disconnect() {
        connection.offline = true
        dropObservers(connection)
      },
      /** This device's network comes back, for new requests and observations. */
      reconnect() {
        connection.offline = false
      },
    })
  }

  return Object.assign(device(), {
    /** A second device (another phone or computer) on the same account. */
    anotherDevice: device,
    /** Makes a feed reachable. */
    publishFeed(feedUrl: string, podcast: Pick<Podcast, 'title'> & Partial<Pick<Podcast, 'author' | 'artworkUrl'>>) {
      feeds.set(feedUrl, { author: null, artworkUrl: null, ...podcast })
    },
    /**
     * Lists a show in the public directory, which a search for part of its
     * title finds. The chart of all podcasts lists it too, after those listed
     * before it, and so does the chart of its `genre`, if it has one. Its feed
     * is published too, unless it is to be `unreachable`.
     */
    listInDirectory(
      listing: Omit<DirectoryPodcast, 'podcastId'>,
      { feed = 'published', genre = null }: { feed?: 'published' | 'unreachable'; genre?: DirectoryGenre | null } = {},
    ) {
      directory.push({ ...listing, genre })
      if (feed === 'published') {
        const { title, author, artworkUrl } = listing
        feeds.set(listing.feedUrl, { title, author, artworkUrl })
      }
    },
    /** Every chart asked for, in order: a genre, or null for the chart of all podcasts. */
    chartRequests,
    /** Charts stop being answered, as if slow on the way, until `releaseCharts`. */
    holdCharts() {
      heldCharts = []
    },
    /** Answers the charts held, the one asked for last first when `newestFirst`, as a network can reorder them; later ones are answered at once. */
    releaseCharts({ newestFirst = false }: { newestFirst?: boolean } = {}) {
      const held = heldCharts ?? []
      heldCharts = null
      for (const release of newestFirst ? held.reverse() : held) release()
    },
    /** The directory stops answering searches and charts usefully, as when it is down or rate-limiting. */
    breakDirectory() {
      directoryBroken = true
    },
    repairDirectory() {
      directoryBroken = false
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
    /** Saves stop being applied, as if slow on the way, until `releaseSaves`. */
    holdSaves() {
      heldSaves = []
    },
    /** Applies the saves held, newest arrival first when `newestFirst`, as a network can reorder them; later ones go straight through. */
    releaseSaves({ newestFirst = false }: { newestFirst?: boolean } = {}) {
      const held = heldSaves ?? []
      heldSaves = null
      ;(newestFirst ? [...held].reverse() : held).forEach((apply) => apply())
    },
    /** The network goes down for every device: requests fail, and live observations end with an error. */
    goOffline() {
      offline = true
      dropObservers()
    },
    /** The network comes back: requests and new observations work again. */
    goOnline() {
      offline = false
    },
    /**
     * Settles every temporary copy being prepared, as the backend's stager
     * does once it has copied the file or failed to.
     */
    finishStaging(outcome: SettledStaging) {
      for (const { listener } of stagings.splice(0)) {
        const { connection, observer } = listener
        if (!offline && !connection.offline && !connection.asleep) observer.next(outcome)
      }
    },
    /** The episodes a temporary copy has been asked for, oldest first. */
    stagingRequests(): readonly string[] {
      return stagingRequests
    },
    /** Runs the background check of every pending subscribe, as the backend does. */
    finishSubscribing() {
      for (const [requestId, { feedUrl, state }] of requests) {
        if (state.status !== 'pending') continue
        const feed = feeds.get(feedUrl)
        if (feed === undefined) settle(requestId, { status: 'unreachable' })
        else if (typeof feed === 'string') settle(requestId, { status: feed })
        else {
          const podcastId = addPodcast(feedUrl, { ...feed, lastFetchedAt: timeAt(tick), lastFetchError: null, categoryId: null, libraryOrder: null, favoriteOrder: null })
          settle(requestId, { status: 'subscribed', podcastId })
        }
      }
    },
    /** A podcast already in the library. Returns its ID. */
    seedPodcast(feedUrl: string, podcast: Pick<Podcast, 'title'> & Partial<Omit<Podcast, 'id' | 'title'>>) {
      return addPodcast(feedUrl, {
        author: null,
        artworkUrl: null,
        lastFetchedAt: null,
        lastFetchError: null,
        categoryId: null,
        libraryOrder: null,
        favoriteOrder: null,
        ...podcast,
      })
    },
    /** A category the listener already made. Returns its ID. */
    seedCategory(name: string) {
      const id = `category-${nextId++}`
      categories.push({ id, name })
      notifyCategories()
      return id
    },
    /** A refresh of the podcast's feed records its outcome, as the backend does after an hourly or requested refresh. */
    recordRefresh(podcastId: string, outcome: { lastFetchedAt?: string; lastFetchError: FeedError | null }) {
      Object.assign(podcasts.find((podcast) => podcast.id === podcastId)!, outcome)
      notifyPodcasts()
    },
    /** The podcasts asked to be refreshed on demand, oldest first. */
    refreshRequests(): readonly string[] {
      return refreshRequests
    },
    podcastIdFor(feedUrl: string) {
      return podcasts.find((podcast) => podcast.feedUrl === feedUrl)?.id
    },
    /**
     * Delivers ingested episodes, as the background step does after adding the
     * podcast, or a refresh does on finding new ones. An episode given no
     * enclosure URL gets one of its own, and one given no show notes has none.
     * Returns their IDs.
     */
    ingest(
      podcastId: string,
      newEpisodes: (Omit<Episode, 'podcastId' | 'id' | 'enclosureUrl'> &
        Partial<Pick<Episode, 'enclosureUrl'>> & { showNotes?: string | null })[],
    ) {
      const ids = newEpisodes.map(({ showNotes: notes = null, ...episode }) => {
        const id = `episode-${nextId++}`
        episodes.push({ id, podcastId, enclosureUrl: `https://media.example.com/${id}.mp3`, ...episode })
        showNotes.set(id, notes)
        return id
      })
      notify(episodeListeners.get(podcastId), episodesOf(podcastId))
      notify(latestListeners, latestEpisodes())
      return ids
    },
    /**
     * Lists episodes in the podcast's feed that are further back than the
     * library keeps: found only by searching the feed, and in the library
     * once kept. Returns their IDs.
     */
    publishOlderEpisodes(
      podcastId: string,
      older: (Omit<Episode, 'podcastId' | 'id' | 'enclosureUrl'> & { showNotes?: string | null })[],
    ) {
      return older.map(({ showNotes: notes = null, ...episode }) => {
        const id = `episode-${nextId++}`
        olderEpisodes.push({ id, podcastId, enclosureUrl: `https://media.example.com/${id}.mp3`, ...episode })
        showNotes.set(id, notes)
        return id
      })
    },
    /** The feed drops an older episode it listed, as a publisher trimming its feed does. */
    withdrawOlderEpisode(episodeId: string) {
      removeWhere(olderEpisodes, (episode) => episode.id === episodeId)
    },
    /** The podcast's feed stops answering, for searches of it and for keeping episodes from it. */
    breakFeedOf(podcastId: string) {
      unreachableFeeds.add(podcastId)
    },
    repairFeedOf(podcastId: string) {
      unreachableFeeds.delete(podcastId)
    },
    /** Every search of a feed for episodes so far, oldest first. */
    episodeSearches(): readonly { podcastId: string; term: string }[] {
      return episodeSearches
    },
    /** Searches of feeds stop being answered, as if slow, until `releaseEpisodeSearches`. */
    holdEpisodeSearches() {
      heldEpisodeSearches = []
    },
    /** Answers the searches held, the latest first when `newestFirst`; later ones are answered at once. */
    releaseEpisodeSearches({ newestFirst: latestFirst = false }: { newestFirst?: boolean } = {}) {
      const held = heldEpisodeSearches ?? []
      heldEpisodeSearches = null
      ;(latestFirst ? [...held].reverse() : held).forEach((release) => release())
    },
    /** Listening state saved earlier, by this device or another. */
    seedEpisodeState({
      episodeId,
      podcastId,
      ...state
    }: Omit<EpisodeState, 'queueOrder' | 'addedAt'> & Partial<Pick<EpisodeState, 'queueOrder' | 'addedAt'>>) {
      storeState(episodeId, podcastId, state)
    },
    /** The listening state the backend holds for an episode. */
    savedState(episodeId: string): EpisodeState | undefined {
      const saved = states.get(episodeId)
      if (!saved) return undefined
      const { updatedAt: _updatedAt, ...state } = saved
      return state
    },
    /** Every listening-state change received so far, oldest first. */
    stateWrites(): readonly EpisodeStateChange[] {
      return stateWrites
    },
  })
}

function removeWhere<T>(items: T[], matches: (item: T) => boolean) {
  for (let i = items.length - 1; i >= 0; i--) if (matches(items[i])) items.splice(i, 1)
}

interface Listener<T> {
  connection: Connection
  observer: Observer<T>
}

export type FakeDataApi = ReturnType<typeof fakeDataApi>

/**
 * Stands in for a plain `<audio>` element. Like the real one, setting `src`
 * starts a fresh load (back at `defaultPlaybackRate`), `play()` and
 * `pause()` fire `play` and `pause`, a failed load fires `error` without
 * pausing, and reaching the end fires `pause` then `ended`. Tests drive what the network, decoder and browser
 * would: `loadMetadata`, `progressTo`, `playToEnd`, `failToLoad`,
 * `refuseNextPlay`, `letGoOfData`. `readyState` follows them: nothing on a
 * fresh load, the metadata once it arrives, and enough to play on once
 * playback has moved.
 */
export class FakeAudio extends EventTarget implements AudioElement {
  #src = ''
  #currentTime = 0
  duration = NaN
  playbackRate = 1
  defaultPlaybackRate = 1
  paused = true
  ended = false
  /** 0 nothing, 1 metadata, 2 the current moment, 3 enough to play on, 4 enough to play through. */
  readyState = 0
  preload: AudioElement['preload'] = 'auto'
  #refuseNextPlay = false
  #ignoresEarlySeeks = false
  /** How many times a file has been loaded: each starts from nothing. */
  loads = 0

  get src() {
    return this.#src
  }

  set src(url: string) {
    this.#src = url
    if (url) this.loads++
    // As in a real element, a new load returns to the default rate.
    this.playbackRate = this.defaultPlaybackRate
    this.paused = true
    this.ended = false
    this.#currentTime = 0
    this.duration = NaN
    this.readyState = 0
    this.dispatchEvent(new Event('emptied'))
    this.dispatchEvent(new Event('durationchange'))
    this.dispatchEvent(new Event('timeupdate'))
  }

  get currentTime() {
    return this.#currentTime
  }

  set currentTime(seconds: number) {
    this.ended = false
    if (this.#ignoresEarlySeeks && !Number.isFinite(this.duration)) return
    this.#currentTime = Number.isFinite(this.duration) ? Math.min(Math.max(seconds, 0), this.duration) : Math.max(seconds, 0)
    this.dispatchEvent(new Event('timeupdate'))
  }

  play() {
    if (this.#refuseNextPlay) {
      this.#refuseNextPlay = false
      return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))
    }
    if (!this.#src) return Promise.reject(new DOMException('No source', 'NotSupportedError'))
    if (this.ended) {
      // Playing an ended file starts it again from the beginning.
      this.currentTime = 0
    }
    if (this.paused) {
      this.paused = false
      this.dispatchEvent(new Event('play'))
    }
    return Promise.resolve()
  }

  pause() {
    if (this.paused) return
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }

  removeAttribute(name: string) {
    if (name === 'src') this.#src = ''
  }

  /** Restarts loading: with no `src`, this unloads and stops any download. */
  load() {
    this.src = this.#src
  }

  /** Like some browsers, ignores a seek made before the file's metadata has loaded. */
  ignoreEarlySeeks() {
    this.#ignoresEarlySeeks = true
  }

  /** The browser refuses the next `play()`, as iOS does outside a user gesture. */
  refuseNextPlay() {
    this.#refuseNextPlay = true
  }

  /** The file's metadata arrives: its real length is now known. */
  loadMetadata(durationSeconds: number) {
    this.duration = durationSeconds
    this.readyState = Math.max(this.readyState, 1)
    this.dispatchEvent(new Event('durationchange'))
    this.dispatchEvent(new Event('loadedmetadata'))
  }

  /** Playback has reached this point, so the element holds enough of the file to play on. */
  progressTo(seconds: number) {
    this.#currentTime = seconds
    this.readyState = 4
    this.dispatchEvent(new Event('timeupdate'))
  }

  /**
   * The element lets go of the file's data, keeping only its metadata, as
   * iOS does with a file left paused in the background.
   */
  letGoOfData() {
    this.readyState = Math.min(this.readyState, 1)
  }

  /** Playback reaches the end of the file, whose metadata must have loaded. */
  playToEnd() {
    this.#currentTime = this.duration
    this.dispatchEvent(new Event('timeupdate'))
    this.paused = true
    this.ended = true
    this.dispatchEvent(new Event('pause'))
    this.dispatchEvent(new Event('ended'))
  }

  /** The publisher's file can't be fetched or decoded. */
  failToLoad() {
    this.dispatchEvent(new Event('error'))
  }
}

type ActionHandler = (details: MediaSessionActionDetails) => void

/**
 * Stands in for the OS media controls behind `navigator.mediaSession`: the
 * lock screen, notification centre, headphone and Bluetooth buttons. Shows
 * what the app last told it; `press` and `scrubTo` act as the listener would.
 */
export class FakeMediaSession implements MediaSessionControls {
  metadata: MediaMetadataInit | null = null
  playbackState: MediaSessionPlaybackState = 'none'
  positionState: MediaPositionState | null = null
  /** How many times the OS has been told the position. */
  positionUpdates = 0
  #handlers = new Map<MediaSessionAction, ActionHandler>()

  setMetadata(metadata: MediaMetadataInit | null) {
    this.metadata = metadata
  }

  setPlaybackState(state: MediaSessionPlaybackState) {
    this.playbackState = state
  }

  setPositionState(state: MediaPositionState | null) {
    this.positionUpdates++
    if (state) {
      // The real API throws on a position past the end, or a rate of zero.
      const { duration = NaN, position = 0, playbackRate = 1 } = state
      if (!(duration >= 0) || position < 0 || position > duration || playbackRate === 0) {
        throw new TypeError(`Invalid position state ${JSON.stringify(state)}`)
      }
    }
    this.positionState = state
  }

  setActionHandler(action: MediaSessionAction, handler: ActionHandler | null) {
    if (handler) this.#handlers.set(action, handler)
    else this.#handlers.delete(action)
  }

  /** The controls the OS offers: those the app handles. */
  actions(): MediaSessionAction[] {
    return [...this.#handlers.keys()]
  }

  /** The listener presses a control: on the lock screen, or a headphone or Bluetooth button. */
  press(action: 'play' | 'pause' | 'seekbackward' | 'seekforward' | 'nexttrack') {
    this.#call({ action })
  }

  /** The listener drags the lock screen's scrubber here. */
  scrubTo(seconds: number) {
    this.#call({ action: 'seekto', seekTime: seconds })
  }

  #call(details: MediaSessionActionDetails) {
    const handler = this.#handlers.get(details.action)
    if (!handler) throw new Error(`No handler for media session action "${details.action}"`)
    handler(details)
  }
}

/**
 * Stands in for the Origin Private File System: files held in memory, which
 * outlive any one launch of the app as long as the same instance is passed
 * in. Writes land at once and durably, so a file being downloaded shows what
 * has arrived, and `killApp` keeps it. Like the real one, a write takes over
 * the chunk's buffer, leaving the chunk empty.
 */
export class FakeDeviceFiles implements DeviceFiles {
  #files = new Map<string, Uint8Array>()
  #urls = new Map<string, string>()
  #nextUrl = 1
  #outOfSpace = false
  #failNextRename = false
  /** Deletions waiting to happen, while `holdRemovals` holds them; null when they happen at once. */
  #heldRemovals: (() => void)[] | null = null
  /** Bumped when the app is killed: files it had open can no longer be written by it. */
  #launch = 0

  async list() {
    return [...this.#files.keys()]
  }

  async size(name: string) {
    return this.#files.get(name)?.length ?? null
  }

  async openForAppend(name: string, { fresh = false }: { fresh?: boolean } = {}): Promise<FileAppender> {
    if (fresh || !this.#files.has(name)) this.#files.set(name, new Uint8Array())
    let open = true
    let broken = false
    const launch = this.#launch
    return {
      write: async (chunk) => {
        if (!open || broken || launch !== this.#launch) throw new TypeError('The file is closed')
        if (this.#outOfSpace) {
          broken = true
          throw new DOMException('No space left', 'QuotaExceededError')
        }
        const before = this.#files.get(name) ?? new Uint8Array()
        const after = new Uint8Array(before.length + chunk.length)
        after.set(before)
        after.set(chunk, before.length)
        this.#files.set(name, after)
        if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength) {
          structuredClone(chunk.buffer, { transfer: [chunk.buffer as ArrayBuffer] })
        }
      },
      // As with a real writable stream, one that failed a write fails to close too.
      close: async () => {
        open = false
        if (broken) throw new TypeError('The file failed to write')
      },
    }
  }

  async rename(from: string, to: string) {
    if (this.#failNextRename) {
      this.#failNextRename = false
      // As Safari's `move` did when given a name alone.
      throw new DOMException("Argument 1 ('destination') to FileSystemHandle.move must be an instance of FileSystemHandle", 'TypeError')
    }
    const bytes = this.#files.get(from)
    if (!bytes) throw new DOMException(`No file ${from}`, 'NotFoundError')
    this.#files.delete(from)
    this.#files.set(to, bytes)
  }

  async playbackUrl(name: string) {
    if (!this.#files.has(name)) return null
    const url = `blob:https://tincan.example/${this.#nextUrl++}`
    this.#urls.set(url, name)
    return url
  }

  async remove(name: string) {
    if (this.#heldRemovals) await new Promise<void>((resolve) => this.#heldRemovals!.push(resolve))
    this.#files.delete(name)
  }

  /** Deletions wait, as on a slow disk, until `releaseRemovals`. */
  holdRemovals() {
    this.#heldRemovals ??= []
  }

  /** Lets held deletions go ahead, and later ones happen at once. */
  releaseRemovals() {
    const held = this.#heldRemovals ?? []
    this.#heldRemovals = null
    held.forEach((resolve) => resolve())
  }

  /** The bytes a playback URL plays, or undefined if it is not one or its file has gone. */
  contentsAt(url: string): Uint8Array | undefined {
    const name = this.#urls.get(url)
    return name === undefined ? undefined : this.#files.get(name)
  }

  /** The bytes of the one file stored, complete or not; undefined when there is none. Throws if there are several. */
  onlyFile(): Uint8Array | undefined {
    if (this.#files.size > 1) throw new Error(`${this.#files.size} files are stored, not one`)
    return [...this.#files.values()][0]
  }

  /** How many files are stored, complete or not. */
  count() {
    return this.#files.size
  }

  /** The OS clears every stored file to free space, as iOS may while the app is closed. */
  evictAll() {
    this.#files.clear()
  }

  /** The app is killed: what it stored stays, and files it had open take no more from it. */
  killApp() {
    this.#launch++
  }

  /** The next rename fails, leaving the file under its old name. */
  failNextRename() {
    this.#failNextRename = true
  }

  /** Every later write fails as the device has no room left. */
  runOutOfSpace() {
    this.#outOfSpace = true
  }
}

interface HostedFile {
  bytes: Uint8Array
  /** The host sends CORS headers, so a web page may read the file. */
  cors: boolean
  /** The host answers range requests with part of the file. */
  ranges: boolean
  /** The host stops sending, cleanly, after this many bytes of the file, though it said it would send all. */
  endsAt: number | null
}

/**
 * Stands in for the network and the publishers' hosts on it, as `fetch` sees
 * them. Hosts answer like real ones: a 206 with the rest of the file for a
 * range request, a 200 for the whole of it, and, when the host sends no CORS
 * headers, a network error for any read the page could see (an opaque
 * `no-cors` answer still arrives). A cross-origin page can't read
 * `Content-Range`, so none is sent; `Content-Length` it can.
 *
 * Files arrive in `chunkSize` pieces, as fast as they are read, unless
 * `throttle` holds them back to be let through by `deliver`.
 */
export class FakeNetwork {
  chunkSize = 100
  #files = new Map<string, HostedFile>()
  #refused = new Set<string>()
  #offline = false
  #throttled = false
  /** Bytes that may yet be sent while throttled. */
  #allowance = 0
  #waiting = new Set<() => void>()
  #open = new Set<ReadableStreamDefaultController<Uint8Array>>()
  /** Responses to an app that has been killed: nothing more arrives for them, and nothing tells them. */
  #frozen = new WeakSet<ReadableStreamDefaultController<Uint8Array>>()
  /** Every request made, oldest first, with its Range header if it had one. */
  readonly requests: { url: string; range: string | null; mode: 'cors' | 'no-cors' }[] = []

  /** Puts an audio file on a host. */
  host(url: string, bytes: Uint8Array, { cors = true, ranges = true }: { cors?: boolean; ranges?: boolean } = {}) {
    this.#files.set(url, { bytes, cors, ranges, endsAt: null })
  }

  /** The host refuses every later request for the file, as S3 does once a link has stopped working. */
  refuse(url: string) {
    this.#refused.add(url)
  }

  /** The host stops part way through the file the next time it sends it, closing the response as if it had all been sent. */
  endEarly(url: string, atByte: number) {
    this.#files.get(url)!.endsAt = atByte
  }

  /** Files stop arriving until `deliver` lets bytes through. */
  throttle() {
    this.#throttled = true
  }

  /** Lets this many more bytes arrive, across every response. */
  deliver(bytes: number) {
    this.#allowance += bytes
    this.#wake()
  }

  /** Files arrive as fast as they are read again. */
  unthrottle() {
    this.#throttled = false
    this.#wake()
  }

  /** The connection drops: responses still arriving fail, and so does every request until `reconnect`. */
  dropConnection() {
    this.#offline = true
    for (const controller of this.#open) controller.error(new TypeError('network error'))
    this.#open.clear()
    this.#wake()
  }

  reconnect() {
    this.#offline = false
  }

  /** The app is killed: responses still arriving for it stop dead. */
  forgetOpenResponses() {
    for (const controller of this.#open) this.#frozen.add(controller)
    this.#open.clear()
  }

  readonly fetch: Fetch = async (url, init = {}) => {
    const range = init.headers?.Range ?? null
    const mode = init.mode ?? 'cors'
    this.requests.push({ url, range, mode })
    if (this.#offline) throw new TypeError('Failed to fetch')
    const file = this.#files.get(url)
    if (mode === 'no-cors') return new Response(null)
    if (!file) return new Response(null, { status: 404 })
    if (!file.cors) throw new TypeError('Failed to fetch')
    if (this.#refused.has(url)) return new Response(null, { status: 403 })
    const from = range && file.ranges ? Number(/^bytes=(\d+)-$/.exec(range)![1]) : 0
    if (from >= file.bytes.length && from > 0) return new Response(null, { status: 416 })
    const end = file.endsAt ?? file.bytes.length
    file.endsAt = null
    const body = this.#stream(file.bytes.subarray(from, Math.max(end, from)), init.signal)
    return new Response(body, {
      status: from > 0 ? 206 : 200,
      headers: { 'Content-Length': String(file.bytes.length - from), 'Content-Type': 'audio/mpeg' },
    })
  }

  #stream(bytes: Uint8Array, signal: AbortSignal | undefined) {
    let sent = 0
    let controller: ReadableStreamDefaultController<Uint8Array>
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c
        this.#open.add(c)
        signal?.addEventListener('abort', () => {
          this.#open.delete(c)
          c.error(new DOMException('Aborted', 'AbortError'))
        })
      },
      pull: async (c) => {
        while (this.#throttled && this.#allowance === 0 && this.#open.has(c)) {
          await new Promise<void>((resolve) => this.#waiting.add(resolve))
        }
        if (this.#frozen.has(c)) return new Promise<void>(() => {})
        if (!this.#open.has(c)) return
        if (sent >= bytes.length) {
          this.#open.delete(c)
          c.close()
          return
        }
        let size = Math.min(this.chunkSize, bytes.length - sent)
        if (this.#throttled) {
          size = Math.min(size, this.#allowance)
          this.#allowance -= size
        }
        c.enqueue(bytes.slice(sent, sent + size))
        sent += size
      },
      cancel: () => {
        this.#open.delete(controller)
      },
    })
  }

  #wake() {
    const waiting = [...this.#waiting]
    this.#waiting.clear()
    waiting.forEach((resolve) => resolve())
  }
}

/** Stands in for the browser's `localStorage`, one per device: records held in memory. */
export class FakeDeviceStorage implements DeviceStorage {
  #records = new Map<string, string>()

  get(key: string) {
    return this.#records.get(key) ?? null
  }

  set(key: string, value: string) {
    this.#records.set(key, value)
  }

  remove(key: string) {
    this.#records.delete(key)
  }

  keys() {
    return [...this.#records.keys()]
  }
}

/**
 * Stands in for the device: its file storage and small records, the network,
 * the screen's wake lock and the browser's storage persistence. Rendering a
 * fresh `<App>` with the same instance is a relaunch on the same device:
 * files and records stay.
 */
export class FakeDevice implements Device {
  readonly files = new FakeDeviceFiles()
  readonly storage = new FakeDeviceStorage()
  readonly playbackLog = createPlaybackLog(memoryText())
  readonly network = new FakeNetwork()
  readonly fetch: Fetch = (url, init) => this.network.fetch(url, init)
  /** How many times the app asked for persistent storage. */
  persistRequests = 0
  /** How many times the app reloaded itself. */
  reloads = 0
  #holds = new Set<{ released: boolean }>()
  #online = true
  #connectivityListeners = new Set<() => void>()

  readonly isOnline = () => this.#online

  readonly watchConnectivity = (listener: () => void) => {
    this.#connectivityListeners.add(listener)
    return () => void this.#connectivityListeners.delete(listener)
  }

  /** The device loses its network, as in airplane mode: the browser says so, and its fetches fail. */
  goOffline() {
    this.#online = false
    this.network.dropConnection()
    this.#connectivityListeners.forEach((listener) => listener())
  }

  /** The network comes back. */
  goOnline() {
    this.#online = true
    this.network.reconnect()
    this.#connectivityListeners.forEach((listener) => listener())
  }

  async keepScreenOn(): Promise<ScreenHold> {
    const hold = {
      released: false,
      release: async () => {
        hold.released = true
        this.#holds.delete(hold)
      },
    }
    this.#holds.add(hold)
    return hold
  }

  async persistStorage() {
    this.persistRequests++
    return true
  }

  readonly reload = () => {
    this.reloads++
  }

  #newVersionListeners = new Set<() => void>()
  #newVersionDeployed = false

  readonly watchForNewVersion = (listener: () => void) => {
    this.#newVersionListeners.add(listener)
    // The real watcher checks as it starts, so one that starts after a deploy still finds it.
    if (this.#newVersionDeployed) listener()
    return () => void this.#newVersionListeners.delete(listener)
  }

  /** A new version of the app is deployed, and the running app notices: now, or as soon as it starts watching. */
  deployNewVersion() {
    this.#newVersionDeployed = true
    this.#newVersionListeners.forEach((listener) => listener())
  }

  /** Whether anything is keeping the screen on. */
  screenKeptOn() {
    return this.#holds.size > 0
  }

  /**
   * The OS kills the app, as iOS may while the phone is locked: its
   * downloads stop dead, with no chance to finish writing or close anything.
   * Unmount it and launch again with this device to come back.
   */
  killApp() {
    this.network.forgetOpenResponses()
    this.files.killApp()
    this.dropScreenHolds()
  }

  /** The system drops every hold on the screen, as it does when the app is hidden. */
  dropScreenHolds() {
    for (const hold of this.#holds) hold.released = true
    this.#holds.clear()
  }
}

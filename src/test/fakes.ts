import type {
  AudioElement,
  AuthService,
  DataApi,
  Episode,
  EpisodeState,
  EpisodeStateChange,
  MediaSessionControls,
  Observer,
  Podcast,
  QueuedEpisode,
  QueueSnapshot,
  SavedEpisodeState,
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

/** A device's connection to the fake backend. */
interface Connection {
  /** Its live updates are not arriving, as when iOS suspends a backgrounded app. */
  asleep: boolean
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
 * `goOffline` takes the network away from every device at once.
 */
export function fakeDataApi() {
  const podcasts: (Podcast & { feedUrl: string })[] = []
  const episodes: Episode[] = []
  const states = new Map<string, SavedEpisodeState>()
  /** Every listening-state change the backend received, in order. */
  const stateWrites: EpisodeStateChange[] = []
  const feeds = new Map<string, Pick<Podcast, 'title' | 'author' | 'artworkUrl'> | 'notAFeed' | 'failed'>()
  const requests = new Map<string, { feedUrl: string; state: SubscribeRequestState }>()
  const podcastListeners = new Set<Listener<Podcast[]>>()
  const episodeListeners = new Map<string, Set<Listener<Episode[]>>>()
  const stateListeners = new Map<string, Set<Listener<SavedEpisodeState[]>>>()
  const requestListeners = new Map<string, Set<Listener<SubscribeRequestState>>>()
  const queueListeners = new Set<Listener<QueueSnapshot>>()
  let failNext = false
  let offline = false
  let nextId = 1
  /** The backend's clock, for each state's updated time: a second on with every write. */
  let tick = 0
  const timeAt = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()

  const publicPodcasts = () => podcasts.map(({ feedUrl: _feedUrl, ...podcast }) => podcast)
  const episodesOf = (podcastId: string) => episodes.filter((episode) => episode.podcastId === podcastId)
  const statesOf = (podcastId: string) => [...states.values()].filter((state) => state.podcastId === podcastId)
  const queue = (): QueuedEpisode[] =>
    [...states.values()]
      .filter((state) => state.queueOrder !== null)
      .map((state) => ({ state, episode: episodes.find((episode) => episode.id === state.episodeId)! }))

  function listenersFor<T>(map: Map<string, Set<Listener<T>>>, key: string) {
    const listeners = map.get(key) ?? new Set()
    map.set(key, listeners)
    return listeners
  }

  function listen<T>(connection: Connection, listeners: Set<Listener<T>>, observer: Observer<T>, current: () => T) {
    const listener = { connection, observer }
    listeners.add(listener)
    queueMicrotask(() => listeners.has(listener) && (offline ? observer.error() : observer.next(current())))
    return () => void listeners.delete(listener)
  }

  function notify<T>(listeners: Set<Listener<T>> | undefined, value: T) {
    listeners?.forEach(({ connection, observer }) => connection.asleep || offline || observer.next(value))
  }

  /** Fails the request if the network is down. */
  function reach() {
    if (offline) throw new Error('Network error')
    if (failNext) {
      failNext = false
      throw new Error('Network error')
    }
  }

  const notifyPodcasts = () => notify(podcastListeners, publicPodcasts())

  function addPodcast(feedUrl: string, feed: Pick<Podcast, 'title' | 'author' | 'artworkUrl'>) {
    const podcast = { id: `podcast-${nextId++}`, feedUrl, ...feed }
    podcasts.push(podcast)
    notifyPodcasts()
    return podcast.id
  }

  function settle(requestId: string, state: SubscribeRequestState) {
    requests.get(requestId)!.state = state
    notify(requestListeners.get(requestId), state)
  }

  function storeState(episodeId: string, podcastId: string, change: EpisodeStateChange): SavedEpisodeState {
    const saved = {
      episodeId,
      podcastId,
      positionSeconds: 0,
      played: false,
      queueOrder: null,
      ...states.get(episodeId),
      ...change,
      updatedAt: timeAt(++tick),
    }
    states.set(episodeId, saved)
    return saved
  }

  function view(connection: Connection): DataApi {
    return {
      observePodcasts(observer) {
        return listen(connection, podcastListeners, observer, publicPodcasts)
      },
      observeEpisodes(podcastId, observer) {
        return listen(connection, listenersFor(episodeListeners, podcastId), observer, () => episodesOf(podcastId))
      },
      async subscribeToFeed(feedUrl): Promise<SubscribeStart> {
        reach()
        if (!/^https?:\/\//.test(feedUrl)) return { outcome: 'invalidUrl' }
        const existing = podcasts.find((podcast) => podcast.feedUrl === feedUrl)
        if (existing) return { outcome: 'alreadySubscribed', podcastId: existing.id }
        const requestId = `request-${nextId++}`
        requests.set(requestId, { feedUrl, state: { status: 'pending' } })
        return { outcome: 'pending', requestId }
      },
      observeSubscribeRequest(requestId, observer) {
        return listen(connection, listenersFor(requestListeners, requestId), observer, () => requests.get(requestId)!.state)
      },
      observeEpisodeStates(podcastId, observer) {
        return listen(connection, listenersFor(stateListeners, podcastId), observer, () => statesOf(podcastId))
      },
      async saveEpisodeState(episodeId, podcastId, change) {
        reach()
        stateWrites.push({ ...change })
        const saved = storeState(episodeId, podcastId, change)
        // The write's own subscription event arrives separately from its response, as with the real API.
        queueMicrotask(() => {
          notify(stateListeners.get(podcastId), statesOf(podcastId))
          notify(queueListeners, { entries: queue(), asOf: saved.updatedAt })
        })
        return saved
      },
      observeQueue(observer) {
        return listen(connection, queueListeners, observer, () => ({ entries: queue(), asOf: null }))
      },
    }
  }

  function device() {
    const connection: Connection = { asleep: false }
    return Object.assign(view(connection), {
      /** Live updates stop arriving, as when iOS suspends the app in the background. */
      sleep() {
        connection.asleep = true
      },
      /** Live updates arrive again. Those missed while asleep are not replayed. */
      wake() {
        connection.asleep = false
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
    /** The network goes down for every device: requests fail and live updates stop. */
    goOffline() {
      offline = true
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
    /**
     * Delivers ingested episodes, as the background step does after adding the
     * podcast. An episode given no enclosure URL gets one of its own. Returns their IDs.
     */
    ingest(
      podcastId: string,
      newEpisodes: (Omit<Episode, 'podcastId' | 'id' | 'enclosureUrl'> & Partial<Pick<Episode, 'enclosureUrl'>>)[],
    ) {
      const ids = newEpisodes.map((episode) => {
        const id = `episode-${nextId++}`
        episodes.push({ id, podcastId, enclosureUrl: `https://media.example.com/${id}.mp3`, ...episode })
        return id
      })
      notify(episodeListeners.get(podcastId), episodesOf(podcastId))
      return ids
    },
    /** Listening state saved earlier, by this device or another. */
    seedEpisodeState({
      episodeId,
      podcastId,
      ...state
    }: Omit<EpisodeState, 'queueOrder'> & Partial<Pick<EpisodeState, 'queueOrder'>>) {
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
 * `refuseNextPlay`.
 */
export class FakeAudio extends EventTarget implements AudioElement {
  #src = ''
  #currentTime = 0
  duration = NaN
  playbackRate = 1
  defaultPlaybackRate = 1
  paused = true
  ended = false
  #refuseNextPlay = false
  #ignoresEarlySeeks = false

  get src() {
    return this.#src
  }

  set src(url: string) {
    this.#src = url
    // As in a real element, a new load returns to the default rate.
    this.playbackRate = this.defaultPlaybackRate
    this.paused = true
    this.ended = false
    this.#currentTime = 0
    this.duration = NaN
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
    this.dispatchEvent(new Event('durationchange'))
    this.dispatchEvent(new Event('loadedmetadata'))
  }

  /** Playback has reached this point. */
  progressTo(seconds: number) {
    this.#currentTime = seconds
    this.dispatchEvent(new Event('timeupdate'))
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
  #handlers = new Map<MediaSessionAction, ActionHandler>()

  setMetadata(metadata: MediaMetadataInit | null) {
    this.metadata = metadata
  }

  setPlaybackState(state: MediaSessionPlaybackState) {
    this.playbackState = state
  }

  setPositionState(state: MediaPositionState | null) {
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

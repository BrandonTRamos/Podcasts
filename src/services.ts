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

/** The session stored on this device, as far as can be told. */
export type StoredSession =
  | { status: 'signedIn'; user: User }
  | { status: 'signedOut' }
  /**
   * A session is stored, but whether it still holds can't be told: it has
   * expired, and renewing it needs the network. The listener stays in.
   */
  | { status: 'unconfirmed' }

export interface AuthService {
  /** The session stored on this device. Needs no network unless it has expired. */
  storedSession(): Promise<StoredSession>
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
  /**
   * The category the listener put it in; null for none. One that names a
   * category since deleted counts as none: the podcast is in Other.
   */
  categoryId: string | null
  /**
   * Where the listener put it in its category's list (or Other's): lowest
   * first, then those with none, by title. Null until moved. Fractional, so
   * moving one podcast is usually a single write.
   */
  libraryOrder: number | null
  /**
   * Where it is among the listener's favorites, lowest first; null when not a
   * favorite. A favorite stays in its category as well: Favorites, pinned to
   * the library's top, shows a copy.
   */
  favoriteOrder: number | null
}

/** A group of podcasts the listener made, such as News or Movies. A podcast is in one at most. */
export interface Category {
  id: string
  name: string
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
  /**
   * When the listener added it to its podcast's Recently Added (ISO 8601), by
   * its Add button or by adding it from the feed's older episodes. Null when
   * they have not, or have taken it back out.
   */
  addedAt: string | null
}

/** Some fields of an episode's listening state, to change while leaving the others as they are. */
export type EpisodeStateChange = Partial<Pick<EpisodeState, 'positionSeconds' | 'played' | 'queueOrder' | 'addedAt'>>

export interface SavedEpisodeState extends EpisodeState {
  /** When the backend stored it (ISO 8601). The later of two saves wins. */
  updatedAt: string
}

/** An episode in the queue, with the listening state that places it there. */
export interface QueuedEpisode {
  episode: Episode
  state: SavedEpisodeState
}

/** An episode started but not finished, with the listening state that says so. */
export interface InProgressEpisode {
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

/** A podcast as the public directory lists it. */
export interface DirectoryPodcast {
  title: string
  author: string | null
  artworkUrl: string | null
  /** Public, from the directory. What subscribing to the result subscribes to; never shown. */
  feedUrl: string
  /** Its ID in the library, if it was already there when searched; null if not. */
  podcastId: string | null
}

/** The genres the directory's charts can be browsed by. */
export const DIRECTORY_GENRES = [
  'arts',
  'business',
  'comedy',
  'education',
  'fiction',
  'government',
  'healthFitness',
  'history',
  'kidsFamily',
  'leisure',
  'music',
  'news',
  'religionSpirituality',
  'science',
  'societyCulture',
  'sports',
  'technology',
  'trueCrime',
  'tvFilm',
] as const

export type DirectoryGenre = (typeof DIRECTORY_GENRES)[number]

/** What the directory answers a search or a chart with. */
export type PodcastSearch =
  /** The directory's podcasts, best first; empty when it had none. */
  | { outcome: 'found'; podcasts: DirectoryPodcast[] }
  /** The directory couldn't be reached, or gave no usable answer. */
  | { outcome: 'directoryUnavailable' }

/** What searching a podcast's whole feed for episodes answers with. */
export type EpisodeSearch =
  /**
   * The feed's matching episodes, newest first, up to 50 of them: empty when
   * it had none. Some may be in the library already, and the rest are not
   * until kept (`DataApi.keepEpisode`). `more` says more matched than are given.
   */
  | { outcome: 'found'; episodes: Episode[]; more: boolean }
  /** The feed couldn't be fetched, or the podcast has left the library. */
  | { outcome: 'feedUnavailable' }

/** How keeping an episode from a podcast's feed ended. */
export type KeepEpisodeOutcome =
  | 'kept'
  /** The feed no longer lists the episode, or the podcast has left the library. */
  | 'notFound'
  /** The feed couldn't be fetched. */
  | 'feedUnavailable'

/**
 * How a temporary copy of an episode's file stands, prepared by the backend
 * for a publisher whose host doesn't let the app download it directly.
 */
export type StagingState =
  | { status: 'preparing' }
  /** The copy is ready at `url`, a private link that stops working at `expiresAt` (ISO 8601). */
  | { status: 'ready'; url: string; expiresAt: string }
  /** The publisher's host didn't send the file. */
  | { status: 'unavailable' }
  /** The copy couldn't be made. */
  | { status: 'failed' }

/** How preparing a copy ended. */
export type SettledStaging = Exclude<StagingState, { status: 'preparing' }>

export const LATEST_EPISODES_LIMIT = 50

export interface Observer<T> {
  next(value: T): void
  error(): void
}

export interface DataApi {
  /** The library, kept current as podcasts are added. Returns a function that stops observing. */
  observePodcasts(observer: Observer<Podcast[]>): () => void
  /** The listener's categories, in no particular order, kept current as they change. */
  observeCategories(observer: Observer<Category[]>): () => void
  /** Throws when the backend can't be reached. */
  createCategory(name: string): Promise<Category>
  /** Throws when the backend can't be reached. */
  renameCategory(categoryId: string, name: string): Promise<void>
  /**
   * Deletes the category. Its podcasts stay in the library, in Other: each
   * still names it, which counts as none. Throws when the backend can't be reached.
   */
  deleteCategory(categoryId: string): Promise<void>
  /**
   * Puts the podcast in the category, or in none (Other) for null, among those
   * not placed by hand (it forgets its `libraryOrder`). The change arrives
   * through `observePodcasts`. Throws when the backend can't be reached.
   */
  setPodcastCategory(podcastId: string, categoryId: string | null): Promise<void>
  /**
   * Puts the podcast in the category (null for Other) at the given place in its
   * list. The change arrives through `observePodcasts`. Throws when the backend
   * can't be reached.
   */
  placePodcast(podcastId: string, categoryId: string | null, libraryOrder: number): Promise<void>
  /**
   * Makes the podcast a favorite at the given place among them, or no longer
   * one for null. The change arrives through `observePodcasts`. Throws when
   * the backend can't be reached.
   */
  placeFavorite(podcastId: string, favoriteOrder: number | null): Promise<void>
  /** One podcast's episodes, in no particular order, kept current as they are ingested. */
  observeEpisodes(podcastId: string, observer: Observer<Episode[]>): () => void
  /**
   * An episode's show notes as the feed gave them: untrusted HTML or plain
   * text, to sanitise before display. Null when it has none or no longer
   * exists. Throws when the backend can't be reached.
   */
  getShowNotes(episodeId: string): Promise<string | null>
  /**
   * Searches the podcast's whole feed, however far back it goes, for episodes
   * whose title or show notes have every word of the term. The library holds
   * only each feed's newest episodes; this reaches the rest, and stores
   * nothing. Throws when the backend can't be reached.
   */
  searchEpisodes(podcastId: string, term: string): Promise<EpisodeSearch>
  /**
   * Adds an episode found by `searchEpisodes` to the library, where it stays:
   * it then plays, queues and downloads like any other. Resolves once it is
   * stored; it arrives through `observeEpisodes` too. Throws when the backend
   * can't be reached.
   */
  keepEpisode(podcastId: string, episodeId: string): Promise<KeepEpisodeOutcome>
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
  /** Searches the public podcast directory by name. Throws when the backend can't be reached. */
  searchPodcasts(term: string): Promise<PodcastSearch>
  /**
   * The public directory's most popular podcasts, most popular first: in one
   * genre, or with null over all. Throws when the backend can't be reached.
   */
  topPodcasts(genre: DirectoryGenre | null): Promise<PodcastSearch>
  /** Returns at once; the feed is fetched and checked in the background. */
  subscribeToFeed(feedUrl: string): Promise<SubscribeStart>
  /**
   * Removes the podcast from the library, with its episodes and their
   * listening state (queue places included). Resolves once they are gone;
   * observers then see them leave. Throws when the backend can't be reached.
   */
  unsubscribe(podcastId: string): Promise<void>
  /** A subscribe request's state, now and as it changes. */
  observeSubscribeRequest(requestId: string, observer: Observer<SubscribeRequestState>): () => void
  /**
   * The listening state of one podcast's episodes, all of it once fetched and
   * then as any device saves it. Episodes never played have none.
   */
  observeEpisodeStates(podcastId: string, observer: Observer<SavedEpisodeState[]>): () => void
  /**
   * Changes only the given fields of an episode's listening state, so an
   * earlier change made elsewhere to another field survives. An episode with
   * no state yet starts at the beginning, unplayed. `changedAt` is when the
   * listener made the change (ISO 8601), which may be long before it is sent,
   * as for one made offline. The most recent change to an episode wins,
   * wherever it was made: if the backend holds one made later, this whole
   * change is dropped, even the fields the later one left alone. Returns the
   * whole state as saved, the later change's when this one lost.
   */
  saveEpisodeState(
    episodeId: string,
    podcastId: string,
    change: EpisodeStateChange,
    changedAt: string,
  ): Promise<SavedEpisodeState>
  /**
   * Every queued episode, whatever its podcast, with its details and listening
   * state: all of them once fetched, then again whenever any device changes the
   * queue. Each delivery is the whole queue, so an episode missing from it has
   * left (see `QueueSnapshot.asOf`).
   */
  observeQueue(observer: Observer<QueueSnapshot>): () => void
  /**
   * Every episode started but not finished (a position past the start, not
   * played), whatever its podcast, with its details and listening state: all
   * of them once fetched, then again whenever any device starts, finishes or
   * moves on in one. Each delivery is the whole list, in no particular order.
   */
  observeInProgress(observer: Observer<InProgressEpisode[]>): () => void
  /**
   * Asks the backend to prepare a temporary copy of the episode's file, for
   * when its host blocks direct download. Returns at once; the copy is made
   * in the background, and the observer hears how it stands as that changes.
   * The observer's `error` is called when the backend can't be reached.
   * Returns a function that stops observing.
   */
  stageDownload(episodeId: string, observer: Observer<StagingState>): () => void
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
  /**
   * How much of the file the element holds where it is: 0 nothing, 1 its
   * metadata, 2 the current moment, 3 enough to play on a little, 4 enough to
   * play on through. It can fall back after loading, as when iOS lets go of a
   * paused file.
   */
  readonly readyState: number
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

/**
 * Files kept on this device, in one flat folder: the Origin Private File
 * System. Names are plain file names, with no slashes.
 */
export interface DeviceFiles {
  /** The name of every file stored. */
  list(): Promise<string[]>
  /** The file's size in bytes, or null when there is no such file. */
  size(name: string): Promise<number | null>
  /**
   * Opens the file to write to its end, creating it if absent, or emptying it
   * first when `fresh`. Each write is stored durably before it resolves, so
   * the app being killed part way keeps every write that resolved.
   */
  openForAppend(name: string, options?: { fresh?: boolean }): Promise<FileAppender>
  /** Renames the file, replacing any already called `to`. */
  rename(from: string, to: string): Promise<void>
  /**
   * A URL the audio element can play the file from, seeking included, valid
   * for as long as the app is open. Null when there is no such file.
   */
  playbackUrl(name: string): Promise<string | null>
  /** Deletes the file, if there is one. */
  remove(name: string): Promise<void>
}

export interface FileAppender {
  /**
   * Adds the bytes to the end of the file. It may take over the chunk's
   * buffer rather than copy it, leaving the chunk empty. Rejects when the
   * device is out of space (`QuotaExceededError`).
   */
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

/** The parts of the browser's `fetch` that downloading uses. */
export type Fetch = (
  url: string,
  init?: { headers?: Record<string, string>; mode?: 'cors' | 'no-cors'; signal?: AbortSignal },
) => Promise<Response>

/** A hold on the screen, keeping it from dimming and locking. The system drops it when the app is hidden. */
export interface ScreenHold {
  readonly released: boolean
  release(): Promise<void>
}

/**
 * Small text records kept on this device across launches, apart from other
 * devices: the local copy of the library and changes not yet synced. Keys are
 * the app's own; nothing else stores under them.
 */
export interface DeviceStorage {
  /** The value stored under the key, or null when there is none. */
  get(key: string): string | null
  /** Throws when the device has no room for it. */
  set(key: string, value: string): void
  remove(key: string): void
  /** Every key with something stored. */
  keys(): string[]
}

/**
 * What playback has done lately on this device, kept across launches: for
 * working out why it went wrong where no debugger reaches, the lock screen of
 * a phone above all. Settings hands it over to be copied.
 */
export interface PlaybackLog {
  /** Adds a line, stamped with the time. Once the log is full, the oldest line goes. */
  record(line: string): void
  /** Every line kept, oldest first. */
  lines(): string[]
}

/**
 * The device's own facilities: its file storage, small records, the network,
 * and the screen. `device.ts` implements them with browser APIs; tests
 * substitute fakes.
 */
export interface Device {
  files: DeviceFiles
  storage: DeviceStorage
  playbackLog: PlaybackLog
  fetch: Fetch
  /** Whether the device has a network connection, as the browser judges it. False means certainly offline. */
  isOnline(): boolean
  /** Calls the listener whenever the device goes online or offline. Returns a function that stops it. */
  watchConnectivity(listener: () => void): () => void
  /** Keeps the screen on until released. Rejects where the browser can't or won't. */
  keepScreenOn(): Promise<ScreenHold>
  /** Asks the browser not to clear stored files when space runs low. Resolves to whether it agreed. */
  persistStorage(): Promise<boolean>
  /**
   * Loads the app afresh, as a browser's reload button does. The installed app
   * has no such button, and a reload is what shows a newly deployed version.
   */
  reload(): void
  /**
   * Calls the listener when a version of the app newer than the one running
   * has been deployed, so the app can offer a reload. Returns a function that
   * stops watching.
   */
  watchForNewVersion(listener: () => void): () => void
}

export interface Services {
  auth: AuthService
  data: DataApi
  /** The one audio element the app plays through, for its whole lifetime. */
  audio: AudioElement
  mediaSession: MediaSessionControls
  device: Device
}

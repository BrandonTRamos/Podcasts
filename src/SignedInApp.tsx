import { useCallback, useEffect, useRef, useState } from 'react'
import { useDownloads } from './downloads'
import { DownloadsScreen } from './DownloadsScreen'
import type { EpisodeActions } from './EpisodeRow'
import { EpisodeScreen } from './EpisodeScreen'
import { LatestScreen } from './LatestScreen'
import { FAVORITES_SECTION, LibraryScreen, type LibraryView, type OpenSections } from './LibraryScreen'
import { createListeningStore, resumePosition, useEpisodeStates } from './listening'
import { readJson, writeJson } from './localCopy'
import { MiniPlayer, NowPlayingScreen } from './NowPlaying'
import { useOnline } from './online'
import { useOpmlImport } from './opmlImport'
import { type PlayableEpisode, type SaveProgress, type TakeNext, usePlayer } from './player'
import { PodcastScreen, type PodcastView } from './PodcastScreen'
import { PullToRefresh } from './PullToRefresh'
import { QueueScreen } from './QueueScreen'
import { SearchScreen } from './SearchScreen'
import { SettingsPill, SettingsScreen } from './SettingsScreen'
import { type Tab, TabBar } from './TabBar'
import { UpdateBanner } from './UpdateBanner'
import type {
  AudioElement,
  Category,
  DataApi,
  Device,
  DeviceStorage,
  Episode,
  MediaSessionControls,
  Podcast,
} from './services'
import type { Theme } from './theme'

/** Where the episode last loaded in the player is kept, for the next launch to have it ready. */
const LAST_EPISODE_KEY = 'lastEpisode'

/** The episode last loaded on this device, if one is kept and looks whole. */
function storedLastEpisode(storage: DeviceStorage): PlayableEpisode | undefined {
  const episode = readJson<PlayableEpisode>(storage, LAST_EPISODE_KEY)
  const whole =
    typeof episode === 'object' &&
    episode !== null &&
    typeof episode.id === 'string' &&
    typeof episode.podcastId === 'string' &&
    typeof episode.title === 'string' &&
    typeof episode.enclosureUrl === 'string'
  return whole ? episode : undefined
}

export type LoadState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: T[] }

/** The screen each tab opens. */
const tabScreens: Record<Tab, Screen> = {
  library: { name: 'library' },
  latest: { name: 'latest' },
  queue: { name: 'queue' },
  downloads: { name: 'downloads' },
  search: { name: 'search' },
}

function findPodcast(podcasts: LoadState<Podcast>, podcastId: string): Podcast | undefined {
  return podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === podcastId) : undefined
}

/** The screens that pulling down from the top refreshes: those a tab opens, but search, whose results are its own. */
const PULL_TO_REFRESH: ReadonlySet<Screen['name']> = new Set(['library', 'latest', 'queue', 'downloads'])

/** A screen a tab or another screen leads to; an episode's own screen is opened over one of these. */
type MainScreen =
  | { name: 'podcast'; podcastId: string }
  | { name: 'latest' }
  | { name: 'library' }
  | { name: 'queue' }
  | { name: 'search' }
  | { name: 'downloads' }
  | { name: 'settings' }

/** What an episode's back button calls the screen it returns to; a podcast goes by its title. The library lists episodes in progress. */
const BACK_LABELS: Record<Exclude<MainScreen['name'], 'podcast'>, string> = {
  latest: 'Latest episodes',
  library: 'In Progress',
  queue: 'Queue',
  search: 'Search',
  downloads: 'Downloads',
  settings: 'Settings',
}

type Screen =
  | MainScreen
  /**
   * One episode, with its show notes. Going back returns to the screen it was
   * opened from or, opened from now playing, to now playing over that screen.
   */
  | { name: 'episode'; episode: Episode; from: MainScreen; fromNowPlaying: boolean }

export function SignedInApp({
  data: backend,
  audio,
  mediaSession,
  device,
  onSignOut,
  sessionExpired = false,
  onSignIn,
  theme,
  onChooseTheme,
}: {
  data: DataApi
  audio: AudioElement
  mediaSession: MediaSessionControls
  device: Device
  onSignOut: () => Promise<void>
  /** The session has expired and can't be renewed: nothing syncs until the listener signs in again. */
  sessionExpired?: boolean
  /** Takes the listener to sign in again. */
  onSignIn?: () => void
  /** The theme chosen on this device. */
  theme: Theme
  onChooseTheme: (theme: Theme) => void
}) {
  // A fresh copy of the data API after each refresh, so every screen's live
  // observations, which start over when it changes, fetch again whatever
  // they missed (as while iOS had the app suspended).
  const [refreshed, setRefreshed] = useState<{ of: DataApi; data: DataApi } | null>(null)
  const data = refreshed?.of === backend ? refreshed.data : backend
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  /** Now playing takes the place of the current screen; closing it goes back there. */
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [podcasts, setPodcasts] = useState<LoadState<Podcast>>({ status: 'loading' })
  const [categories, setCategories] = useState<LoadState<Category>>({ status: 'loading' })
  // Here rather than on the library, so a category opened stays open while the listener visits a podcast.
  // Favorites start open; the rest closed.
  const [openSections, setOpenSections] = useState<OpenSections>(() => new Set([FAVORITES_SECTION]))
  // Here too, so the library opens on the same view on coming back to it.
  const [libraryView, setLibraryView] = useState<LibraryView>('podcasts')
  const [listening] = useState(() => createListeningStore(backend, device.storage))
  const online = useOnline(device)
  // Here rather than on the library, so an import carries on while the listener goes elsewhere.
  const opmlImport = useOpmlImport(backend)
  const saveProgress = useCallback<SaveProgress>(
    (episode, { positionSeconds, played }) =>
      listening.update(episode.id, episode.podcastId, played ? { positionSeconds, played } : { positionSeconds }),
    [listening],
  )
  // Read when the player moves on by itself, which is outside any render.
  const podcastsRef = useRef(podcasts)
  useEffect(() => {
    podcastsRef.current = podcasts
  }, [podcasts])
  const toPlayable = useCallback((episode: Episode): PlayableEpisode => {
    const podcast = findPodcast(podcastsRef.current, episode.podcastId)
    return {
      id: episode.id,
      podcastId: episode.podcastId,
      title: episode.title,
      enclosureUrl: episode.enclosureUrl,
      durationSeconds: episode.durationSeconds,
      podcastTitle: podcast?.title ?? null,
      artworkUrl: podcast?.artworkUrl ?? null,
    }
  }, [])
  const takeNext = useCallback<TakeNext>(() => {
    const episode = listening.takeNext()
    if (!episode) return null
    return { episode: toPlayable(episode), startAt: resumePosition(listening.get(episode.id)) ?? 0 }
  }, [listening, toPlayable])
  const downloads = useDownloads(device, backend)
  const queue = listening.queue()
  const { player, state: playerState } = usePlayer(
    audio,
    mediaSession,
    saveProgress,
    takeNext,
    downloads.localCopy,
    queue.length > 0,
  )
  const loaded = playerState.episode

  // The episode loaded when the app last closed is ready to play again, paused
  // where the listener left it. Its file loads only when played.
  const [lastEpisode] = useState(() => storedLastEpisode(device.storage))
  useEffect(() => {
    if (lastEpisode) player.cue(lastEpisode, resumePosition(listening.get(lastEpisode.id)) ?? 0)
  }, [player, listening, lastEpisode])
  useEffect(() => {
    if (loaded) writeJson(device.storage, LAST_EPISODE_KEY, loaded)
  }, [device.storage, loaded])

  // The queue is kept current for as long as the app is open, so the player
  // can move on to an episode queued on another device without fetching it then.
  useEffect(() => listening.watchQueue(), [listening])

  // Keep the loaded episode's state current wherever the listener is, so a
  // position saved on another device reaches it.
  useEpisodeStates(listening, loaded?.podcastId ?? null)
  const loadedId = loaded?.id ?? null
  const loadedResumePosition = loadedId === null ? null : resumePosition(listening.get(loadedId))
  useEffect(() => {
    if (loadedId !== null && loadedResumePosition !== null) player.adoptSavedPosition(loadedId, loadedResumePosition)
  }, [player, loadedId, loadedResumePosition])

  // Changes made offline, in this launch or an earlier one, go to the backend
  // as soon as it may be reachable.
  useEffect(() => {
    listening.sendUnsynced()
    return device.watchConnectivity(() => {
      if (device.isOnline()) listening.sendUnsynced()
    })
  }, [listening, device])

  // A deploy since the app opened doesn't reach it until it reloads, so say when one has.
  const [newVersion, setNewVersion] = useState(false)
  useEffect(() => device.watchForNewVersion(() => setNewVersion(true)), [device])

  // Live updates can be missed while the app is in the background (iOS
  // suspends it), so catch up on what other devices saved when it comes back.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') listening.refresh()
    }
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => document.removeEventListener('visibilitychange', refreshIfVisible)
  }, [listening])

  useEffect(
    () =>
      data.observePodcasts({
        next: (items) => setPodcasts({ status: 'loaded', items }),
        error: () => setPodcasts({ status: 'failed' }),
      }),
    [data],
  )

  useEffect(
    () =>
      data.observeCategories({
        next: (items) => setCategories({ status: 'loaded', items }),
        error: () => setCategories({ status: 'failed' }),
      }),
    [data],
  )

  const toggleSection = useCallback(
    (section: string) =>
      setOpenSections((open) => {
        const next = new Set(open)
        if (!next.delete(section)) next.add(section)
        return next
      }),
    [],
  )

  /**
   * Stops any episode of the podcast playing, so it saves no position while
   * the backend removes it, then, once removed, forgets the listener's place
   * in its episodes. Playback stays stopped if removing fails.
   */
  async function unsubscribe(podcastId: string) {
    if (player.getState().episode?.podcastId === podcastId) stopPlayer()
    await data.unsubscribe(podcastId)
    listening.forgetPodcast(podcastId)
    void downloads.removePodcast(podcastId)
    setScreen({ name: 'library' })
  }

  /** Deletes the episode's download, first stopping it if it is playing, as it may be playing the copy. */
  function removeDownload(episodeId: string) {
    if (player.getState().episode?.id === episodeId) stopPlayer()
    void downloads.remove(episodeId)
  }

  /** Stops and unloads the player, and forgets the episode, so the next launch doesn't have it ready either. */
  function stopPlayer() {
    player.stop()
    device.storage.remove(LAST_EPISODE_KEY)
  }

  /** What the open podcast's episodes are searched for. Here, so it is still there on coming back from one of its episodes. */
  const [episodeSearch, setEpisodeSearch] = useState('')
  /** Which of the open podcast's tabs shows. Here for the same reason. */
  const [podcastView, setPodcastView] = useState<PodcastView>('episodes')
  const openPodcast = useCallback((podcastId: string) => {
    setEpisodeSearch('')
    setPodcastView('episodes')
    setScreen({ name: 'podcast', podcastId })
  }, [])

  const podcastById = (podcastId: string) => findPodcast(podcasts, podcastId)

  /**
   * Catches up on everything: what other devices saved, and the library and
   * episodes as the backend has them, then asks for every podcast's feed to be
   * fetched now rather than at the next hourly refresh. New episodes arrive
   * as each refresh finds them. Throws if any podcast couldn't be asked, or
   * at once when offline, leaving what is shown as it is.
   */
  async function refreshAll() {
    if (!device.isOnline()) throw new Error('Offline')
    listening.refresh()
    setRefreshed({ of: backend, data: { ...backend } })
    const current = podcastsRef.current
    const podcastIds = current.status === 'loaded' ? current.items.map((podcast) => podcast.id) : []
    const asked = await Promise.allSettled(podcastIds.map((podcastId) => backend.refreshPodcast(podcastId)))
    if (asked.some((result) => result.status === 'rejected')) throw new Error('Some podcasts could not be refreshed')
  }

  /** Plays the episode now; if it was queued, it leaves the queue. */
  function playEpisode(episode: Episode) {
    player.play(toPlayable(episode), resumePosition(listening.get(episode.id)) ?? 0)
    listening.dequeue(episode.id)
  }

  const unavailable = (episodeId: string) => !online && downloads.get(episodeId).status !== 'downloaded'

  const episodeActions: EpisodeActions = {
    onPlay: playEpisode,
    onPause: player.pause,
    isPlaying: (episodeId) => playerState.episode !== null && playerState.playing && playerState.episode.id === episodeId,
    onOpen: (episode) => openEpisode(episode),
    onQueue: (episode, where) => listening.enqueue(episode, where),
    onMarkPlayed: (episode, played) =>
      listening.update(episode.id, episode.podcastId, played ? { played } : { played, positionSeconds: 0 }),
    onDownload: downloads.download,
    downloadOf: downloads.get,
    unavailable,
  }

  /** Opens the episode's own screen, with its show notes, over the current one. */
  function openEpisode(episode: Episode, fromNowPlaying = false) {
    setScreen({ name: 'episode', episode, from: screen.name === 'episode' ? screen.from : screen, fromNowPlaying })
    setNowPlayingOpen(false)
  }

  function openQueue() {
    setNowPlayingOpen(false)
    setScreen({ name: 'queue' })
  }

  /**
   * The tab the current screen belongs to: a podcast is in the library, and an
   * episode is where it was opened from. Settings, opened from the top, is in none.
   */
  const under = screen.name === 'episode' ? screen.from : screen
  const tab: Tab | null = under.name === 'settings' ? null : under.name === 'podcast' ? 'library' : under.name

  const showingNowPlaying = nowPlayingOpen && playerState.episode !== null

  let content
  if (nowPlayingOpen && playerState.episode) {
    const { id, podcastId, title, durationSeconds, enclosureUrl } = playerState.episode
    content = (
      <NowPlayingScreen
        state={playerState}
        player={player}
        onClose={() => setNowPlayingOpen(false)}
        // The player doesn't keep when an episode came out, so its screen goes without the date.
        onOpenShowNotes={() => openEpisode({ id, podcastId, title, durationSeconds, enclosureUrl, publishedAt: null }, true)}
        onOpenQueue={openQueue}
      />
    )
  } else if (screen.name === 'queue') {
    content = (
      <QueueScreen
        queue={queue}
        status={listening.queueStatus()}
        podcastTitleOf={(podcastId) => podcastById(podcastId)?.title}
        onPlay={playEpisode}
        onOpen={openEpisode}
        onMove={(episodeId, index) => listening.moveInQueue(episodeId, index)}
        onRemove={(episodeId) => listening.dequeue(episodeId)}
        downloaded={(episodeId) => downloads.get(episodeId).status === 'downloaded'}
        unavailable={unavailable}
      />
    )
  } else if (screen.name === 'episode') {
    const { episode, from, fromNowPlaying } = screen
    content = (
      <EpisodeScreen
        key={episode.id}
        data={data}
        episode={episode}
        podcastTitle={podcastById(episode.podcastId)?.title}
        listening={listening}
        backLabel={
          fromNowPlaying
            ? 'Now Playing'
            : from.name === 'podcast'
              ? (podcastById(from.podcastId)?.title ?? 'Podcast')
              : BACK_LABELS[from.name]
        }
        onBack={() => {
          setScreen(from)
          if (fromNowPlaying) setNowPlayingOpen(true)
        }}
        onPlay={playEpisode}
        download={downloads.get(episode.id)}
        onDownload={downloads.download}
        unavailable={unavailable(episode.id)}
      />
    )
  } else if (screen.name === 'latest') {
    content = (
      <LatestScreen
        data={data}
        listening={listening}
        podcastOf={podcastById}
        {...episodeActions}
      />
    )
  } else if (screen.name === 'downloads') {
    content = (
      <DownloadsScreen
        downloads={downloads.list()}
        podcastTitleOf={(podcastId) => podcastById(podcastId)?.title}
        onPlay={playEpisode}
        onOpen={openEpisode}
        onDownload={downloads.download}
        onRemove={removeDownload}
      />
    )
  } else if (screen.name === 'settings') {
    content = <SettingsScreen theme={theme} onChooseTheme={onChooseTheme} />
  } else if (screen.name === 'search') {
    content = (
      <SearchScreen
        data={data}
        podcasts={podcasts}
        onOpenPodcast={openPodcast}
      />
    )
  } else if (screen.name === 'podcast') {
    content = (
      <PodcastScreen
        data={data}
        podcastId={screen.podcastId}
        podcast={podcastById(screen.podcastId)}
        categories={categories.status === 'loaded' ? categories.items : undefined}
        listening={listening}
        view={podcastView}
        onSelectView={setPodcastView}
        searchTerm={episodeSearch}
        onSearchTermChange={setEpisodeSearch}
        onBack={() => setScreen({ name: 'library' })}
        onUnsubscribe={() => unsubscribe(screen.podcastId)}
        {...episodeActions}
      />
    )
  } else {
    content = (
      <LibraryScreen
        view={libraryView}
        onSelectView={setLibraryView}
        podcasts={podcasts}
        categories={categories}
        openSections={openSections}
        onToggleSection={toggleSection}
        data={data}
        listening={listening}
        episodeActions={episodeActions}
        onOpenPodcast={openPodcast}
        onSignOut={onSignOut}
        opmlImport={opmlImport.state}
        onImportOpml={(file) => void opmlImport.importFile(file)}
      />
    )
  }

  return (
    <div className={showingNowPlaying ? undefined : playerState.episode ? 'with-tab-bar with-mini-player' : 'with-tab-bar'}>
      <PullToRefresh enabled={!showingNowPlaying && PULL_TO_REFRESH.has(screen.name)} onRefresh={refreshAll}>
        {!online && (
          <p className="connection-notice" role="status">
            You’re offline. Downloaded episodes still play, and what you play syncs when you’re back online.
          </p>
        )}
        {online && sessionExpired && (
          <section className="connection-notice" role="status" aria-label="Session expired">
            <p>Sign in again to sync what you play on this device.</p>
            <button type="button" onClick={onSignIn}>
              Sign in
            </button>
          </section>
        )}
        {content}
      </PullToRefresh>
      {/* At the top and foot of every screen but now playing, which has the full controls and a way out of its own. */}
      {!showingNowPlaying && (
        <SettingsPill current={screen.name === 'settings'} onOpen={() => setScreen({ name: 'settings' })} />
      )}
      {!showingNowPlaying && (
        <div className="bottom-bars">
          {newVersion && <UpdateBanner onRefresh={device.reload} />}
          {playerState.episode && <MiniPlayer state={playerState} player={player} onOpen={() => setNowPlayingOpen(true)} />}
          <TabBar current={tab} onSelect={(name) => setScreen(tabScreens[name])} />
        </div>
      )}
    </div>
  )
}

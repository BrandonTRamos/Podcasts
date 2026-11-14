import { useCallback, useEffect, useState } from 'react'
import { LibraryScreen } from './LibraryScreen'
import { createListeningStore, resumePosition, useEpisodeStates } from './listening'
import { MiniPlayer, NowPlayingScreen } from './NowPlaying'
import { type SaveProgress, usePlayer } from './player'
import { PodcastScreen } from './PodcastScreen'
import type { AudioElement, DataApi, Episode, MediaSessionControls, Podcast } from './services'

export type LoadState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: T[] }

type Screen = { name: 'library' } | { name: 'podcast'; podcastId: string }

export function SignedInApp({
  data,
  audio,
  mediaSession,
  onSignOut,
}: {
  data: DataApi
  audio: AudioElement
  mediaSession: MediaSessionControls
  onSignOut: () => Promise<void>
}) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  /** Now playing takes the place of the current screen; closing it goes back there. */
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [podcasts, setPodcasts] = useState<LoadState<Podcast>>({ status: 'loading' })
  const [listening] = useState(() => createListeningStore(data))
  const saveProgress = useCallback<SaveProgress>(
    (episode, { positionSeconds, played }) =>
      listening.update(episode.id, episode.podcastId, played ? { positionSeconds, played } : { positionSeconds }),
    [listening],
  )
  const { player, state: playerState } = usePlayer(audio, mediaSession, saveProgress)

  // Keep the loaded episode's state current wherever the listener is, so a
  // position saved on another device reaches it.
  const loaded = playerState.episode
  useEpisodeStates(listening, loaded?.podcastId ?? null)
  const loadedId = loaded?.id ?? null
  const loadedResumePosition = loadedId === null ? null : resumePosition(listening.get(loadedId))
  useEffect(() => {
    if (loadedId !== null && loadedResumePosition !== null) player.adoptSavedPosition(loadedId, loadedResumePosition)
  }, [player, loadedId, loadedResumePosition])

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

  const openPodcast = useCallback((podcastId: string) => setScreen({ name: 'podcast', podcastId }), [])

  const podcastById = (podcastId: string) =>
    podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === podcastId) : undefined

  function playEpisode(episode: Episode) {
    const podcast = podcastById(episode.podcastId)
    const startAt = resumePosition(listening.get(episode.id)) ?? 0
    player.play(
      {
        id: episode.id,
        podcastId: episode.podcastId,
        title: episode.title,
        enclosureUrl: episode.enclosureUrl,
        durationSeconds: episode.durationSeconds,
        podcastTitle: podcast?.title ?? null,
        artworkUrl: podcast?.artworkUrl ?? null,
      },
      startAt,
    )
  }

  let content
  if (nowPlayingOpen && playerState.episode) {
    content = <NowPlayingScreen state={playerState} player={player} onClose={() => setNowPlayingOpen(false)} />
  } else if (screen.name === 'podcast') {
    content = (
      <PodcastScreen
        data={data}
        podcastId={screen.podcastId}
        podcast={podcastById(screen.podcastId)}
        listening={listening}
        onBack={() => setScreen({ name: 'library' })}
        onPlayEpisode={playEpisode}
      />
    )
  } else {
    content = <LibraryScreen podcasts={podcasts} data={data} onOpenPodcast={openPodcast} onSignOut={onSignOut} />
  }

  return (
    <div className={playerState.episode ? 'with-mini-player' : undefined}>
      {content}
      {/* On every screen, now playing included, where tapping it to open now playing changes nothing. */}
      {playerState.episode && (
        <MiniPlayer state={playerState} player={player} onOpen={() => setNowPlayingOpen(true)} />
      )}
    </div>
  )
}

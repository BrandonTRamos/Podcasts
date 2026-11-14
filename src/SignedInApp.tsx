import { useCallback, useEffect, useState } from 'react'
import { LibraryScreen } from './LibraryScreen'
import { MiniPlayer, NowPlayingScreen } from './NowPlaying'
import { usePlayer } from './player'
import { PodcastScreen } from './PodcastScreen'
import type { AudioElement, DataApi, Episode, Podcast } from './services'

export type LoadState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: T[] }

type Screen = { name: 'library' } | { name: 'podcast'; podcastId: string }

export function SignedInApp({
  data,
  audio,
  onSignOut,
}: {
  data: DataApi
  audio: AudioElement
  onSignOut: () => Promise<void>
}) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  /** Now playing takes the place of the current screen; closing it goes back there. */
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false)
  const [podcasts, setPodcasts] = useState<LoadState<Podcast>>({ status: 'loading' })
  const { player, state: playerState } = usePlayer(audio)

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
    player.play({
      id: episode.id,
      title: episode.title,
      enclosureUrl: episode.enclosureUrl,
      durationSeconds: episode.durationSeconds,
      podcastTitle: podcast?.title ?? null,
      artworkUrl: podcast?.artworkUrl ?? null,
    })
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

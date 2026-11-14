import { useEffect, useState } from 'react'
import { LibraryScreen } from './LibraryScreen'
import { PodcastScreen } from './PodcastScreen'
import type { DataApi, Podcast } from './services'

export type LoadState<T> = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; items: T[] }

type Screen = { name: 'library' } | { name: 'podcast'; podcastId: string }

export function SignedInApp({ data, onSignOut }: { data: DataApi; onSignOut: () => Promise<void> }) {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const [podcasts, setPodcasts] = useState<LoadState<Podcast>>({ status: 'loading' })

  useEffect(
    () =>
      data.observePodcasts({
        next: (items) => setPodcasts({ status: 'loaded', items }),
        error: () => setPodcasts({ status: 'failed' }),
      }),
    [data],
  )

  if (screen.name === 'podcast') {
    const podcast = podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === screen.podcastId) : undefined
    return (
      <PodcastScreen
        data={data}
        podcastId={screen.podcastId}
        podcast={podcast}
        onBack={() => setScreen({ name: 'library' })}
      />
    )
  }

  return (
    <LibraryScreen
      podcasts={podcasts}
      subscribeToFeed={(feedUrl) => data.subscribeToFeed(feedUrl)}
      onOpenPodcast={(podcastId) => setScreen({ name: 'podcast', podcastId })}
      onSignOut={onSignOut}
    />
  )
}

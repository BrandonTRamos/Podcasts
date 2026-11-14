import { type FormEvent, useEffect, useState } from 'react'
import type { DataApi, Podcast } from './services'
import type { LoadState } from './SignedInApp'
import { failureMessage, type SubscribeFailure, useSubscribe } from './subscribing'

export function LibraryScreen({
  podcasts,
  data,
  onOpenPodcast,
  onOpenQueue,
  onOpenLatest,
  onOpenSearch,
  onSignOut,
}: {
  podcasts: LoadState<Podcast>
  data: DataApi
  onOpenPodcast: (podcastId: string) => void
  onOpenQueue: () => void
  onOpenLatest: () => void
  onOpenSearch: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <main className="library">
      <header>
        <h1>Library</h1>
        <button type="button" onClick={onOpenSearch}>
          Search
        </button>
        <button type="button" onClick={onOpenLatest}>
          Latest
        </button>
        <button type="button" onClick={onOpenQueue}>
          Queue
        </button>
        <button type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </header>
      <AddPodcastForm
        data={data}
        titleOf={(podcastId) =>
          podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === podcastId)?.title : undefined
        }
        onSubscribed={onOpenPodcast}
      />
      {podcasts.status === 'loading' && <p>Loading…</p>}
      {podcasts.status === 'failed' && <p role="alert">Couldn’t load your library.</p>}
      {podcasts.status === 'loaded' &&
        (podcasts.items.length === 0 ? (
          <p>No podcasts yet.</p>
        ) : (
          <ul className="podcasts" aria-label="Podcasts">
            {[...podcasts.items]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((podcast) => (
                <li key={podcast.id}>
                  <button type="button" onClick={() => onOpenPodcast(podcast.id)}>
                    <Artwork url={podcast.artworkUrl} />
                    <span className="podcast-title">{podcast.title}</span>
                    {podcast.author && <span className="podcast-author">{podcast.author}</span>}
                  </button>
                </li>
              ))}
          </ul>
        ))}
    </main>
  )
}

export function Artwork({ url, size = 'small' }: { url: string | null; size?: 'small' | 'large' | 'hero' }) {
  const className = `artwork artwork-${size}`
  return url ? <img className={className} src={url} alt="" /> : <span className={className} aria-hidden="true" />
}

const errorMessages: Record<SubscribeFailure, string> = {
  invalidUrl: 'Enter a feed URL that starts with http:// or https://.',
  unreachable: 'Couldn’t reach that feed. Check the URL and try again.',
  notAFeed: 'That URL isn’t a podcast feed.',
  failed: 'Couldn’t subscribe. Try again.',
  offline: 'Couldn’t subscribe. Check your connection and try again.',
  lost: 'Couldn’t check on the subscription. Reload to see if it was added.',
}

function AddPodcastForm({
  data,
  titleOf,
  onSubscribed,
}: {
  data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>
  titleOf: (podcastId: string) => string | undefined
  onSubscribed: (podcastId: string) => void
}) {
  const [feedUrl, setFeedUrl] = useState('')
  const { state, busy, subscribe } = useSubscribe(data)
  const error = failureMessage(state, errorMessages)

  useEffect(() => {
    if (state?.status === 'subscribed') onSubscribed(state.podcastId)
  }, [state, onSubscribed])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void subscribe(feedUrl)
  }

  return (
    <form className="add-podcast" onSubmit={handleSubmit} noValidate>
      <label>
        Feed URL
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        Subscribe
      </button>
      {state?.status === 'pending' && <p role="status">Checking the feed…</p>}
      {state?.status === 'alreadySubscribed' && (
        <p role="status">
          {titleOf(state.podcastId)
            ? `You’re already subscribed to ${titleOf(state.podcastId)}.`
            : 'You’re already subscribed to that podcast.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

import { type FormEvent, useEffect, useState } from 'react'
import type { DataApi, Podcast, SubscribeRequestState } from './services'
import type { LoadState } from './SignedInApp'

export function LibraryScreen({
  podcasts,
  data,
  onOpenPodcast,
  onOpenQueue,
  onSignOut,
}: {
  podcasts: LoadState<Podcast>
  data: DataApi
  onOpenPodcast: (podcastId: string) => void
  onOpenQueue: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <main className="library">
      <header>
        <h1>Library</h1>
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

/** Where a subscribe stands, as the form shows it. */
type SubscribeState = SubscribeRequestState | { status: 'offline' } | { status: 'lost' }

const errorMessages = {
  invalidUrl: 'Enter a feed URL that starts with http:// or https://.',
  unreachable: 'Couldn’t reach that feed. Check the URL and try again.',
  notAFeed: 'That URL isn’t a podcast feed.',
  failed: 'Couldn’t subscribe. Try again.',
  offline: 'Couldn’t subscribe. Check your connection and try again.',
  lost: 'Couldn’t check on the subscription. Reload to see if it was added.',
} as const

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
  const [sending, setSending] = useState(false)
  /** The subscribe request whose background check is under way. */
  const [requestId, setRequestId] = useState<string | null>(null)
  const [state, setState] = useState<SubscribeState | null>(null)

  useEffect(() => {
    if (!requestId) return
    return data.observeSubscribeRequest(requestId, {
      next(next) {
        setState(next)
        if (next.status !== 'pending') setRequestId(null)
      },
      error() {
        setState({ status: 'lost' })
        setRequestId(null)
      },
    })
  }, [data, requestId])

  useEffect(() => {
    if (state?.status === 'subscribed') onSubscribed(state.podcastId)
  }, [state, onSubscribed])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setState(null)
    const url = feedUrl.trim()
    if (!isHttpUrl(url)) {
      setState({ status: 'invalidUrl' })
      return
    }

    setSending(true)
    try {
      const result = await data.subscribeToFeed(url)
      if (result.outcome === 'pending') {
        setState({ status: 'pending' })
        setRequestId(result.requestId)
      } else {
        setState(result.outcome === 'alreadySubscribed' ? { status: 'alreadySubscribed', podcastId: result.podcastId } : { status: 'invalidUrl' })
      }
    } catch {
      setState({ status: 'offline' })
    } finally {
      setSending(false)
    }
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
      <button type="submit" disabled={sending || state?.status === 'pending'}>
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
      {state && state.status in errorMessages && (
        <p role="alert">{errorMessages[state.status as keyof typeof errorMessages]}</p>
      )}
    </form>
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

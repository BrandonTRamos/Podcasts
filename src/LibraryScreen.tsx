import { type FormEvent, useState } from 'react'
import type { Podcast, SubscribeResult } from './services'
import type { LoadState } from './SignedInApp'

export function LibraryScreen({
  podcasts,
  subscribeToFeed,
  onOpenPodcast,
  onSignOut,
}: {
  podcasts: LoadState<Podcast>
  subscribeToFeed: (feedUrl: string) => Promise<SubscribeResult>
  onOpenPodcast: (podcastId: string) => void
  onSignOut: () => Promise<void>
}) {
  return (
    <main className="library">
      <header>
        <h1>Library</h1>
        <button type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </header>
      <AddPodcastForm
        subscribeToFeed={subscribeToFeed}
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

export function Artwork({ url, size = 'small' }: { url: string | null; size?: 'small' | 'large' }) {
  const className = `artwork artwork-${size}`
  return url ? <img className={className} src={url} alt="" /> : <span className={className} aria-hidden="true" />
}

type Feedback = { kind: 'error' | 'info'; message: string }

const failureMessages = {
  invalidUrl: 'Enter a feed URL that starts with http:// or https://.',
  unreachable: 'Couldn’t reach that feed. Check the URL and try again.',
  notAFeed: 'That URL isn’t a podcast feed.',
} as const

function AddPodcastForm({
  subscribeToFeed,
  titleOf,
  onSubscribed,
}: {
  subscribeToFeed: (feedUrl: string) => Promise<SubscribeResult>
  titleOf: (podcastId: string) => string | undefined
  onSubscribed: (podcastId: string) => void
}) {
  const [feedUrl, setFeedUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFeedback(null)
    const url = feedUrl.trim()
    if (!isHttpUrl(url)) {
      setFeedback({ kind: 'error', message: failureMessages.invalidUrl })
      return
    }

    setBusy(true)
    let result: SubscribeResult
    try {
      result = await subscribeToFeed(url)
    } catch {
      setFeedback({ kind: 'error', message: 'Couldn’t subscribe. Check your connection and try again.' })
      return
    } finally {
      setBusy(false)
    }

    if (result.outcome === 'subscribed') {
      setFeedUrl('')
      onSubscribed(result.podcastId)
    } else if (result.outcome === 'alreadySubscribed') {
      const title = titleOf(result.podcastId)
      setFeedback({
        kind: 'info',
        message: title ? `You’re already subscribed to ${title}.` : 'You’re already subscribed to that podcast.',
      })
    } else {
      setFeedback({ kind: 'error', message: failureMessages[result.outcome] })
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
      <button type="submit" disabled={busy}>
        {busy ? 'Subscribing…' : 'Subscribe'}
      </button>
      {feedback?.kind === 'error' && <p role="alert">{feedback.message}</p>}
      {feedback?.kind === 'info' && <p role="status">{feedback.message}</p>}
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

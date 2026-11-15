import { type FormEvent, useState } from 'react'
import { Artwork } from './LibraryScreen'
import type { DataApi, DirectoryPodcast, Podcast, PodcastSearch } from './services'
import type { LoadState } from './SignedInApp'
import { failureMessage, type SubscribeFailure, useSubscribe } from './subscribing'

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  /** `number` counts searches, so each one's results start afresh. */
  | { status: 'done'; term: string; search: PodcastSearch; number: number }
  /** The search call itself failed. */
  | { status: 'offline' }

/** Searches the public directory by name, and subscribes to a result in one tap. */
export function SearchScreen({
  data,
  podcasts,
  onOpenPodcast,
}: {
  data: DataApi
  podcasts: LoadState<Podcast>
  onOpenPodcast: (podcastId: string) => void
}) {
  const [term, setTerm] = useState('')
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const [searches, setSearches] = useState(0)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const wanted = term.trim()
    if (!wanted) return
    setState({ status: 'searching' })
    const number = searches + 1
    setSearches(number)
    try {
      setState({ status: 'done', term: wanted, search: await data.searchPodcasts(wanted), number })
    } catch {
      setState({ status: 'offline' })
    }
  }

  /** Whether the podcast is in the library: when the library has loaded, it is the judge. */
  const inLibrary = (podcastId: string) =>
    podcasts.status !== 'loaded' || podcasts.items.some((podcast) => podcast.id === podcastId)

  const found = state.status === 'done' && state.search.outcome === 'found' ? state.search.podcasts : null

  return (
    <main className="search">
      <h1>Search</h1>
      <form className="search-form" role="search" onSubmit={handleSubmit}>
        <label>
          Podcast name
          <input type="search" autoComplete="off" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={state.status === 'searching'}>
          Search
        </button>
      </form>
      {state.status === 'searching' && <p role="status">Searching…</p>}
      {state.status === 'offline' && <p role="alert">Couldn’t search. Check your connection and try again.</p>}
      {state.status === 'done' && state.search.outcome === 'directoryUnavailable' && (
        <p role="alert">Couldn’t reach the podcast directory. Try again later.</p>
      )}
      {found?.length === 0 && state.status === 'done' && <p role="status">No podcasts found for “{state.term}”.</p>}
      {found && found.length > 0 && state.status === 'done' && (
        <ul className="search-results" aria-label="Search results">
          {found.map((result) => (
            <SearchResult
              key={`${state.number} ${result.feedUrl}`}
              data={data}
              result={result}
              inLibrary={inLibrary}
              onOpenPodcast={onOpenPodcast}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

const errorMessages: Record<SubscribeFailure, string> = {
  invalidUrl: 'The directory gave this show a feed that doesn’t work.',
  unreachable: 'Couldn’t reach that feed. Try again later.',
  notAFeed: 'The directory gave this show a feed that doesn’t work.',
  failed: 'Couldn’t subscribe. Try again.',
  offline: 'Couldn’t subscribe. Check your connection and try again.',
  lost: 'Couldn’t check on the subscription. Reload to see if it was added.',
}

function SearchResult({
  data,
  result,
  inLibrary,
  onOpenPodcast,
}: {
  data: DataApi
  result: DirectoryPodcast
  inLibrary: (podcastId: string) => boolean
  onOpenPodcast: (podcastId: string) => void
}) {
  const { state, busy, subscribe } = useSubscribe(data)
  const subscribedNow = state?.status === 'subscribed' || state?.status === 'alreadySubscribed' ? state.podcastId : null
  const podcastId = subscribedNow ?? (result.podcastId && inLibrary(result.podcastId) ? result.podcastId : null)
  const error = failureMessage(state, errorMessages)

  return (
    <li>
      <Artwork url={result.artworkUrl} />
      <h2>{result.title}</h2>
      {result.author && <p className="podcast-author">{result.author}</p>}
      <div className="search-result-action">
        {podcastId ? (
          <>
            <span>Subscribed</span>
            <button type="button" onClick={() => onOpenPodcast(podcastId)}>
              Open
            </button>
          </>
        ) : busy ? (
          <span role="status">Subscribing…</span>
        ) : (
          <button type="button" className="primary" onClick={() => void subscribe(result.feedUrl)}>
            Subscribe
          </button>
        )}
      </div>
      {error && !podcastId && <p role="alert">{error}</p>}
    </li>
  )
}

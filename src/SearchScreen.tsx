import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Artwork } from './LibraryScreen'
import { DIRECTORY_GENRES, type DataApi, type DirectoryGenre, type DirectoryPodcast, type Podcast, type PodcastSearch } from './services'
import type { LoadState } from './SignedInApp'
import { failureMessage, type SubscribeFailure, useSubscribe } from './subscribing'

const genreNames: Record<DirectoryGenre, string> = {
  arts: 'Arts',
  business: 'Business',
  comedy: 'Comedy',
  education: 'Education',
  fiction: 'Fiction',
  government: 'Government',
  healthFitness: 'Health & Fitness',
  history: 'History',
  kidsFamily: 'Kids & Family',
  leisure: 'Leisure',
  music: 'Music',
  news: 'News',
  religionSpirituality: 'Religion & Spirituality',
  science: 'Science',
  societyCulture: 'Society & Culture',
  sports: 'Sports',
  technology: 'Technology',
  trueCrime: 'True Crime',
  tvFilm: 'TV & Film',
}

/** What the screen lists: one of the directory's charts (null: the chart of all podcasts), or what a search found. */
type Listing = { kind: 'chart'; genre: DirectoryGenre | null } | { kind: 'search'; term: string }

interface Shown {
  listing: Listing
  /** Counts the listings asked for, so each one's results start afresh. */
  number: number
  load:
    | { status: 'loading' }
    | { status: 'done'; result: PodcastSearch }
    /** The call itself failed. */
    | { status: 'offline' }
}

/** What each kind of listing says while it loads, when it fails, and over its results. */
function wording(listing: Listing) {
  if (listing.kind === 'search') {
    return {
      loading: 'Searching…',
      offline: 'Couldn’t search. Check your connection and try again.',
      empty: `No podcasts found for “${listing.term}”.`,
      results: 'Search results',
    }
  }
  return {
    loading: 'Loading top shows…',
    offline: 'Couldn’t load the top shows. Check your connection and try again.',
    empty: 'No top shows to list right now.',
    results: listing.genre ? `Top shows in ${genreNames[listing.genre]}` : 'Top shows',
  }
}

/**
 * Finds podcasts in the public directory, to subscribe to in one tap: by
 * browsing its top shows, over all or in one genre, or by searching by name.
 */
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
  /** The chart last browsed, shown again when a search is cleared. */
  const [genre, setGenre] = useState<DirectoryGenre | null>(null)
  const [shown, setShown] = useState<Shown>({ listing: { kind: 'chart', genre: null }, number: 0, load: { status: 'loading' } })
  /** The number of the listing last asked for. */
  const latest = useRef(0)
  // Read when a listing is asked for, so a fresh copy of the data API doesn't ask again for what is showing.
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const show = useCallback(async (listing: Listing) => {
    const number = ++latest.current
    setShown({ listing, number, load: { status: 'loading' } })
    let load: Shown['load']
    try {
      const result =
        listing.kind === 'chart'
          ? await dataRef.current.topPodcasts(listing.genre)
          : await dataRef.current.searchPodcasts(listing.term)
      load = { status: 'done', result }
    } catch {
      load = { status: 'offline' }
    }
    // Only the listing last asked for is shown: an earlier one answering late is dropped.
    if (latest.current === number) setShown({ listing, number, load })
  }, [])

  // The screen opens on the top shows over all.
  useEffect(() => {
    void show({ kind: 'chart', genre: null })
  }, [show])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const wanted = term.trim()
    if (wanted) void show({ kind: 'search', term: wanted })
  }

  function handleTerm(next: string) {
    setTerm(next)
    // Clearing the search goes back to browsing.
    if (!next.trim() && shown.listing.kind === 'search') void show({ kind: 'chart', genre })
  }

  /** Browses a chart. Choosing the one showing loads it again. */
  function browse(next: DirectoryGenre | null) {
    setGenre(next)
    setTerm('')
    void show({ kind: 'chart', genre: next })
  }

  /** Whether the podcast is in the library: when the library has loaded, it is the judge. */
  const inLibrary = (podcastId: string) =>
    podcasts.status !== 'loaded' || podcasts.items.some((podcast) => podcast.id === podcastId)

  const { listing, load } = shown
  const words = wording(listing)
  const found = load.status === 'done' && load.result.outcome === 'found' ? load.result.podcasts : null
  const browsing = (chart: DirectoryGenre | null) => listing.kind === 'chart' && listing.genre === chart

  return (
    <main className="search">
      <h1>Search</h1>
      <form className="search-form" role="search" onSubmit={handleSubmit}>
        <label>
          Podcast name
          <input type="search" autoComplete="off" value={term} onChange={(e) => handleTerm(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={listing.kind === 'search' && load.status === 'loading'}>
          Search
        </button>
      </form>
      <div className="genres" role="group" aria-label="Top shows by genre">
        <button type="button" aria-pressed={browsing(null)} onClick={() => browse(null)}>
          Top shows
        </button>
        {DIRECTORY_GENRES.map((each) => (
          <button key={each} type="button" aria-pressed={browsing(each)} onClick={() => browse(each)}>
            {genreNames[each]}
          </button>
        ))}
      </div>
      {load.status === 'loading' && <p role="status">{words.loading}</p>}
      {load.status === 'offline' && <p role="alert">{words.offline}</p>}
      {load.status === 'done' && load.result.outcome === 'directoryUnavailable' && (
        <p role="alert">Couldn’t reach the podcast directory. Try again later.</p>
      )}
      {found?.length === 0 && <p role="status">{words.empty}</p>}
      {found && found.length > 0 && (
        <ul className="search-results" aria-label={words.results}>
          {found.map((result) => (
            <SearchResult
              key={`${shown.number} ${result.feedUrl}`}
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

import { type FormEvent, useEffect, useId, useMemo, useState } from 'react'
import { wordMatcher } from '../amplify/feeds/matchWords'
import { CategoryPicker } from './CategoryPicker'
import { type EpisodeActions, EpisodeRow } from './EpisodeRow'
import { isStored } from './downloads'
import { newEpisodeIds, newestFirst, recentlyAdded } from './episodes'
import { formatDateTime } from './format'
import { ChevronLeftIcon, StarIcon } from './Icons'
import { Artwork } from './LibraryScreen'
import { type ListeningStore, useEpisodeStates } from './listening'
import { useFeedSearch } from './feedSearch'
import { OlderEpisodes } from './OlderEpisodes'
import type { Category, DataApi, Episode, EpisodeState, FeedError, Podcast } from './services'
import type { LoadState } from './SignedInApp'

/** What a podcast's screen lists: all its episodes, or those recently added (see `recentlyAdded`). */
export type PodcastView = 'episodes' | 'recentlyAdded'

const views: { view: PodcastView; label: string }[] = [
  { view: 'episodes', label: 'Episodes' },
  { view: 'recentlyAdded', label: 'Recently Added' },
]

export function PodcastScreen({
  data,
  podcastId,
  podcast,
  categories,
  listening,
  view,
  onSelectView,
  searchTerm,
  onSearchTermChange,
  onBack,
  onUnsubscribe,
  ...actions
}: {
  data: DataApi
  podcastId: string
  /** Undefined until the library has loaded it. */
  podcast: Podcast | undefined
  /** The listener's categories; undefined until loaded. */
  categories: Category[] | undefined
  listening: ListeningStore
  /** Kept by the app, as the search is, so it outlasts a visit to an episode. */
  view: PodcastView
  onSelectView: (view: PodcastView) => void
  /** What the listener is searching its episodes for; empty for nothing. Kept by the app, so it outlasts a visit to an episode. */
  searchTerm: string
  onSearchTermChange: (term: string) => void
  onBack: () => void
  /** Removes the podcast from the library. Rejects if that failed. */
  onUnsubscribe: () => Promise<void>
} & EpisodeActions) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })
  const [unplayedOnly, setUnplayedOnly] = useState(false)
  // Episodes added from the feed while this screen is open, listed at once rather than when the library next says so.
  const [kept, setKept] = useState<Episode[]>([])
  const statesStatus = useEpisodeStates(listening, podcastId)

  /** Puts the episode in Recently Added, as of now, or takes it out. Synced, as the listener's place in it is. */
  function setAdded(episode: Episode, added: boolean) {
    listening.update(episode.id, episode.podcastId, { addedAt: added ? new Date().toISOString() : null })
  }

  useEffect(
    () =>
      data.observeEpisodes(podcastId, {
        next: (items) => setEpisodes({ status: 'loaded', items }),
        error: () => setEpisodes({ status: 'failed' }),
      }),
    [data, podcastId],
  )

  return (
    <main className="podcast">
      <nav>
        <button type="button" className="back" onClick={onBack} aria-label="Back to library">
          <ChevronLeftIcon size={18} />
          <span>Library</span>
        </button>
      </nav>
      {podcast ? (
        <div className="tray">
          <header>
            <Artwork url={podcast.artworkUrl} size="large" />
            <div className="podcast-heading">
              <h1>{podcast.title}</h1>
              {podcast.author && <p className="podcast-author">{podcast.author}</p>}
            </div>
            <FavoriteToggle podcast={podcast} data={data} />
          </header>
          <div className="podcast-actions">
            {categories && <CategoryPicker podcast={podcast} categories={categories} data={data} />}
            <Unsubscribe podcastTitle={podcast.title} onUnsubscribe={onUnsubscribe} />
          </div>
          <FeedHealth podcast={podcast} refresh={(id) => data.refreshPodcast(id)} />
        </div>
      ) : (
        <p>Loading…</p>
      )}
      {/* Wait for the listening state too, so an episode tapped at once still resumes. */}
      {(episodes.status === 'loading' || statesStatus === 'loading') && podcast && <p>Loading episodes…</p>}
      {episodes.status === 'failed' && <p role="alert">Couldn’t load the episodes.</p>}
      {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
      {episodes.status === 'loaded' &&
        statesStatus !== 'loading' &&
        (episodes.items.length === 0 ? (
          podcast && <p>No episodes yet.</p>
        ) : (
          <EpisodeList
            data={data}
            podcastId={podcastId}
            episodes={episodes.items}
            kept={kept}
            onKept={(episode) => {
              setKept((already) => [...already, episode])
              setAdded(episode, true)
            }}
            onSetAdded={setAdded}
            stateOf={(episodeId) => listening.get(episodeId)}
            view={view}
            onSelectView={onSelectView}
            unplayedOnly={unplayedOnly}
            onUnplayedOnlyChange={setUnplayedOnly}
            searchTerm={searchTerm}
            onSearchTermChange={onSearchTermChange}
            {...actions}
          />
        ))}
    </main>
  )
}

/**
 * A podcast's episodes, under two tabs. Episodes has them all, newest first,
 * with a search of them: typing filters the list at once to the titles with
 * every word (`matchWords.ts`), and submitting the search looks through the
 * podcast's whole feed as well, for episodes older than the library keeps
 * (see `OlderEpisodes`). Recently Added has those the listener added or
 * downloaded, and the new one. Each episode has an Add button, which puts
 * it there.
 */
function EpisodeList({
  data,
  podcastId,
  episodes,
  kept,
  onKept,
  onSetAdded,
  stateOf,
  view,
  onSelectView,
  unplayedOnly,
  onUnplayedOnlyChange,
  searchTerm,
  onSearchTermChange,
  ...actions
}: {
  data: Pick<DataApi, 'searchEpisodes' | 'keepEpisode'>
  podcastId: string
  /** The podcast's episodes as the library has them. */
  episodes: Episode[]
  /** Episodes added from the feed since the screen opened, which the library may not have delivered yet. */
  kept: Episode[]
  onKept: (episode: Episode) => void
  /** Adds an episode to Recently Added, or takes it out. */
  onSetAdded: (episode: Episode, added: boolean) => void
  stateOf: (episodeId: string) => EpisodeState | undefined
  view: PodcastView
  onSelectView: (view: PodcastView) => void
  unplayedOnly: boolean
  onUnplayedOnlyChange: (unplayedOnly: boolean) => void
  searchTerm: string
  onSearchTermChange: (term: string) => void
} & EpisodeActions) {
  const formId = useId()
  const term = searchTerm.trim()
  const matches = useMemo(() => wordMatcher(term), [term])
  const feed = useFeedSearch(data, podcastId)
  // A search of the feed belongs to the words it was for: change them, and it no longer shows.
  const load = feed.shown?.term === term ? feed.shown.load : null
  const found = load?.status === 'done' && load.search.outcome === 'found' ? load.search.episodes : null

  const inLibrary = new Map([...kept, ...episodes].filter((episode) => episode.podcastId === podcastId).map((episode) => [episode.id, episode]))
  // An episode added from the feed's matches stays among them while they show, rather than jump up the page.
  const keptIds = new Set(kept.map((episode) => episode.id))
  const addedBelow = new Set(found?.filter((episode) => keptIds.has(episode.id)).map((episode) => episode.id))
  const titled = [...inLibrary.values()].filter(
    (episode) => (!matches || matches(episode.title)) && !addedBelow.has(episode.id),
  )
  const titledIds = new Set(titled.map((episode) => episode.id))
  const wanted = (episode: Episode) => !unplayedOnly || !stateOf(episode.id)?.played
  const shown = newestFirst(titled).filter(wanted)
  const more = found?.filter((episode) => !titledIds.has(episode.id) && wanted(episode)) ?? null
  const fresh = newEpisodeIds([...inLibrary.values()], stateOf)
  const recent = recentlyAdded([...inLibrary.values()], stateOf, (episodeId) => isStored(actions.downloadOf(episodeId))).filter(wanted)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (matches && load?.status !== 'loading') void feed.search(term)
  }

  return (
    <div className="tray">
      <div className="episodes-heading">
        <div className="segmented" role="tablist" aria-label="Episodes shown">
          {views.map(({ view: each, label }) => (
            <button key={each} type="button" role="tab" aria-selected={each === view} onClick={() => onSelectView(each)}>
              {label}
            </button>
          ))}
        </div>
        <div className="episode-tools">
          {view === 'episodes' && (
            <form id={formId} className="episode-search" role="search" onSubmit={handleSubmit}>
              <input
                type="search"
                aria-label="Search episodes"
                placeholder="Search"
                autoComplete="off"
                enterKeyHint="search"
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
              />
            </form>
          )}
          <label className="episode-filter">
            Unplayed
            <input
              type="checkbox"
              aria-label="Unplayed only"
              className="switch"
              checked={unplayedOnly}
              onChange={(e) => onUnplayedOnlyChange(e.target.checked)}
            />
          </label>
        </div>
      </div>
      {view === 'recentlyAdded' ? (
        recent.length === 0 ? (
          <p className="recently-added-empty">
            {unplayedOnly
              ? 'No unplayed episodes recently added.'
              : 'Nothing recently added. Episodes you add or download show here, as do new ones.'}
          </p>
        ) : (
          <ol className="episodes" aria-label="Recently added">
            {recent.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episode={episode}
                state={stateOf(episode.id)}
                isNew={fresh.has(episode.id)}
                onSetAdded={onSetAdded}
                {...actions}
              />
            ))}
          </ol>
        )
      ) : (
        <>
          {shown.length === 0 ? (
            <p>
              {!matches
                ? 'No unplayed episodes.'
                : unplayedOnly
                  ? `No unplayed episode titles match “${term}”.`
                  : `No episode titles match “${term}”.`}
            </p>
          ) : (
            <ol className="episodes" aria-label="Episodes">
              {shown.map((episode) => (
                <EpisodeRow
                key={episode.id}
                episode={episode}
                state={stateOf(episode.id)}
                isNew={fresh.has(episode.id)}
                onSetAdded={onSetAdded}
                {...actions}
              />
              ))}
            </ol>
          )}
          {matches && (
            <OlderEpisodes
              data={data}
              term={term}
              formId={formId}
              load={load}
              more={more}
              inLibrary={(episodeId) => inLibrary.get(episodeId)}
              stateOf={stateOf}
              isNew={(episodeId) => fresh.has(episodeId)}
              onKept={onKept}
              onSetAdded={onSetAdded}
              {...actions}
            />
          )}
        </>
      )}
    </div>
  )
}

/**
 * A star that makes the podcast a favorite, shown in Favorites at the
 * library's top as well as in its category, or no longer one. It shows the
 * choice while it is saved. A new favorite goes last: its place is the time
 * it was starred.
 */
function FavoriteToggle({ podcast, data }: { podcast: Podcast; data: Pick<DataApi, 'placeFavorite'> }) {
  const favorite = podcast.favoriteOrder !== null
  // The choice being saved, shown until the library brings the podcast changed from how it was when chosen.
  const [saving, setSaving] = useState<{ favorite: boolean; from: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  const shown = saving !== null && saving.from === favorite ? saving.favorite : favorite

  async function toggle() {
    setSaving({ favorite: !shown, from: favorite })
    setFailed(false)
    try {
      await data.placeFavorite(podcast.id, shown ? null : Date.now())
    } catch {
      setSaving(null)
      setFailed(true)
    }
  }

  return (
    <div className="favorite-toggle">
      <button
        type="button"
        className={shown ? 'icon-button starred' : 'icon-button'}
        aria-pressed={shown}
        aria-label="Favorite"
        onClick={() => void toggle()}
      >
        <StarIcon size={24} filled={shown} />
      </button>
      {failed && <p role="alert">Couldn’t change your favorites. Check your connection and try again.</p>}
    </div>
  )
}

/** How long to show a requested refresh as under way when nothing comes of it, as for a feed found unchanged. */
const REFRESH_CHECK_MS = 30_000

const feedErrorMessages: Record<FeedError, string> = {
  unreachable: 'The last refresh failed: couldn’t reach the feed.',
  notAFeed: 'The last refresh failed: the URL no longer gives a podcast feed.',
  invalidUrl: 'The last refresh failed: the feed URL isn’t valid.',
  failed: 'The last refresh failed. It will be tried again within the hour.',
}

/**
 * When the feed last refreshed and whether the latest attempt failed, kept
 * current as refreshes record results, and a button to refresh it now.
 */
function FeedHealth({ podcast, refresh }: { podcast: Podcast; refresh: (podcastId: string) => Promise<void> }) {
  const { id, lastFetchedAt, lastFetchError } = podcast
  const [request, setRequest] = useState<
    | { status: 'idle' | 'sending' | 'failed' }
    /** Asked, and waiting for a result other than the one recorded when asked. */
    | { status: 'checking'; lastFetchedAt: string | null; lastFetchError: FeedError | null }
  >({ status: 'idle' })
  const checking =
    request.status === 'checking' &&
    request.lastFetchedAt === lastFetchedAt &&
    request.lastFetchError === lastFetchError

  // A feed found unchanged records nothing, so stop waiting after a while.
  useEffect(() => {
    if (!checking) return
    const timer = setTimeout(() => setRequest({ status: 'idle' }), REFRESH_CHECK_MS)
    return () => clearTimeout(timer)
  }, [checking])

  async function handleRefresh() {
    setRequest({ status: 'sending' })
    try {
      await refresh(id)
      setRequest({ status: 'checking', lastFetchedAt, lastFetchError })
    } catch {
      setRequest({ status: 'failed' })
    }
  }

  return (
    <section className="feed-health" aria-label="Feed">
      <p>
        {lastFetchedAt ? (
          <>
            Last refreshed <time dateTime={lastFetchedAt}>{formatDateTime(lastFetchedAt)}</time>
          </>
        ) : (
          'Not refreshed yet'
        )}
        <span className="feed-schedule"> · checked hourly</span>
      </p>
      <button
        type="button"
        onClick={() => void handleRefresh()}
        disabled={request.status === 'sending' || checking}
      >
        Refresh
      </button>
      {lastFetchError && <p role="alert">{feedErrorMessages[lastFetchError]}</p>}
      {checking && <p role="status">Checking for new episodes…</p>}
      {request.status === 'failed' && <p role="alert">Couldn’t refresh. Check your connection and try again.</p>}
    </section>
  )
}

/** A button to unsubscribe, which asks first, as unsubscribing also forgets the listener's place in every episode. */
function Unsubscribe({ podcastTitle, onUnsubscribe }: { podcastTitle: string; onUnsubscribe: () => Promise<void> }) {
  const [step, setStep] = useState<'idle' | 'confirming' | 'sending' | 'failed'>('idle')

  async function handleConfirm() {
    setStep('sending')
    try {
      // Once done, this screen is gone: the app returns to the library.
      await onUnsubscribe()
    } catch {
      setStep('failed')
    }
  }

  if (step === 'confirming' || step === 'sending') {
    return (
      <section className="unsubscribe" role="alertdialog" aria-labelledby="unsubscribe-title" aria-describedby="unsubscribe-detail">
        <h2 id="unsubscribe-title">Unsubscribe from {podcastTitle}?</h2>
        <p id="unsubscribe-detail">Its episodes and your place in them will be removed from your library and queue.</p>
        <button type="button" className="primary" onClick={() => void handleConfirm()} disabled={step === 'sending'}>
          Unsubscribe
        </button>
        <button type="button" onClick={() => setStep('idle')} disabled={step === 'sending'}>
          Cancel
        </button>
        {step === 'sending' && <p role="status">Unsubscribing…</p>}
      </section>
    )
  }

  return (
    <section className="unsubscribe">
      <button type="button" className="outline" onClick={() => setStep('confirming')}>
        Unsubscribe
      </button>
      {step === 'failed' && <p role="alert">Couldn’t unsubscribe. Check your connection and try again.</p>}
    </section>
  )
}

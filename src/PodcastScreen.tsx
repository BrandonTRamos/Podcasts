import { useEffect, useState } from 'react'
import { CategoryPicker } from './CategoryPicker'
import { type EpisodeActions, EpisodeRow } from './EpisodeRow'
import { newestFirst } from './episodes'
import { formatDateTime } from './format'
import { ChevronLeftIcon, StarIcon } from './Icons'
import { Artwork } from './LibraryScreen'
import { type ListeningStore, useEpisodeStates } from './listening'
import type { Category, DataApi, Episode, EpisodeState, FeedError, Podcast } from './services'
import type { LoadState } from './SignedInApp'

export function PodcastScreen({
  data,
  podcastId,
  podcast,
  categories,
  listening,
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
  onBack: () => void
  /** Removes the podcast from the library. Rejects if that failed. */
  onUnsubscribe: () => Promise<void>
} & EpisodeActions) {
  const [episodes, setEpisodes] = useState<LoadState<Episode>>({ status: 'loading' })
  const [unplayedOnly, setUnplayedOnly] = useState(false)
  const statesStatus = useEpisodeStates(listening, podcastId)

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
          <ChevronLeftIcon size={22} />
          Library
        </button>
      </nav>
      {podcast ? (
        <header>
          <Artwork url={podcast.artworkUrl} size="large" />
          <div>
            <h1>{podcast.title}</h1>
            {podcast.author && <p className="podcast-author">{podcast.author}</p>}
            {categories && <CategoryPicker podcast={podcast} categories={categories} data={data} />}
            <Unsubscribe podcastTitle={podcast.title} onUnsubscribe={onUnsubscribe} />
          </div>
          <FavoriteToggle podcast={podcast} data={data} />
        </header>
      ) : (
        <p>Loading…</p>
      )}
      {podcast && <FeedHealth podcast={podcast} refresh={(id) => data.refreshPodcast(id)} />}
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
            episodes={episodes.items}
            stateOf={(episodeId) => listening.get(episodeId)}
            unplayedOnly={unplayedOnly}
            onUnplayedOnlyChange={setUnplayedOnly}
            {...actions}
          />
        ))}
    </main>
  )
}

function EpisodeList({
  episodes,
  stateOf,
  unplayedOnly,
  onUnplayedOnlyChange,
  ...actions
}: {
  episodes: Episode[]
  stateOf: (episodeId: string) => EpisodeState | undefined
  unplayedOnly: boolean
  onUnplayedOnlyChange: (unplayedOnly: boolean) => void
} & EpisodeActions) {
  const shown = newestFirst(episodes).filter((episode) => !unplayedOnly || !stateOf(episode.id)?.played)
  return (
    <>
      <div className="episodes-heading">
        <h2>Episodes</h2>
        <label className="episode-filter">
          Unplayed only
          <input
            type="checkbox"
            className="switch"
            checked={unplayedOnly}
            onChange={(e) => onUnplayedOnlyChange(e.target.checked)}
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <p>No unplayed episodes.</p>
      ) : (
        <ol className="episodes" aria-label="Episodes">
          {shown.map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} state={stateOf(episode.id)} {...actions} />
          ))}
        </ol>
      )}
    </>
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
        className="text-button"
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

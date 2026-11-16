import type { FeedStore } from '../feeds/feedStore'
import { withUrlsRedactedFromErrors } from '../feeds/feedUrl'
import { askDirectory, DIRECTORY_ORIGIN, type DirectoryListing, type DirectoryResult, listingOf, markInLibrary } from './directory'
import { APPLE_GENRE_IDS, type DirectoryGenre } from './genres'

export interface TopPodcastsEvent {
  /** No genre: the chart of all podcasts. */
  arguments: { genre?: DirectoryGenre | null }
}

export type TopPodcastsResult = DirectoryResult

/** Charts are per country: this is the one whose charts are listed. */
const CHART_COUNTRY = 'us'
const CHART_LENGTH = 50
/** A chart moves slowly, so one read is kept for a while: each read costs the directory two requests. */
const CHART_KEPT_MS = 60 * 60 * 1000

/**
 * The `topPodcasts` query. Returns the directory's most popular podcasts, in
 * one genre or over all, most popular first, leaving out those it gives no
 * feed for and marking the ones already in the library. A directory failure
 * is an outcome, not an error, so the client can say so plainly.
 *
 * Each chart read is kept for an hour, for as long as the function stays warm;
 * what is in the library is checked every time.
 */
export function createTopPodcastsHandler({ store, now = () => new Date() }: { store: FeedStore; now?: () => Date }) {
  const kept = new Map<string, { listed: DirectoryListing[]; readAt: number }>()

  return withUrlsRedactedFromErrors('topPodcasts', async (event: TopPodcastsEvent): Promise<TopPodcastsResult> => {
    const genre = event.arguments.genre ?? null
    // The data API accepts only the genres it lists; anything else has no chart.
    if (genre !== null && !Object.hasOwn(APPLE_GENRE_IDS, genre)) return { outcome: 'found', podcasts: [] }

    const key = genre ?? ''
    const fresh = kept.get(key)
    let listed = fresh && now().getTime() - fresh.readAt < CHART_KEPT_MS ? fresh.listed : null
    if (!listed) {
      listed = await readChart(genre)
      if (!listed) return { outcome: 'directoryUnavailable', podcasts: [] }
      // An empty chart is more likely a hiccup than the truth, so it is asked for again next time.
      if (listed.length > 0) kept.set(key, { listed, readAt: now().getTime() })
    }
    return { outcome: 'found', podcasts: await markInLibrary(store, listed) }
  })
}

/**
 * The chart's podcasts that have a usable feed, in its order, each feed once;
 * null if the directory gave no usable answer. The chart names its podcasts
 * without their feeds, so they are then looked up, all in one request.
 */
async function readChart(genre: DirectoryGenre | null): Promise<DirectoryListing[] | null> {
  const inGenre = genre === null ? '' : `/genre=${APPLE_GENRE_IDS[genre]}`
  const chart = await askDirectory(
    'topPodcasts',
    `${DIRECTORY_ORIGIN}/${CHART_COUNTRY}/rss/toppodcasts/limit=${CHART_LENGTH}${inGenre}/json`,
  )
  const ids = chartIds(chart)
  if (!ids) {
    if (chart !== null) console.warn('topPodcasts: directory answer was not a chart')
    return null
  }
  if (ids.length === 0) return []

  const query = new URLSearchParams({ id: ids.join(',') })
  const body = await askDirectory('topPodcasts', `${DIRECTORY_ORIGIN}/lookup?${query}`)
  if (body === null) return null
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) {
    console.warn('topPodcasts: directory answer had no results list')
    return null
  }

  const byId = new Map<string, DirectoryListing>()
  for (const entry of results) {
    const listing = listingOf(entry)
    const id = (entry as { collectionId?: unknown } | null)?.collectionId
    if (listing && (typeof id === 'number' || typeof id === 'string')) byId.set(String(id), listing)
  }
  const listings = new Map<string, DirectoryListing>()
  for (const id of ids) {
    const listing = byId.get(id)
    if (listing && !listings.has(listing.feedUrl)) listings.set(listing.feedUrl, listing)
  }
  return [...listings.values()]
}

/** The directory's IDs for the chart's podcasts, in its order, each once; null if the answer is not a chart. */
function chartIds(chart: unknown): string[] | null {
  const feed = (chart as { feed?: unknown } | null)?.feed
  if (typeof feed !== 'object' || feed === null) return null
  // A chart of one podcast has it alone rather than in a list; an empty chart has no entries at all.
  const entry = (feed as { entry?: unknown }).entry
  const entries = entry === undefined ? [] : Array.isArray(entry) ? entry : [entry]
  const ids = new Set<string>()
  for (const each of entries) {
    const id = (each as { id?: { attributes?: Record<string, unknown> } } | null)?.id?.attributes?.['im:id']
    if (typeof id === 'string' && /^\d+$/.test(id)) ids.add(id)
  }
  return [...ids]
}

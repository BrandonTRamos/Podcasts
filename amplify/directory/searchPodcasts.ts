import type { FeedStore } from '../feeds/feedStore'
import { withUrlsRedactedFromErrors } from '../feeds/feedUrl'
import { askDirectory, DIRECTORY_ORIGIN, type DirectoryListing, type DirectoryResult, listingOf, markInLibrary } from './directory'

export interface SearchPodcastsEvent {
  arguments: { term: string }
}

export type SearchPodcastsResult = DirectoryResult

const RESULT_LIMIT = 25

/**
 * The `searchPodcasts` query. Asks the public directory for podcasts matching
 * the term and returns those it gives a feed for, marking the ones already in
 * the library. A directory failure is an outcome, not an error, so the client
 * can say so plainly.
 */
export function createSearchPodcastsHandler({ store }: { store: FeedStore }) {
  return withUrlsRedactedFromErrors('searchPodcasts', async (event: SearchPodcastsEvent): Promise<SearchPodcastsResult> => {
    const term = event.arguments.term.trim()
    if (!term) return { outcome: 'found', podcasts: [] }

    const listed = await searchDirectory(term)
    if (!listed) return { outcome: 'directoryUnavailable', podcasts: [] }
    return { outcome: 'found', podcasts: await markInLibrary(store, listed) }
  })
}

/**
 * The directory's matches that have a usable feed, in its order, each feed
 * once; null if it gave no usable answer.
 */
async function searchDirectory(term: string): Promise<DirectoryListing[] | null> {
  const query = new URLSearchParams({ media: 'podcast', entity: 'podcast', limit: String(RESULT_LIMIT), term })
  const body = await askDirectory('searchPodcasts', `${DIRECTORY_ORIGIN}/search?${query}`)
  if (body === null) return null

  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) {
    console.warn('searchPodcasts: directory answer had no results list')
    return null
  }
  const listings = new Map<string, DirectoryListing>()
  for (const entry of results) {
    const listing = listingOf(entry)
    if (listing && !listings.has(listing.feedUrl)) listings.set(listing.feedUrl, listing)
  }
  return [...listings.values()]
}

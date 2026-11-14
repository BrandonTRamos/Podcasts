import type { FeedStore } from '../feeds/feedStore'
import { normaliseFeedUrl, withUrlsRedactedFromErrors } from '../feeds/feedUrl'

export interface SearchPodcastsEvent {
  arguments: { term: string }
}

/** A podcast as the directory lists it. */
export interface DirectoryPodcast {
  title: string
  author: string | null
  artworkUrl: string | null
  /** Public: the directory lists it. Normalised as the subscribe mutation stores it. */
  feedUrl: string
  /** The podcast's ID when it is already in the library; null when it is not. */
  podcastId: string | null
}

export interface SearchPodcastsResult {
  /** `directoryUnavailable`: the directory could not be reached or gave no usable answer; `podcasts` is empty. */
  outcome: 'found' | 'directoryUnavailable'
  podcasts: DirectoryPodcast[]
}

/** The public directory: the iTunes Search API, which needs no key. */
const DIRECTORY_URL = 'https://itunes.apple.com/search'
const RESULT_LIMIT = 25
const TIMEOUT_MS = 8_000

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
    if (listed.length === 0) return { outcome: 'found', podcasts: [] }

    const library = new Map((await store.listPodcasts()).map((podcast) => [podcast.feedUrl, podcast.id]))
    return {
      outcome: 'found',
      podcasts: listed.map((podcast) => ({ ...podcast, podcastId: library.get(podcast.feedUrl) ?? null })),
    }
  })
}

/** The directory's matches that have a usable feed, in its order; null if it gave no usable answer. */
async function searchDirectory(term: string): Promise<Omit<DirectoryPodcast, 'podcastId'>[] | null> {
  const query = new URLSearchParams({ media: 'podcast', entity: 'podcast', limit: String(RESULT_LIMIT), term })
  let body: unknown
  try {
    const response = await fetch(`${DIRECTORY_URL}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      console.warn(`searchPodcasts: directory answered ${response.status}`)
      return null
    }
    body = await response.json()
  } catch (error) {
    console.warn(`searchPodcasts: directory unreachable or unreadable: ${error instanceof Error ? error.name : 'Error'}`)
    return null
  }

  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) {
    console.warn('searchPodcasts: directory answer had no results list')
    return null
  }
  return results.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const result = entry as Record<string, unknown>
    const feedUrl = typeof result.feedUrl === 'string' ? normaliseFeedUrl(result.feedUrl) : null
    const title = text(result.collectionName) ?? text(result.trackName)
    if (!feedUrl || !title) return []
    const artwork = text(result.artworkUrl600) ?? text(result.artworkUrl100)
    // Shown as an image's source, so it too must be http or https.
    return [{ title, author: text(result.artistName), artworkUrl: artwork && normaliseFeedUrl(artwork), feedUrl }]
  })
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

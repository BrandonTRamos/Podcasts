import type { FeedStore } from '../feeds/feedStore'
import { normaliseFeedUrl } from '../feeds/feedUrl'

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

/** A directory listing, before it is checked against the library. */
export type DirectoryListing = Omit<DirectoryPodcast, 'podcastId'>

/** What the directory's queries answer with. */
export interface DirectoryResult {
  /** `directoryUnavailable`: the directory could not be reached or gave no usable answer; `podcasts` is empty. */
  outcome: 'found' | 'directoryUnavailable'
  podcasts: DirectoryPodcast[]
}

/** The public directory: Apple's (the iTunes Search API and its charts), which needs no key. */
export const DIRECTORY_ORIGIN = 'https://itunes.apple.com'
const TIMEOUT_MS = 8_000

/**
 * The directory's JSON answer to a GET; null if it could not be reached or
 * gave no usable answer, which is logged under the query's `name`.
 */
export async function askDirectory(name: string, url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      console.warn(`${name}: directory answered ${response.status}`)
      return null
    }
    return await response.json()
  } catch (error) {
    console.warn(`${name}: directory unreachable or unreadable: ${error instanceof Error ? error.name : 'Error'}`)
    return null
  }
}

/** The podcast one of the directory's results lists, if it has a title and a usable feed; otherwise null. */
export function listingOf(entry: unknown): DirectoryListing | null {
  if (typeof entry !== 'object' || entry === null) return null
  const result = entry as Record<string, unknown>
  const feedUrl = httpUrl(nonBlankString(result.feedUrl))
  const title = nonBlankString(result.collectionName) ?? nonBlankString(result.trackName)
  if (!feedUrl || !title) return null
  // Shown as an image's source, so it too must be http or https.
  const artworkUrl = httpUrl(nonBlankString(result.artworkUrl600) ?? nonBlankString(result.artworkUrl100))
  return { title, author: nonBlankString(result.artistName), artworkUrl, feedUrl }
}

/** The listings, each marked with its podcast's ID when it is already in the library. */
export async function markInLibrary(store: FeedStore, listings: DirectoryListing[]): Promise<DirectoryPodcast[]> {
  if (listings.length === 0) return []
  const library = new Map((await store.listPodcasts()).map((podcast) => [podcast.feedUrl, podcast.id]))
  return listings.map((podcast) => ({ ...podcast, podcastId: library.get(podcast.feedUrl) ?? null }))
}

/** The URL, normalised, if it is http or https; otherwise null. */
function httpUrl(value: string | null): string | null {
  return value === null ? null : normaliseFeedUrl(value)
}

function nonBlankString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

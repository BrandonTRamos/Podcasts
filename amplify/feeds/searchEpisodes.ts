import type { FeedStore } from './feedStore'
import { withUrlsRedactedFromErrors } from './feedUrl'
import { fetchFeed } from './fetchFeed'
import { wordMatcher } from './matchWords'
import type { ParsedEpisode } from './parseFeed'
import { episodeId, newestFirst } from './storeEpisodes'

export interface SearchEpisodesEvent {
  arguments: { podcastId: string; term: string }
}

/** An episode as the feed lists it now, stored or not, without its show notes. */
export interface FeedEpisode {
  /** The ID it is stored under, or would be (see `storeEpisodes.ts`). */
  id: string
  podcastId: string
  title: string
  publishedAt: string | null
  durationSeconds: number | null
  enclosureUrl: string
}

export interface SearchEpisodesResult {
  outcome: 'found' | 'feedUnavailable'
  /** Newest first. Empty when nothing matched, or when the feed is unavailable. */
  episodes: FeedEpisode[]
  /** Whether more matched than are returned. */
  more: boolean
}

/** Most matches returned: the newest this many. */
export const EPISODE_SEARCH_LIMIT = 50

/**
 * The `searchEpisodes` query: finds episodes anywhere in a podcast's feed,
 * however far back, by the words of their titles and show notes (see
 * `matchWords.ts`). The feed is fetched afresh and searched here; nothing is
 * stored, so a feed carrying thousands of episodes still keeps only its newest
 * in the library. A match the listener wants is stored by the `keepEpisode`
 * mutation.
 *
 * A feed that can't be fetched, or a podcast no longer in the library, is an
 * outcome, not an error, so the client can say so plainly.
 */
export function createSearchEpisodesHandler({ store }: { store: FeedStore }) {
  return withUrlsRedactedFromErrors(
    'searchEpisodes',
    async ({ arguments: { podcastId, term } }: SearchEpisodesEvent): Promise<SearchEpisodesResult> => {
      const matches = wordMatcher(term)
      if (!matches) return { outcome: 'found', episodes: [], more: false }

      const podcast = await store.getPodcast(podcastId)
      const fetched = podcast && (await fetchFeed(podcast.feedUrl))
      if (!fetched?.ok) return { outcome: 'feedUnavailable', episodes: [], more: false }

      const found = newestFirst(fetched.feed.episodes).filter((episode) => matches(searchedText(episode)))
      return {
        outcome: 'found',
        episodes: found.slice(0, EPISODE_SEARCH_LIMIT).map(({ guid, title, publishedAt, durationSeconds, enclosureUrl }) => ({
          id: episodeId(podcastId, guid),
          podcastId,
          title,
          publishedAt,
          durationSeconds,
          enclosureUrl,
        })),
        more: found.length > EPISODE_SEARCH_LIMIT,
      }
    },
  )
}

/** What a search looks through: the title, and the show notes as read, without their markup (tag names, link addresses). */
function searchedText({ title, showNotes }: ParsedEpisode): string {
  return showNotes ? `${title}\n${showNotes.replace(/<[^>]*>/g, ' ')}` : title
}

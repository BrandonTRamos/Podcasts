import { createHash } from 'node:crypto'
import type { EpisodeRecord, FeedStore } from './feedStore'
import type { ParsedEpisode } from './parseFeed'

/**
 * Stores the newest `limit` of a feed's episodes for a podcast: adds those not
 * yet stored and updates those the feed has changed (a new audio URL, say),
 * leaving the rest unwritten. Older items are left out, so a feed carrying
 * thousands is never ingested in full. Safe to run again after failing part-way.
 */
export async function storeEpisodes(store: FeedStore, podcastId: string, episodes: ParsedEpisode[], limit: number) {
  for (const parsed of newestFirst(episodes).slice(0, limit)) await storeEpisode(store, podcastId, parsed)
}

/** Stores one of a feed's episodes: adds it if it is not yet stored, or updates it if the feed has changed it. */
export async function storeEpisode(store: FeedStore, podcastId: string, parsed: ParsedEpisode) {
  const episode: EpisodeRecord = { id: episodeId(podcastId, parsed.guid), podcastId, ...parsed }
  const existing = await store.getEpisode(episode.id)
  if (!existing) await store.createEpisode(episode)
  else if (!sameEpisode(existing, episode)) await store.updateEpisode(episode)
}

/** Dated episodes newest first, then undated ones in feed order (most feeds list newest first). */
export function newestFirst(episodes: ParsedEpisode[]): ParsedEpisode[] {
  const time = (episode: ParsedEpisode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

/** Stable per podcast and GUID, whatever characters the GUID contains. */
export function episodeId(podcastId: string, guid: string): string {
  return `${podcastId}:${createHash('sha256').update(guid).digest('hex').slice(0, 32)}`
}

/** Every field but the ID, which is derived from two of them. Listed in full so a new field can't be missed. */
const compared: Record<Exclude<keyof EpisodeRecord, 'id'>, true> = {
  podcastId: true,
  guid: true,
  title: true,
  publishedAt: true,
  durationSeconds: true,
  enclosureUrl: true,
  enclosureType: true,
  showNotes: true,
}

function sameEpisode(a: EpisodeRecord, b: EpisodeRecord): boolean {
  return (Object.keys(compared) as (keyof typeof compared)[]).every((field) => a[field] === b[field])
}

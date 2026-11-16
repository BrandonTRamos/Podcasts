import type { Episode, EpisodeState } from './services'

/** How long after it is published a podcast's most recent episode, not yet started, still counts as new. */
export const NEW_FOR_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Which of the episodes to call new, by ID: a podcast's most recent one, if
 * it was published within the last three days and is not started or played.
 * So at most one episode per podcast is new (more only when its latest share
 * a publish time), an earlier one never is however recent, and neither is an
 * undated one. Each podcast's most recent is judged among the episodes given,
 * which must therefore include it.
 */
export function newEpisodeIds(
  episodes: Episode[],
  stateOf: (episodeId: string) => EpisodeState | undefined,
  now = Date.now(),
): ReadonlySet<string> {
  const time = (episode: Episode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  const mostRecent = new Map<string, number>()
  for (const episode of episodes) {
    mostRecent.set(episode.podcastId, Math.max(time(episode), mostRecent.get(episode.podcastId) ?? -Infinity))
  }
  const ids = new Set<string>()
  for (const episode of episodes) {
    const published = time(episode)
    if (published !== mostRecent.get(episode.podcastId) || !(now - published < NEW_FOR_MS)) continue
    const state = stateOf(episode.id)
    if (state?.played || (state && state.positionSeconds > 0)) continue
    ids.add(episode.id)
  }
  return ids
}

/** Dated episodes newest first; undated ones last. */
export function newestFirst(episodes: Episode[]): Episode[] {
  const time = (episode: Episode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

/**
 * A podcast's Recently Added, of its episodes (all the library has, so its
 * most recent is among them): those the listener added, those this device
 * has downloaded or begun to, and the new one. Ordered by
 * when each was added or, if later or never added, published, latest first.
 */
export function recentlyAdded(
  episodes: Episode[],
  stateOf: (episodeId: string) => EpisodeState | undefined,
  downloaded: (episodeId: string) => boolean,
  now = Date.now(),
): Episode[] {
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : -Infinity)
  const since = (episode: Episode) => Math.max(time(stateOf(episode.id)?.addedAt), time(episode.publishedAt))
  const fresh = newEpisodeIds(episodes, stateOf, now)
  return episodes
    .filter((episode) => stateOf(episode.id)?.addedAt != null || downloaded(episode.id) || fresh.has(episode.id))
    .sort((a, b) => since(b) - since(a) || 0)
}

/** Whether the listener has started the episode but not finished it: a place past the start, and not played. */
export function isInProgress(state: Pick<EpisodeState, 'positionSeconds' | 'played'> | undefined): boolean {
  return state !== undefined && !state.played && state.positionSeconds > 0
}

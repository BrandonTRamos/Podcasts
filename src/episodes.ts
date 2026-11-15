import type { Episode, EpisodeState } from './services'

/** How long after it is published an episode not yet started still counts as new. */
export const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether to call the episode new: published within the last week and not
 * started or played. So a podcast's back catalogue is not new just for being
 * unheard, and an undated episode never is.
 */
export function isNew(episode: Episode, state: EpisodeState | undefined, now = Date.now()): boolean {
  if (state?.played || (state && state.positionSeconds > 0)) return false
  if (!episode.publishedAt) return false
  return now - Date.parse(episode.publishedAt) < NEW_FOR_MS
}

/** Dated episodes newest first; undated ones last. */
export function newestFirst(episodes: Episode[]): Episode[] {
  const time = (episode: Episode) => (episode.publishedAt ? Date.parse(episode.publishedAt) : -Infinity)
  return [...episodes].sort((a, b) => time(b) - time(a) || 0)
}

/** Whether the listener has started the episode but not finished it: a place past the start, and not played. */
export function isInProgress(state: Pick<EpisodeState, 'positionSeconds' | 'played'> | undefined): boolean {
  return state !== undefined && !state.played && state.positionSeconds > 0
}

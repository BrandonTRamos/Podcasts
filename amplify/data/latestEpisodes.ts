/**
 * Every episode's `listing` field holds this one value, so that a single index
 * query (`listEpisodesByDate`, sorted on `publishedAt`) gives the latest
 * episodes across all podcasts. Shared by the backend, which writes it, and the
 * client, which queries it; kept apart from `resource.ts` so the client bundle
 * need not import the backend's definitions.
 */
export const LATEST_LISTING = 'latest'

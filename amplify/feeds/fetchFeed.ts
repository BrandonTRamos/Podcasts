import { normaliseFeedUrl } from './feedUrl'
import { type ParsedFeed, parseFeed } from './parseFeed'

export type FetchFeedResult =
  | { ok: true; feed: ParsedFeed; etag: string | null; lastModified: string | null }
  | { ok: false; reason: 'invalidUrl' | 'unreachable' | 'notAFeed' }

const TIMEOUT_MS = 15_000

/**
 * Fetches and parses a feed. Never throws, and nothing it returns contains the
 * feed URL, so callers can't leak it into logs or error messages by accident.
 */
export async function fetchFeed(feedUrl: string): Promise<FetchFeedResult> {
  // Server-side fetches accept only http and https, whoever the caller is.
  if (normaliseFeedUrl(feedUrl) === null) return { ok: false, reason: 'invalidUrl' }

  let response: Response
  try {
    response = await fetch(feedUrl, {
      headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) return { ok: false, reason: 'unreachable' }

  let body: string
  try {
    body = await response.text()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  const feed = parseFeed(body)
  if (!feed) return { ok: false, reason: 'notAFeed' }

  return {
    ok: true,
    feed,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  }
}

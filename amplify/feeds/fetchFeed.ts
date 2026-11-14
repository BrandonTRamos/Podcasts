import { normaliseFeedUrl } from './feedUrl'
import { type ParsedFeed, parseFeed } from './parseFeed'

/** The feed's version as a server labels it, for asking later whether it has changed. */
export interface FeedVersion {
  etag: string | null
  lastModified: string | null
}

export type FetchFeedResult =
  | { ok: true; changed: true; feed: ParsedFeed; version: FeedVersion }
  /** The server says the feed is the same as the version asked about. */
  | { ok: true; changed: false }
  | { ok: false; reason: 'invalidUrl' | 'unreachable' | 'notAFeed' }

const TIMEOUT_MS = 15_000

/**
 * Fetches and parses a feed. Given the version last fetched, it asks the server
 * (a conditional GET) whether the feed has changed since, and the server can
 * answer that it has not without sending it again. Never throws, and nothing it
 * returns contains the feed URL, so callers can't leak it into logs or error
 * messages by accident.
 */
export function fetchFeed(feedUrl: string): Promise<Exclude<FetchFeedResult, { changed: false }>>
export function fetchFeed(feedUrl: string, since: FeedVersion): Promise<FetchFeedResult>
export async function fetchFeed(feedUrl: string, since?: FeedVersion): Promise<FetchFeedResult> {
  // Server-side fetches accept only http and https, whoever the caller is.
  if (normaliseFeedUrl(feedUrl) === null) return { ok: false, reason: 'invalidUrl' }

  const headers: Record<string, string> = {
    Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
  }
  if (since?.etag) headers['If-None-Match'] = since.etag
  if (since?.lastModified) headers['If-Modified-Since'] = since.lastModified

  let response: Response
  try {
    response = await fetch(feedUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (response.status === 304 && since) return { ok: true, changed: false }
  if (!response.ok) return { ok: false, reason: 'unreachable' }

  let body: string
  try {
    body = await response.text()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  const feed = parseFeed(body)
  if (!feed) return { ok: false, reason: 'notAFeed' }

  const version = { etag: response.headers.get('ETag'), lastModified: response.headers.get('Last-Modified') }
  return { ok: true, changed: true, feed, version }
}

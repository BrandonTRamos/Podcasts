import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import type { EpisodeRecord, FeedStore, PodcastRecord, SubscribeRequestRecord } from '../feeds/feedStore'
import type { SubscribeRequestStreamEvent } from '../feeds/ingestFeed'

/**
 * In-memory stand-in for the data API, with the same create-fails-on-existing-ID
 * rule. Like the real subscribe-request table, it streams each new request:
 * `takeStreamEvent` returns the inserts since it was last called.
 */
export function fakeFeedStore() {
  const podcasts = new Map<string, PodcastRecord>()
  const episodes = new Map<string, EpisodeRecord>()
  const requests = new Map<string, SubscribeRequestRecord>()
  let unstreamed: string[] = []
  let nextId = 1

  const store: FeedStore = {
    async findPodcastByFeedUrl(feedUrl) {
      return [...podcasts.values()].find((podcast) => podcast.feedUrl === feedUrl) ?? null
    },
    async createPodcast(podcast) {
      const record = { ...podcast, id: `podcast-${nextId++}` }
      podcasts.set(record.id, record)
      return record
    },
    async getEpisode(id) {
      return episodes.get(id) ?? null
    },
    async createEpisode(episode) {
      if (episodes.has(episode.id)) throw new Error(`Episode ${episode.id} already exists`)
      episodes.set(episode.id, episode)
    },
    async createSubscribeRequest(feedUrl) {
      const record: SubscribeRequestRecord = { id: `request-${nextId++}`, feedUrl, status: 'pending', podcastId: null }
      requests.set(record.id, record)
      unstreamed.push(record.id)
      return record
    },
    async getSubscribeRequest(id) {
      return requests.get(id) ?? null
    },
    async settleSubscribeRequest(id, outcome) {
      const existing = requests.get(id)
      if (!existing) throw new Error(`No subscribe request ${id}`)
      requests.set(id, { ...existing, ...outcome })
    },
  }

  return {
    store,
    podcasts: () => [...podcasts.values()],
    episodesOf: (podcastId: string) => [...episodes.values()].filter((e) => e.podcastId === podcastId),
    request: (id: string) => requests.get(id),
    takeStreamEvent(): SubscribeRequestStreamEvent {
      const ids = unstreamed
      unstreamed = []
      return { Records: ids.map((id) => ({ eventName: 'INSERT', dynamodb: { Keys: { id: { S: id } } } })) }
    },
  }
}

type FakeResponse = string | { status?: number; body?: string }

/**
 * Fakes outbound HTTP: each URL gets a canned response. Any other URL fails the
 * way an unresolvable host does. Returns the URLs requested, in order.
 */
export function fakeHttp(responses: Record<string, FakeResponse>) {
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    requested.push(url)
    const response = responses[url]
    if (response === undefined) throw new TypeError('fetch failed')
    const { status = 200, body = '' } = typeof response === 'string' ? { body: response } : response
    return new Response(body, { status })
  })
  return { requested }
}

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

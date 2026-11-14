import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import type { EpisodeRecord, FeedStore, PodcastRecord, SubscribeRequestRecord } from '../feeds/feedStore'
import type { SubscribeRequestStreamEvent } from '../feeds/ingestFeed'

/** Listening state as the fake holds it: what the backend handlers see of it, and its queue place. */
interface FakeEpisodeState {
  id: string
  podcastId: string
  queueOrder?: number
}

/**
 * In-memory stand-in for the data API, with the same create-fails-on-existing-ID
 * rule. Like the real subscribe-request table, it streams each new request:
 * `takeStreamEvent` returns the inserts since it was last called. `writes`
 * lists every podcast and episode write, in order. `failNextDelete` makes one
 * delete fail, as a dropped call to the data API would.
 */
export function fakeFeedStore() {
  const podcasts = new Map<string, PodcastRecord>()
  const episodes = new Map<string, EpisodeRecord>()
  const requests = new Map<string, SubscribeRequestRecord>()
  const states = new Map<string, FakeEpisodeState>()
  const failingDeletes = new Set<string>()
  /** Run as the record with that ID is deleted, standing in for a write made meanwhile by something else. */
  const afterDeletes = new Map<string, () => void>()
  let writes: string[] = []
  let unstreamed: string[] = []
  let nextId = 1

  const store: FeedStore = {
    async findPodcastByFeedUrl(feedUrl) {
      return [...podcasts.values()].find((podcast) => podcast.feedUrl === feedUrl) ?? null
    },
    async listPodcasts() {
      return [...podcasts.values()]
    },
    async getPodcast(id) {
      return podcasts.get(id) ?? null
    },
    async createPodcast(podcast) {
      const record = { ...podcast, id: `podcast-${nextId++}` }
      podcasts.set(record.id, record)
      writes.push(`createPodcast ${record.id}`)
      return record
    },
    async updatePodcast(id, changes) {
      const existing = podcasts.get(id)
      if (!existing) throw new Error(`No podcast ${id}`)
      podcasts.set(id, { ...existing, ...changes })
      writes.push(`updatePodcast ${id}`)
    },
    async getEpisode(id) {
      return episodes.get(id) ?? null
    },
    async createEpisode(episode) {
      if (episodes.has(episode.id)) throw new Error(`Episode ${episode.id} already exists`)
      episodes.set(episode.id, episode)
      writes.push(`createEpisode ${episode.id}`)
    },
    async updateEpisode(episode) {
      if (!episodes.has(episode.id)) throw new Error(`No episode ${episode.id}`)
      episodes.set(episode.id, episode)
      writes.push(`updateEpisode ${episode.id}`)
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
    async deletePodcast(id) {
      failIfAsked(id)
      podcasts.delete(id)
    },
    async listEpisodeIds(podcastId) {
      return [...episodes.values()].filter((e) => e.podcastId === podcastId).map((e) => e.id)
    },
    async deleteEpisode(id) {
      failIfAsked(id)
      episodes.delete(id)
    },
    async listEpisodeStateIds(podcastId) {
      return [...states.values()].filter((state) => state.podcastId === podcastId).map((state) => state.id)
    },
    async deleteEpisodeState(id) {
      failIfAsked(id)
      states.delete(id)
    },
  }

  function failIfAsked(id: string) {
    afterDeletes.get(id)?.()
    afterDeletes.delete(id)
    if (failingDeletes.delete(id)) throw new Error(`Deleting ${id} failed`)
  }

  return {
    store,
    podcasts: () => [...podcasts.values()],
    podcast: (id: string) => podcasts.get(id),
    episodesOf: (podcastId: string) => [...episodes.values()].filter((e) => e.podcastId === podcastId),
    request: (id: string) => requests.get(id),
    /** Listening state saved by the client, as the data API would hold it. */
    seedEpisodeState(state: FakeEpisodeState) {
      states.set(state.id, state)
    },
    episodeStates: () => [...states.values()],
    /** Runs `meanwhile` as the record with this ID is deleted, as a write from elsewhere landing then would. */
    whenDeleting(id: string, meanwhile: () => void) {
      afterDeletes.set(id, meanwhile)
    },
    /** The next delete of the record with this ID fails. */
    failNextDelete(id: string) {
      failingDeletes.add(id)
    },
    /** The podcast and episode writes since this was last called, oldest first. */
    takeWrites(): string[] {
      const taken = writes
      writes = []
      return taken
    },
    takeStreamEvent(): SubscribeRequestStreamEvent {
      const ids = unstreamed
      unstreamed = []
      return { Records: ids.map((id) => ({ eventName: 'INSERT', dynamodb: { Keys: { id: { S: id } } } })) }
    },
  }
}

type FakeResponse = string | { status?: number; body?: string; headers?: Record<string, string> }

/**
 * Fakes outbound HTTP: each URL gets a canned response. Any other URL fails the
 * way an unresolvable host does. Like a real server, a response with an `ETag`
 * or `Last-Modified` header is answered with 304 Not Modified when the request
 * names that same version (`If-None-Match` / `If-Modified-Since`). Returns the
 * requests made, in order.
 */
export function fakeHttp(responses: Record<string, FakeResponse>) {
  const requests: { url: string; headers: Headers }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const requestHeaders = new Headers(input instanceof Request ? input.headers : init?.headers)
    requests.push({ url, headers: requestHeaders })
    const response = responses[url]
    if (response === undefined) throw new TypeError('fetch failed')
    const { status = 200, body = '', headers = {} } = typeof response === 'string' ? { body: response } : response
    const responseHeaders = new Headers(headers)
    const etag = responseHeaders.get('ETag')
    const lastModified = responseHeaders.get('Last-Modified')
    const notModified =
      status === 200 &&
      ((etag !== null && requestHeaders.get('If-None-Match') === etag) ||
        (etag === null && lastModified !== null && requestHeaders.get('If-Modified-Since') === lastModified))
    if (notModified) return new Response(null, { status: 304, headers: responseHeaders })
    return new Response(body, { status, headers: responseHeaders })
  })
  return {
    requests,
    get requested() {
      return requests.map((request) => request.url)
    },
  }
}

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/** A feed listing episodes 1..count oldest first (as some feeds do), one day apart. */
export function feedWithEpisodes(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const number = index + 1
    const date = new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toUTCString()
    return `<item><title>Episode ${number}</title><guid>long-${number}</guid><pubDate>${date}</pubDate>
      <enclosure url="https://cdn.example.com/long/${number}.mp3" type="audio/mpeg"/></item>`
  })
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Long Show</title>${items.join('')}</channel></rss>`
}

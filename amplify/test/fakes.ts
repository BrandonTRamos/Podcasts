import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import type { EpisodeRecord, FeedStore, PodcastRecord } from '../feeds/feedStore'

/** In-memory stand-in for the data API, with the same create-fails-on-existing-ID rule. */
export function fakeFeedStore() {
  const podcasts = new Map<string, PodcastRecord>()
  const episodes = new Map<string, EpisodeRecord>()
  const refreshRequests: string[] = []
  let nextId = 1

  const store: FeedStore = {
    async findPodcastByFeedUrl(feedUrl) {
      return [...podcasts.values()].find((podcast) => podcast.feedUrl === feedUrl) ?? null
    },
    async getPodcast(id) {
      return podcasts.get(id) ?? null
    },
    async createPodcast(podcast) {
      const record = { ...podcast, id: `podcast-${nextId++}` }
      podcasts.set(record.id, record)
      return record
    },
    async updatePodcast(id, changes) {
      const existing = podcasts.get(id)
      if (!existing) throw new Error(`No podcast ${id}`)
      podcasts.set(id, { ...existing, ...changes })
    },
    async deletePodcast(id) {
      podcasts.delete(id)
    },
    async getEpisode(id) {
      return episodes.get(id) ?? null
    },
    async createEpisode(episode) {
      if (episodes.has(episode.id)) throw new Error(`Episode ${episode.id} already exists`)
      episodes.set(episode.id, episode)
    },
    async requestRefresh(podcastId) {
      refreshRequests.push(podcastId)
    },
  }

  return {
    store,
    podcasts: () => [...podcasts.values()],
    episodesOf: (podcastId: string) => [...episodes.values()].filter((e) => e.podcastId === podcastId),
    /** Takes the refreshes requested so far, as the async data API would deliver them. */
    takeRefreshRequests: () => refreshRequests.splice(0),
  }
}

type FakeResponse = string | { status?: number; body?: string; headers?: Record<string, string> }

/**
 * Fakes outbound HTTP: each URL gets a canned response. Any other URL fails the
 * way an unresolvable host does. Returns the URLs requested, in order.
 */
export function fakeHttp(responses: Record<string, FakeResponse | (() => FakeResponse)>) {
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    requested.push(url)
    const entry = responses[url]
    if (entry === undefined) throw new TypeError('fetch failed')
    const response = typeof entry === 'function' ? entry() : entry
    const { status = 200, body = '', headers = {} } = typeof response === 'string' ? { body: response } : response
    return new Response(body, { status, headers })
  })
  return { requested }
}

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

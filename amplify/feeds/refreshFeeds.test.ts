import { describe, expect, it } from 'vitest'
import { fakeHttp, feedWithEpisodes, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

const showUrl = 'https://feeds.example.com/show.xml'
const otherUrl = 'https://feeds.other.example.com/other.xml'

const episode3 = `<item>
  <title>Episode 3: The Finale</title>
  <guid isPermaLink="false">example-show-ep-3</guid>
  <pubDate>Fri, 13 Nov 2026 08:00:00 GMT</pubDate>
  <enclosure url="https://cdn.example.com/show/ep3.mp3" type="audio/mpeg"/>
</item>`

/** The show's fixture feed with a newer episode at the top, as after a release. */
const showWithEpisode3 = fixture('show.xml').replace('<item>', `${episode3}<item>`)

const otherFeed = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>The Other Show</title>${items}</channel></rss>`
const otherItem = (n: number) =>
  `<item><title>Other ${n}</title><guid>other-${n}</guid><pubDate>${new Date(Date.UTC(2026, 10, n)).toUTCString()}</pubDate>
    <enclosure url="https://cdn.other.example.com/${n}.mp3" type="audio/mpeg"/></item>`

const titlesOf = (episodes: { title: string }[]) => episodes.map((episode) => episode.title).sort()

/** Subscribes to each feed as currently served, and clears the record of writes. */
async function subscribedTo(flow: ReturnType<typeof feedHandlers>, ...feedUrls: string[]) {
  const ids: string[] = []
  for (const feedUrl of feedUrls) ids.push((await flow.subscribeAndIngest(feedUrl)).podcastId!)
  flow.data.takeWrites()
  return ids
}

describe('the hourly refresh', () => {
  it('adds new episodes to every subscribed podcast and records when each was refreshed', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml'), [otherUrl]: otherFeed(otherItem(1)) })
    const flow = feedHandlers()
    const [show, other] = await subscribedTo(flow, showUrl, otherUrl)
    fakeHttp({ [showUrl]: showWithEpisode3, [otherUrl]: otherFeed(otherItem(2) + otherItem(1)) })
    flow.clock.now = new Date('2026-11-14T10:00:00.000Z')

    await flow.refreshAll()

    expect(titlesOf(flow.data.episodesOf(show))).toEqual([
      'Episode 1: The Beginning',
      'Episode 2: The Sequel',
      'Episode 3: The Finale',
    ])
    expect(titlesOf(flow.data.episodesOf(other))).toEqual(['Other 1', 'Other 2'])
    for (const id of [show, other]) {
      expect(flow.data.podcast(id)).toMatchObject({ lastFetchedAt: '2026-11-14T10:00:00.000Z', lastFetchError: null })
    }
  })

  it('takes in changes to the podcast’s title, author and artwork', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({
      [showUrl]: fixture('show.xml')
        .replace('<title>The Example Show</title>', '<title>The Example Show (Renamed)</title>')
        .replace('show/artwork.jpg', 'show/artwork-2027.jpg'),
    })

    await flow.refreshAll()

    expect(flow.data.podcast(show)).toMatchObject({
      title: 'The Example Show (Renamed)',
      author: 'Example Media',
      artworkUrl: 'https://cdn.example.com/show/artwork-2027.jpg',
    })
  })

  it('does nothing when there are no subscriptions', async () => {
    const http = fakeHttp({})
    const flow = feedHandlers()

    await flow.refreshAll()

    expect(http.requests).toEqual([])
    expect(flow.data.takeWrites()).toEqual([])
  })
})

describe('refreshing an unchanged feed', () => {
  it.each([
    ['an ETag', { ETag: '"v1"' }, 'If-None-Match', '"v1"'],
    ['a Last-Modified date', { 'Last-Modified': 'Tue, 10 Nov 2026 08:00:00 GMT' }, 'If-Modified-Since', 'Tue, 10 Nov 2026 08:00:00 GMT'],
  ])('asks with %s whether it changed, and writes nothing when it has not', async (_case, headers, condition, value) => {
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers } })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    const before = { podcast: flow.data.podcast(show), episodes: flow.data.episodesOf(show) }
    const http = fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers } })
    flow.clock.now = new Date('2026-11-14T10:00:00.000Z')

    await flow.refreshAll()

    expect(http.requests).toHaveLength(1)
    expect(http.requests[0].headers.get(condition)).toBe(value)
    expect(flow.data.takeWrites()).toEqual([])
    expect({ podcast: flow.data.podcast(show), episodes: flow.data.episodesOf(show) }).toEqual(before)
  })

  it('fetches it in full, and takes in what changed, once a new version is published', async () => {
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({ [showUrl]: { body: showWithEpisode3, headers: { ETag: '"v2"' } } })
    await flow.refreshAll()
    const http = fakeHttp({ [showUrl]: { body: showWithEpisode3, headers: { ETag: '"v2"' } } })

    await flow.refreshAll()

    expect(titlesOf(flow.data.episodesOf(show))).toContain('Episode 3: The Finale')
    expect(http.requests[0].headers.get('If-None-Match')).toBe('"v2"')
    expect(flow.data.takeWrites().filter((write) => write.includes('Episode'))).toEqual([
      `createEpisode ${flow.data.episodesOf(show).find((e) => e.title === 'Episode 3: The Finale')!.id}`,
    ])
  })

  it('writes no episodes when a feed without version headers comes back the same', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    await subscribedTo(flow, showUrl)

    await flow.refreshAll()

    expect(flow.data.takeWrites().filter((write) => write.includes('Episode'))).toEqual([])
  })
})

describe('an episode whose audio URL changed in the feed', () => {
  it('is updated in place, keeping its ID, not added again', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    const before = flow.data.episodesOf(show).find((episode) => episode.guid === 'example-show-ep-2')!
    fakeHttp({ [showUrl]: fixture('show.xml').replace('show/ep2.mp3', 'show/ep2-remastered.mp3') })

    await flow.refreshAll()

    const episodes = flow.data.episodesOf(show)
    expect(episodes).toHaveLength(2)
    expect(episodes.find((episode) => episode.guid === 'example-show-ep-2')).toEqual({
      ...before,
      enclosureUrl: 'https://cdn.example.com/show/ep2-remastered.mp3',
    })
    expect(flow.data.takeWrites().filter((write) => write.includes('Episode'))).toEqual([`updateEpisode ${before.id}`])
  })
})

describe('a feed that fails', () => {
  it.each([
    ['cannot be reached', {}, 'unreachable'],
    ['returns a server error', { [showUrl]: { status: 503, body: 'Unavailable' } }, 'unreachable'],
    ['is no longer a feed', { [showUrl]: '<html><body>Gone</body></html>' }, 'notAFeed'],
  ] as const)('is recorded against its podcast when it %s, and the others are still refreshed', async (_case, showResponse, error) => {
    fakeHttp({ [showUrl]: fixture('show.xml'), [otherUrl]: otherFeed(otherItem(1)) })
    const flow = feedHandlers()
    const [show, other] = await subscribedTo(flow, showUrl, otherUrl)
    fakeHttp({ ...showResponse, [otherUrl]: otherFeed(otherItem(2) + otherItem(1)) })
    flow.clock.now = new Date('2026-11-14T10:00:00.000Z')

    await flow.refreshAll()

    expect(flow.data.podcast(show)).toMatchObject({ lastFetchedAt: '2026-11-14T09:00:00.000Z', lastFetchError: error })
    expect(flow.data.episodesOf(show)).toHaveLength(2)
    expect(flow.data.podcast(other)).toMatchObject({ lastFetchedAt: '2026-11-14T10:00:00.000Z', lastFetchError: null })
    expect(titlesOf(flow.data.episodesOf(other))).toEqual(['Other 1', 'Other 2'])
  })

  it('does not stop the others when storing its episodes fails, and the run then reports the failure', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml'), [otherUrl]: otherFeed(otherItem(1)) })
    const flow = feedHandlers()
    const [show, other] = await subscribedTo(flow, showUrl, otherUrl)
    fakeHttp({ [showUrl]: showWithEpisode3, [otherUrl]: otherFeed(otherItem(2) + otherItem(1)) })
    const createEpisode = flow.data.store.createEpisode
    flow.data.store.createEpisode = async (episode) => {
      if (episode.podcastId === show) throw new Error('Throttled')
      await createEpisode(episode)
    }

    await expect(flow.refreshAll()).rejects.toThrow()

    expect(flow.data.podcast(show)).toMatchObject({ lastFetchError: 'failed' })
    expect(titlesOf(flow.data.episodesOf(other))).toEqual(['Other 1', 'Other 2'])
  })

  it('is fetched in full next time after failing part-way, so no episode is missed', async () => {
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({ [showUrl]: { body: showWithEpisode3, headers: { ETag: '"v2"' } } })
    const createEpisode = flow.data.store.createEpisode
    flow.data.store.createEpisode = async () => {
      throw new Error('Throttled')
    }
    await expect(flow.refreshAll()).rejects.toThrow()
    flow.data.store.createEpisode = createEpisode

    await flow.refreshAll()

    expect(titlesOf(flow.data.episodesOf(show))).toContain('Episode 3: The Finale')
    expect(flow.data.podcast(show)).toMatchObject({ etag: '"v2"', lastFetchError: null })
  })

  it('writes nothing more while it keeps failing the same way', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    await subscribedTo(flow, showUrl)
    fakeHttp({})
    await flow.refreshAll()
    flow.data.takeWrites()

    await flow.refreshAll()

    expect(flow.data.takeWrites()).toEqual([])
  })

  it('has its failure cleared once it works again, even unchanged (which leaves the time it was last fetched in full)', async () => {
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({})
    await flow.refreshAll()
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    flow.clock.now = new Date('2026-11-14T11:00:00.000Z')

    await flow.refreshAll()

    expect(flow.data.podcast(show)).toMatchObject({ lastFetchedAt: '2026-11-14T09:00:00.000Z', lastFetchError: null })
  })
})

describe('a feed with thousands of episodes', () => {
  it('gets only its new episodes, not the back catalogue the first ingest left out', async () => {
    fakeHttp({ [showUrl]: feedWithEpisodes(3000) })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({ [showUrl]: feedWithEpisodes(3002) })

    await flow.refreshAll()

    const titles = flow.data.episodesOf(show).map((episode) => episode.title)
    expect(titles).toHaveLength(102)
    expect(titles).toEqual(expect.arrayContaining(['Episode 3002', 'Episode 3001', 'Episode 2901']))
    expect(titles).not.toContain('Episode 2900')
    expect(flow.data.takeWrites()).toEqual([
      expect.stringMatching(/^createEpisode /),
      expect.stringMatching(/^createEpisode /),
      `updatePodcast ${show}`,
    ])
  })
})

describe('refreshing one podcast on demand', () => {
  it('refreshes that podcast only', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml'), [otherUrl]: otherFeed(otherItem(1)) })
    const flow = feedHandlers()
    const [show, other] = await subscribedTo(flow, showUrl, otherUrl)
    const http = fakeHttp({ [showUrl]: showWithEpisode3, [otherUrl]: otherFeed(otherItem(2) + otherItem(1)) })

    await flow.refreshPodcast(show)

    expect(http.requested).toEqual([showUrl])
    expect(titlesOf(flow.data.episodesOf(show))).toContain('Episode 3: The Finale')
    expect(titlesOf(flow.data.episodesOf(other))).toEqual(['Other 1'])
  })

  it('records a failure against the podcast', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const [show] = await subscribedTo(flow, showUrl)
    fakeHttp({})

    await flow.refreshPodcast(show)

    expect(flow.data.podcast(show)).toMatchObject({ lastFetchError: 'unreachable' })
  })

  it('does nothing for a podcast that is no longer in the library', async () => {
    const http = fakeHttp({})
    const flow = feedHandlers()

    await flow.refreshPodcast('podcast-gone')

    expect(http.requests).toEqual([])
    expect(flow.data.takeWrites()).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { fakeHttp, feedWithEpisodes, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

const showUrl = 'https://feeds.example.com/show.xml'
const longUrl = 'https://feeds.example.com/long.xml'

const feed = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>A Show</title>${items}</channel></rss>`
const item = (n: number, title: string, notes = '') =>
  `<item><title>${title}</title><guid>ep-${n}</guid><pubDate>${new Date(Date.UTC(2020, 0, n)).toUTCString()}</pubDate>
    <enclosure url="https://cdn.example.com/${n}.mp3" type="audio/mpeg"/><description><![CDATA[${notes}]]></description></item>`

const titlesOf = (episodes: { title: string }[]) => episodes.map((episode) => episode.title)

/** Subscribes to the feed as currently served, and clears the record of writes. */
async function subscribedTo(flow: ReturnType<typeof feedHandlers>, feedUrl: string) {
  const { podcastId } = await flow.subscribeAndIngest(feedUrl)
  flow.data.takeWrites()
  return podcastId!
}

/** The episode with exactly this title, as a search for it finds it. */
async function find(flow: ReturnType<typeof feedHandlers>, podcastId: string, title: string) {
  const { episodes } = await flow.searchEpisodes(podcastId, title)
  return episodes.find((episode) => episode.title === title)!
}

describe('the searchEpisodes query', () => {
  it('finds episodes older than those stored, newest first, and stores none of them', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)

    const result = await flow.searchEpisodes(podcastId, 'episode 1')

    // Episodes 26 to 30 are stored; these are all older.
    expect(result.outcome).toBe('found')
    expect(titlesOf(result.episodes)).toEqual([
      'Episode 19', 'Episode 18', 'Episode 17', 'Episode 16', 'Episode 15', 'Episode 14',
      'Episode 13', 'Episode 12', 'Episode 11', 'Episode 10', 'Episode 1',
    ]) // prettier-ignore
    expect(result.more).toBe(false)
    expect(flow.data.takeWrites()).toEqual([])
    expect(flow.data.episodesOf(podcastId)).toHaveLength(5)
  })

  it('gives each episode the details a list shows, under the ID it is stored by', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, showUrl)
    const stored = flow.data.episodesOf(podcastId).find((episode) => episode.guid === 'example-show-ep-1')!

    const result = await flow.searchEpisodes(podcastId, 'beginning')

    expect(result.episodes).toEqual([
      {
        id: stored.id,
        podcastId,
        title: 'Episode 1: The Beginning',
        publishedAt: '2026-11-03T08:00:00.000Z',
        durationSeconds: 2700,
        enclosureUrl: 'https://cdn.example.com/show/ep1.mp3',
      },
    ])
  })

  it('matches every word, in any order, at the start of a word of the title or the show notes, whatever the case or accents', async () => {
    fakeHttp({
      [showUrl]: feed(
        item(4, 'Café Society', 'With <a href="https://example.com/guest">Zoë Quinn</a>') +
          item(3, 'On Society', 'A cafe is mentioned once.') +
          item(2, 'Society Pages') +
          item(1, 'Something Else', 'It’s the listener’s choice'),
      ),
    })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, showUrl)
    const search = async (term: string) => titlesOf((await flow.searchEpisodes(podcastId, term)).episodes)

    expect(await search('society cafe')).toEqual(['Café Society', 'On Society'])
    expect(await search('ZOE')).toEqual(['Café Society'])
    // A word is matched from its start: "soc" begins "Society", "ages" doesn't begin "Pages".
    expect(await search('soc pag')).toEqual(['Society Pages'])
    expect(await search('ages')).toEqual([])
    // With or without the apostrophe, straight or curly.
    expect(await search("it's")).toEqual(['Something Else'])
    expect(await search('listeners')).toEqual(['Something Else'])
    // Not the notes' markup: tag names and link addresses.
    expect(await search('href')).toEqual([])
    expect(await search('guest')).toEqual([])
    expect(await search('nothing like it')).toEqual([])
  })

  it('returns the newest 50 of more matches, and says there are more', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(120) })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, longUrl)

    const result = await flow.searchEpisodes(podcastId, 'episode')

    expect(result.episodes).toHaveLength(50)
    expect(result.episodes[0].title).toBe('Episode 120')
    expect(result.episodes[49].title).toBe('Episode 71')
    expect(result.more).toBe(true)
  })

  it('fetches the feed in full each time, whatever version was last seen', async () => {
    fakeHttp({ [showUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, showUrl)

    const result = await flow.searchEpisodes(podcastId, 'sequel')

    expect(titlesOf(result.episodes)).toEqual(['Episode 2: The Sequel'])
  })

  it('asks for nothing when the search has no words', async () => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, showUrl)
    const http = fakeHttp({ [showUrl]: fixture('show.xml') })

    expect(await flow.searchEpisodes(podcastId, '   ')).toEqual({ outcome: 'found', episodes: [], more: false })
    expect(http.requested).toEqual([])
  })

  it.each([
    ['can’t be reached', {}],
    ['is no longer a feed', { [showUrl]: '<html></html>' }],
  ])('says the feed is unavailable when it %s', async (_case, responses) => {
    fakeHttp({ [showUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    const podcastId = await subscribedTo(flow, showUrl)
    fakeHttp(responses)

    expect(await flow.searchEpisodes(podcastId, 'sequel')).toEqual({ outcome: 'feedUnavailable', episodes: [], more: false })
  })

  it('says the feed is unavailable for a podcast not in the library', async () => {
    const flow = feedHandlers()

    expect(await flow.searchEpisodes('no-such-podcast', 'sequel')).toEqual({
      outcome: 'feedUnavailable',
      episodes: [],
      more: false,
    })
  })
})

describe('the keepEpisode mutation', () => {
  it('stores an older episode found by a search, show notes included, and nothing else', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30).replace('<title>Episode 7</title>', '<title>Episode 7</title><description>Seven’s notes</description>') })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 7')

    const result = await flow.keepEpisode(podcastId, found.id)

    expect(result).toEqual({ outcome: 'kept' })
    expect(flow.data.takeWrites()).toEqual([`createEpisode ${found.id}`])
    expect(flow.data.episodesOf(podcastId)).toHaveLength(6)
    expect(flow.data.episodesOf(podcastId).find((episode) => episode.id === found.id)).toEqual({
      id: found.id,
      podcastId,
      guid: 'long-7',
      title: 'Episode 7',
      publishedAt: '2020-01-07T00:00:00.000Z',
      durationSeconds: null,
      enclosureUrl: 'https://cdn.example.com/long/7.mp3',
      enclosureType: 'audio/mpeg',
      showNotes: 'Seven’s notes',
    })
  })

  it('writes nothing when the episode is already stored and unchanged', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 7')
    await flow.keepEpisode(podcastId, found.id)
    flow.data.takeWrites()

    expect(await flow.keepEpisode(podcastId, found.id)).toEqual({ outcome: 'kept' })
    expect(flow.data.takeWrites()).toEqual([])
  })

  it('leaves a kept episode in place through later refreshes', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 7')
    await flow.keepEpisode(podcastId, found.id)
    fakeHttp({ [longUrl]: feedWithEpisodes(31) })

    await flow.refreshAll()

    expect(titlesOf(flow.data.episodesOf(podcastId))).toContain('Episode 7')
    expect(titlesOf(flow.data.episodesOf(podcastId))).toContain('Episode 31')
  })

  it('is removed with its podcast on unsubscribing', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 7')
    await flow.keepEpisode(podcastId, found.id)

    await flow.unsubscribe(podcastId)

    expect(flow.data.episodesOf(podcastId)).toEqual([])
  })

  it('says so when the feed no longer lists the episode, or the podcast is gone', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 30')
    fakeHttp({ [longUrl]: feedWithEpisodes(29) })

    expect(await flow.keepEpisode(podcastId, found.id)).toEqual({ outcome: 'notFound' })
    expect(await flow.keepEpisode('no-such-podcast', found.id)).toEqual({ outcome: 'notFound' })
  })

  it('says the feed is unavailable when it can’t be fetched, and stores nothing', async () => {
    fakeHttp({ [longUrl]: feedWithEpisodes(30) })
    const flow = feedHandlers({ episodeLimit: 5 })
    const podcastId = await subscribedTo(flow, longUrl)
    const found = await find(flow, podcastId, 'Episode 7')
    fakeHttp({})

    expect(await flow.keepEpisode(podcastId, found.id)).toEqual({ outcome: 'feedUnavailable' })
    expect(flow.data.takeWrites()).toEqual([])
  })
})

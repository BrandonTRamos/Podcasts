import { describe, expect, it } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

/** Apple's chart of the top history podcasts, and of the top podcasts over all. */
const historyChart = 'https://itunes.apple.com/us/rss/toppodcasts/limit=50/genre=1487/json'
const overallChart = 'https://itunes.apple.com/us/rss/toppodcasts/limit=50/json'
/** The lookup of the podcasts the fixture chart names, which gives their feeds. */
const lookup = 'https://itunes.apple.com/lookup?id=261654474%2C1111111111%2C2222222222%2C3333333333%2C4444444444'
const history = { [historyChart]: fixture('itunes-chart.json'), [lookup]: fixture('itunes-lookup.json') }

describe('the topPodcasts query', () => {
  it('returns a genre’s chart, most popular first, with title, author, artwork and feed URL', async () => {
    const http = fakeHttp(history)
    const { top } = feedHandlers()

    const result = await top('history')

    expect(http.requested).toEqual([historyChart, lookup])
    expect(result).toEqual({
      outcome: 'found',
      podcasts: [
        {
          title: 'The History of Rome',
          author: 'Mike Duncan',
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/rome/600x600bb.jpg',
          feedUrl: 'https://feeds.example.com/history-of-rome.xml',
          podcastId: null,
        },
        // A show the directory gives no feed for, or no longer knows, can't be subscribed to, so it is left out.
        {
          title: 'Rome Daily',
          author: null,
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/daily/100x100bb.jpg',
          feedUrl: 'https://feeds.example.com/rome-daily.xml',
          podcastId: null,
        },
        // In the chart's order, whatever order the lookup answers in.
        {
          title: 'Rome Gossip',
          author: 'Anon',
          artworkUrl: null,
          feedUrl: 'https://feeds.example.com/rome-gossip.xml',
          podcastId: null,
        },
      ],
    })
  })

  it('returns the chart of all podcasts when no genre is given', async () => {
    const http = fakeHttp({ [overallChart]: fixture('itunes-chart.json'), [lookup]: fixture('itunes-lookup.json') })
    const { top } = feedHandlers()

    const result = await top()

    expect(http.requested).toEqual([overallChart, lookup])
    expect(result.podcasts.map((podcast) => podcast.title)).toEqual(['The History of Rome', 'Rome Daily', 'Rome Gossip'])
  })

  it('marks the podcasts already in the library with their ID', async () => {
    fakeHttp(history)
    const { data, top } = feedHandlers()
    const inLibrary = await data.store.createPodcast({
      feedUrl: 'https://feeds.example.com/rome-daily.xml',
      title: 'Rome Daily',
      author: null,
      artworkUrl: null,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastFetchError: null,
    })

    const result = await top('history')

    expect(result.podcasts.map(({ title, podcastId }) => [title, podcastId])).toEqual([
      ['The History of Rome', null],
      ['Rome Daily', inLibrary.id],
      ['Rome Gossip', null],
    ])
  })

  it('reads a chart from the directory once an hour, checking the library every time', async () => {
    const http = fakeHttp(history)
    const { data, clock, top } = feedHandlers()
    await top('history')

    // Subscribed to since the chart was read.
    http.requests.length = 0
    const podcast = await data.store.createPodcast({
      feedUrl: 'https://feeds.example.com/rome-gossip.xml',
      title: 'Rome Gossip',
      author: 'Anon',
      artworkUrl: null,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastFetchError: null,
    })
    clock.now = new Date('2026-11-14T09:59:00.000Z')
    const again = await top('history')

    expect(http.requested).toEqual([])
    expect(again.podcasts.map(({ title, podcastId }) => [title, podcastId])).toEqual([
      ['The History of Rome', null],
      ['Rome Daily', null],
      ['Rome Gossip', podcast.id],
    ])

    clock.now = new Date('2026-11-14T10:00:00.000Z')
    await top('history')

    expect(http.requested).toEqual([historyChart, lookup])
  })

  it('keeps each genre’s chart apart', async () => {
    const comedyChart = 'https://itunes.apple.com/us/rss/toppodcasts/limit=50/genre=1303/json'
    const comedyLookup = 'https://itunes.apple.com/lookup?id=5555555555'
    const http = fakeHttp({
      ...history,
      // A chart of one podcast has it alone, not in a list.
      [comedyChart]: JSON.stringify({ feed: { entry: { id: { attributes: { 'im:id': '5555555555' } } } } }),
      [comedyLookup]: JSON.stringify({
        results: [{ collectionId: 5555555555, collectionName: 'Laughs', feedUrl: 'https://feeds.example.com/laughs.xml' }],
      }),
    })
    const { top } = feedHandlers()
    await top('history')

    const comedy = await top('comedy')

    expect(http.requested).toEqual([historyChart, lookup, comedyChart, comedyLookup])
    expect(comedy.podcasts.map((podcast) => podcast.title)).toEqual(['Laughs'])
  })

  it('lists a feed the directory gives twice only once', async () => {
    fakeHttp({
      [historyChart]: JSON.stringify({
        feed: { entry: [{ id: { attributes: { 'im:id': '1' } } }, { id: { attributes: { 'im:id': '2' } } }, { id: { attributes: { 'im:id': '1' } } }] },
      }),
      'https://itunes.apple.com/lookup?id=1%2C2': JSON.stringify({
        results: [
          { collectionId: 1, collectionName: 'Twice', feedUrl: 'https://feeds.example.com/twice.xml' },
          { collectionId: 2, collectionName: 'Twice Again', feedUrl: 'HTTPS://feeds.example.com/twice.xml' },
        ],
      }),
    })
    const { top } = feedHandlers()

    const result = await top('history')

    expect(result.podcasts.map((podcast) => podcast.title)).toEqual(['Twice'])
  })

  it('leaves out podcasts whose feed or artwork URL is not http or https', async () => {
    fakeHttp({
      [historyChart]: JSON.stringify({ feed: { entry: [{ id: { attributes: { 'im:id': '1' } } }, { id: { attributes: { 'im:id': '2' } } }] } }),
      'https://itunes.apple.com/lookup?id=1%2C2': JSON.stringify({
        results: [
          { collectionId: 1, collectionName: 'Bad Feed', feedUrl: 'ftp://feeds.example.com/bad.xml' },
          { collectionId: 2, collectionName: 'Bad Art', feedUrl: 'https://feeds.example.com/art.xml', artworkUrl600: 'javascript:alert(1)' },
        ],
      }),
    })
    const { top } = feedHandlers()

    expect(await top('history')).toEqual({
      outcome: 'found',
      podcasts: [
        { title: 'Bad Art', author: null, artworkUrl: null, feedUrl: 'https://feeds.example.com/art.xml', podcastId: null },
      ],
    })
  })

  it('looks up only the podcasts the chart gives a numeric ID for', async () => {
    const http = fakeHttp({
      [historyChart]: JSON.stringify({
        feed: { entry: [{ id: { attributes: { 'im:id': '7&entity=song' } } }, { id: {} }, null, { id: { attributes: { 'im:id': '8' } } }] },
      }),
      'https://itunes.apple.com/lookup?id=8': JSON.stringify({
        results: [{ collectionId: 8, collectionName: 'Eight', feedUrl: 'https://feeds.example.com/eight.xml' }],
      }),
    })
    const { top } = feedHandlers()

    const result = await top('history')

    expect(http.requested).toEqual([historyChart, 'https://itunes.apple.com/lookup?id=8'])
    expect(result.podcasts.map((podcast) => podcast.title)).toEqual(['Eight'])
  })

  it('finds nothing in an empty chart, without looking anything up, and asks for it again next time', async () => {
    const http = fakeHttp({ [historyChart]: '{"feed":{"title":{"label":"iTunes Store: Top Podcasts in History"}}}' })
    const { top } = feedHandlers()

    expect(await top('history')).toEqual({ outcome: 'found', podcasts: [] })
    await top('history')

    expect(http.requested).toEqual([historyChart, historyChart])
  })

  it('finds nothing for a genre it does not know, without asking the directory', async () => {
    const http = fakeHttp({})
    const { top } = feedHandlers()

    expect(await top('constructor' as never)).toEqual({ outcome: 'found', podcasts: [] })
    expect(http.requested).toEqual([])
  })

  it.each([
    ['is unreachable', {}],
    ['answers the chart with an error', { [historyChart]: { status: 503, body: 'Service Unavailable' } }],
    ['answers the chart with something other than a chart', { [historyChart]: '<html>Rate limited</html>' }],
    ['answers the chart with JSON of another shape', { [historyChart]: '{"resultCount":0,"results":[]}' }],
    ['does not answer the lookup', { [historyChart]: fixture('itunes-chart.json') }],
    ['answers the lookup with an error', { [historyChart]: fixture('itunes-chart.json'), [lookup]: { status: 403, body: 'Forbidden' } }],
    [
      'answers the lookup with JSON of another shape',
      { [historyChart]: fixture('itunes-chart.json'), [lookup]: '{"errorMessage":"Invalid value(s) for key(s): [id]"}' },
    ],
  ])('says the directory is unavailable when it %s', async (_case, responses) => {
    fakeHttp(responses)
    const { top } = feedHandlers()

    expect(await top('history')).toEqual({ outcome: 'directoryUnavailable', podcasts: [] })
  })

  it('asks the directory again after it was unavailable', async () => {
    fakeHttp({})
    const { top } = feedHandlers()
    await top('history')

    fakeHttp(history)

    expect((await top('history')).podcasts).toHaveLength(3)
  })
})

import { describe, expect, it } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { subscribeFlow } from '../test/subscribeFlow'

const feedUrl = 'https://feeds.example.com/show.xml'

describe('the background step of subscribing', () => {
  it('adds the podcast with title, author and artwork, and marks the request subscribed', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribeAndIngest } = subscribeFlow()

    const request = await subscribeAndIngest(feedUrl)

    expect(data.podcasts()).toEqual([
      {
        id: expect.any(String),
        feedUrl,
        title: 'The Example Show',
        author: 'Example Media',
        artworkUrl: 'https://cdn.example.com/show/artwork.jpg',
      },
    ])
    expect(request).toMatchObject({ status: 'subscribed', podcastId: data.podcasts()[0].id })
  })

  it('stores each episode with title, date, duration, audio and show notes', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribeAndIngest } = subscribeFlow()

    const { podcastId } = await subscribeAndIngest(feedUrl)

    expect(sortByTitle(data.episodesOf(podcastId!))).toEqual([
      {
        id: expect.any(String),
        podcastId,
        guid: 'example-show-ep-1',
        title: 'Episode 1: The Beginning',
        publishedAt: '2026-11-03T08:00:00.000Z',
        durationSeconds: 2700,
        enclosureUrl: 'https://cdn.example.com/show/ep1.mp3',
        enclosureType: 'audio/mpeg',
        showNotes: 'Notes for episode 1.',
      },
      {
        id: expect.any(String),
        podcastId,
        guid: 'example-show-ep-2',
        title: 'Episode 2: The Sequel',
        publishedAt: '2026-11-10T08:00:00.000Z',
        durationSeconds: 3723,
        enclosureUrl: 'https://cdn.example.com/show/ep2.mp3',
        enclosureType: 'audio/mpeg',
        showNotes: '<p>Notes for <b>episode 2</b>.</p>',
      },
    ])
  })

  it.each([
    ['a host that cannot be reached', {}, 'unreachable'],
    ['a server error', { [feedUrl]: { status: 500, body: 'oops' } }, 'unreachable'],
    ['a missing page', { [feedUrl]: { status: 404, body: 'Not found' } }, 'unreachable'],
    ['a web page', { [feedUrl]: '<!doctype html><html><head><title>Hi</title></head><body><p>Hi</p></body></html>' }, 'notAFeed'],
    ['XML that is not RSS', { [feedUrl]: '<?xml version="1.0"?><note><to>you</to></note>' }, 'notAFeed'],
    ['plain text', { [feedUrl]: 'hello' }, 'notAFeed'],
    ['an empty body', { [feedUrl]: '' }, 'notAFeed'],
  ] as const)('marks the request failed for %s and leaves nothing in the library', async (_case, responses, status) => {
    fakeHttp(responses)
    const { data, subscribeAndIngest } = subscribeFlow()

    expect(await subscribeAndIngest(feedUrl)).toMatchObject({ status, podcastId: null })
    expect(data.podcasts()).toEqual([])
  })

  it('marks the request failed and leaves nothing in the library when the data store fails', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe, runBackground } = subscribeFlow()
    data.store.createPodcast = async () => {
      throw new Error('Throttled')
    }
    const { requestId } = await subscribe(feedUrl)

    await expect(runBackground()).rejects.toThrow()

    expect(data.request(requestId!)).toMatchObject({ status: 'failed' })
    expect(data.podcasts()).toEqual([])
  })

  it('adds one podcast when two requests for the same feed are pending at once', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe, runBackground } = subscribeFlow()
    const first = await subscribe(feedUrl)
    const second = await subscribe(feedUrl)

    await runBackground()

    expect(data.podcasts()).toHaveLength(1)
    expect(data.request(first.requestId!)).toMatchObject({ status: 'subscribed' })
    expect(data.request(second.requestId!)).toMatchObject({
      status: 'alreadySubscribed',
      podcastId: data.podcasts()[0].id,
    })
  })
})

describe('ingesting the same feed twice', () => {
  it('creates no duplicates when the stream delivers a request again', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, ingest, subscribe } = subscribeFlow()
    await subscribe(feedUrl)
    const event = data.takeStreamEvent()

    await ingest(event)
    await ingest(event)

    expect(data.podcasts()).toHaveLength(1)
    expect(data.episodesOf(data.podcasts()[0].id)).toHaveLength(2)
  })

  it('finishes the episodes, without duplicates, when retried after failing part-way', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, ingest, subscribe } = subscribeFlow()
    await subscribe(feedUrl)
    const event = data.takeStreamEvent()
    const createEpisode = data.store.createEpisode
    let created = 0
    data.store.createEpisode = async (episode) => {
      if (++created === 2) throw new Error('Throttled')
      await createEpisode(episode)
    }

    await expect(ingest(event)).rejects.toThrow()
    await ingest(event)

    const titles = data.episodesOf(data.podcasts()[0].id).map((episode) => episode.title)
    expect(titles.sort()).toEqual(['Episode 1: The Beginning', 'Episode 2: The Sequel'])
  })
})

describe('ingesting feeds as they are found in the wild', () => {
  it('ingests missing durations and GUIDs, the iTunes namespace, unknown date formats and odd markup', async () => {
    fakeHttp({ [feedUrl]: fixture('messy.xml') })
    const { data, subscribeAndIngest } = subscribeFlow()

    const { podcastId } = await subscribeAndIngest(feedUrl)

    expect(data.podcasts()[0]).toMatchObject({
      title: 'Messy & Co.',
      author: 'Jane Doe',
      artworkUrl: 'https://cdn.example.com/messy/cover.png',
    })
    const episodes = sortByTitle(data.episodesOf(podcastId!)).map(
      ({ guid, title, publishedAt, durationSeconds, enclosureUrl, enclosureType }) => ({
        guid,
        title,
        publishedAt,
        durationSeconds,
        enclosureUrl,
        enclosureType,
      }),
    )
    expect(episodes).toEqual([
      {
        guid: 'https://cdn.example.com/messy/no-guid.mp3',
        title: 'No GUID, no duration',
        publishedAt: '2026-11-04T15:30:00.000Z',
        durationSeconds: null,
        enclosureUrl: 'https://cdn.example.com/messy/no-guid.mp3',
        enclosureType: 'audio/mpeg',
      },
      {
        guid: 'messy-3',
        title: 'Unreadable date and duration',
        publishedAt: null,
        durationSeconds: null,
        enclosureUrl: 'https://cdn.example.com/messy/3.m4a',
        enclosureType: null,
      },
      {
        guid: 'messy-untitled',
        title: 'Untitled episode',
        publishedAt: null,
        durationSeconds: null,
        enclosureUrl: 'https://cdn.example.com/messy/untitled.mp3',
        enclosureType: 'audio/mpeg',
      },
      {
        guid: 'https://www.example.com/messy/2',
        title: 'Wrong weekday and an unknown zone',
        publishedAt: '2026-11-06T10:00:00.000Z',
        durationSeconds: 2730,
        enclosureUrl: 'https://cdn.example.com/messy/2.mp3',
        enclosureType: 'audio/mpeg',
      },
    ])
  })
})

describe('the first-ingest cap', () => {
  it('ingests only the most recent 100 episodes of a feed with thousands by default', async () => {
    fakeHttp({ [feedUrl]: feedWithEpisodes(3000) })
    const { data, subscribeAndIngest } = subscribeFlow()

    const { podcastId } = await subscribeAndIngest(feedUrl)

    const titles = data.episodesOf(podcastId!).map((episode) => episode.title)
    expect(titles).toHaveLength(100)
    expect(titles).toContain('Episode 3000')
    expect(titles).toContain('Episode 2901')
    expect(titles).not.toContain('Episode 2900')
  })

  it('takes a configured cap', async () => {
    fakeHttp({ [feedUrl]: feedWithEpisodes(20) })
    const { data, subscribeAndIngest } = subscribeFlow({ episodeLimit: 3 })

    const { podcastId } = await subscribeAndIngest(feedUrl)

    expect(data.episodesOf(podcastId!).map((episode) => episode.title).sort()).toEqual([
      'Episode 18',
      'Episode 19',
      'Episode 20',
    ])
  })
})

/** A feed listing episodes 1..count oldest first (as some feeds do), one day apart. */
function feedWithEpisodes(count: number): string {
  const items = Array.from({ length: count }, (_, index) => {
    const number = index + 1
    const date = new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toUTCString()
    return `<item><title>Episode ${number}</title><guid>long-${number}</guid><pubDate>${date}</pubDate>
      <enclosure url="https://cdn.example.com/long/${number}.mp3" type="audio/mpeg"/></item>`
  })
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Long Show</title>${items.join('')}</channel></rss>`
}

function sortByTitle<T extends { title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.title.localeCompare(b.title))
}

import { describe, expect, it } from 'vitest'
import { fakeFeedStore, fakeHttp, fixture } from '../test/fakes'
import { createRefreshPodcastHandler } from './refreshPodcast'
import { createSubscribeHandler } from './subscribe'

const feedUrl = 'https://feeds.example.com/show.xml'

/** Subscribes the way the client does, then runs the background refreshes subscribing requested. */
function setup({ episodeLimit = 100 } = {}) {
  const data = fakeFeedStore()
  const subscribe = createSubscribeHandler({ store: data.store })
  const refresh = createRefreshPodcastHandler({ store: data.store, episodeLimit })

  async function runRequestedRefreshes() {
    for (const podcastId of data.takeRefreshRequests()) await refresh({ arguments: { podcastId } })
  }

  async function subscribeAndIngest(url = feedUrl) {
    const { podcastId } = await subscribe({ arguments: { feedUrl: url } })
    await runRequestedRefreshes()
    return podcastId!
  }

  return { data, refresh, subscribeAndIngest }
}

describe('ingesting episodes after subscribing', () => {
  it('stores each episode with title, date, duration, audio and show notes', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribeAndIngest } = setup()

    const podcastId = await subscribeAndIngest()

    expect(sortByTitle(data.episodesOf(podcastId))).toEqual([
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
    expect(data.podcasts()[0]).toMatchObject({ lastFetchedAt: expect.any(String), lastFetchError: null })
  })

  it('creates no duplicate episodes when the same feed is ingested twice', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, refresh, subscribeAndIngest } = setup()
    const podcastId = await subscribeAndIngest()
    const firstIngest = data.episodesOf(podcastId)

    await refresh({ arguments: { podcastId } })

    expect(data.episodesOf(podcastId)).toEqual(firstIngest)
  })
})

describe('a refresh that fails', () => {
  it.each([
    ['unreachable', undefined, 'The feed could not be reached.'],
    ['no longer a feed', '<html><body>Gone</body></html>', 'The feed is no longer a valid podcast feed.'],
  ])('records that the feed is %s, keeping the episodes already ingested', async (_case, laterBody, message) => {
    let body: string | undefined = fixture('show.xml')
    fakeHttp({ [feedUrl]: () => (body === undefined ? { status: 503 } : body) })
    const { data, refresh, subscribeAndIngest } = setup()
    const podcastId = await subscribeAndIngest()
    const { lastFetchedAt } = data.podcasts()[0]

    body = laterBody
    await refresh({ arguments: { podcastId } })

    expect(data.episodesOf(podcastId)).toHaveLength(2)
    expect(data.podcasts()[0]).toMatchObject({ lastFetchError: message, lastFetchedAt })
  })

  it('does nothing for a podcast that no longer exists', async () => {
    const http = fakeHttp({})
    const { data, refresh } = setup()

    await refresh({ arguments: { podcastId: 'gone' } })

    expect(http.requested).toEqual([])
    expect(data.podcasts()).toEqual([])
  })
})

describe('ingesting feeds as they are found in the wild', () => {
  it('ingests missing durations and GUIDs, unknown date formats and odd markup', async () => {
    fakeHttp({ [feedUrl]: fixture('messy.xml') })
    const { data, subscribeAndIngest } = setup()

    const podcastId = await subscribeAndIngest()

    expect(data.podcasts()[0]).toMatchObject({
      title: 'Messy & Co.',
      author: 'Jane Doe',
      artworkUrl: 'https://cdn.example.com/messy/cover.png',
    })
    const episodes = sortByTitle(data.episodesOf(podcastId)).map(
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

describe('the episode cap', () => {
  it('ingests only the most recent 100 episodes of a feed with thousands by default', async () => {
    fakeHttp({ [feedUrl]: feedWithEpisodes(3000) })
    const { data, subscribeAndIngest } = setup()

    const podcastId = await subscribeAndIngest()

    const titles = data.episodesOf(podcastId).map((episode) => episode.title)
    expect(titles).toHaveLength(100)
    expect(titles).toContain('Episode 3000')
    expect(titles).toContain('Episode 2901')
    expect(titles).not.toContain('Episode 2900')
  })

  it('takes a configured cap', async () => {
    fakeHttp({ [feedUrl]: feedWithEpisodes(20) })
    const { data, subscribeAndIngest } = setup({ episodeLimit: 3 })

    const podcastId = await subscribeAndIngest()

    expect(data.episodesOf(podcastId).map((episode) => episode.title).sort()).toEqual([
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

import { describe, expect, it } from 'vitest'
import { fakeFeedStore, fakeHttp, fixture } from '../test/fakes'
import { createSubscribeHandler } from './subscribe'

const feedUrl = 'https://feeds.example.com/show.xml'

function setup() {
  const data = fakeFeedStore()
  const subscribe = createSubscribeHandler({ store: data.store })
  return { data, subscribe: (url: string) => subscribe({ arguments: { feedUrl: url } }) }
}

describe('subscribe by feed URL', () => {
  it('adds the podcast with title, author and artwork, and returns before any episode is ingested', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe } = setup()

    const result = await subscribe(feedUrl)

    expect(result).toEqual({ outcome: 'subscribed', podcastId: expect.any(String) })
    expect(data.podcasts()).toEqual([
      expect.objectContaining({
        id: result.podcastId,
        feedUrl,
        title: 'The Example Show',
        author: 'Example Media',
        artworkUrl: 'https://cdn.example.com/show/artwork.jpg',
      }),
    ])
    expect(data.episodesOf(result.podcastId!)).toEqual([])
    expect(data.takeRefreshRequests()).toEqual([result.podcastId])
  })

  it.each(['ftp://feeds.example.com/show.xml', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', ''])(
    'accepts only http and https URLs, refusing %j without fetching it',
    async (url) => {
      const http = fakeHttp({})
      const { data, subscribe } = setup()

      expect(await subscribe(url)).toEqual({ outcome: 'invalidUrl', podcastId: null })
      expect(http.requested).toEqual([])
      expect(data.podcasts()).toEqual([])
    },
  )

  it.each([
    ['a host that cannot be reached', {}, 'unreachable'],
    ['a server error', { [feedUrl]: { status: 500, body: 'oops' } }, 'unreachable'],
    ['a missing page', { [feedUrl]: { status: 404, body: 'Not found' } }, 'unreachable'],
    ['a web page', { [feedUrl]: '<!doctype html><html><head><title>Hi</title></head><body><p>Hi</p></body></html>' }, 'notAFeed'],
    ['XML that is not RSS', { [feedUrl]: '<?xml version="1.0"?><note><to>you</to></note>' }, 'notAFeed'],
    ['plain text', { [feedUrl]: 'hello' }, 'notAFeed'],
    ['an empty body', { [feedUrl]: '' }, 'notAFeed'],
  ] as const)('reports %s and leaves nothing in the library', async (_case, responses, outcome) => {
    fakeHttp(responses)
    const { data, subscribe } = setup()

    expect(await subscribe(feedUrl)).toEqual({ outcome, podcastId: null })
    expect(data.podcasts()).toEqual([])
    expect(data.takeRefreshRequests()).toEqual([])
  })

  it('says when the feed is already in the library, and creates no duplicate', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe } = setup()
    const first = await subscribe(feedUrl)
    data.takeRefreshRequests()

    const again = await subscribe(` HTTPS://Feeds.Example.com/show.xml `)

    expect(again).toEqual({ outcome: 'alreadySubscribed', podcastId: first.podcastId })
    expect(data.podcasts()).toHaveLength(1)
    expect(data.takeRefreshRequests()).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { subscribeFlow } from '../test/subscribeFlow'

const feedUrl = 'https://feeds.example.com/show.xml'

describe('the subscribe mutation', () => {
  it('returns a pending request at once, before the feed is fetched or anything is added', async () => {
    const http = fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe } = subscribeFlow()

    const result = await subscribe(feedUrl)

    expect(result).toEqual({ outcome: 'pending', requestId: expect.any(String), podcastId: null })
    expect(data.request(result.requestId!)).toMatchObject({ status: 'pending' })
    expect(http.requested).toEqual([])
    expect(data.podcasts()).toEqual([])
  })

  it.each(['ftp://feeds.example.com/show.xml', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', ''])(
    'accepts only http and https URLs, refusing %j without fetching it',
    async (url) => {
      const http = fakeHttp({})
      const { data, subscribe, runBackground } = subscribeFlow()

      expect(await subscribe(url)).toEqual({ outcome: 'invalidUrl', requestId: null, podcastId: null })
      await runBackground()
      expect(http.requested).toEqual([])
      expect(data.podcasts()).toEqual([])
    },
  )

  it('says when the feed is already in the library, and creates no duplicate', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe, subscribeAndIngest } = subscribeFlow()
    const first = await subscribeAndIngest(feedUrl)

    const again = await subscribe(` HTTPS://Feeds.Example.com/show.xml `)

    expect(again).toEqual({ outcome: 'alreadySubscribed', requestId: null, podcastId: first.podcastId })
    expect(data.takeStreamEvent().Records).toEqual([])
    expect(data.podcasts()).toHaveLength(1)
  })
})

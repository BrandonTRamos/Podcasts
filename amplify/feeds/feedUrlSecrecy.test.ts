import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { subscribeFlow } from '../test/subscribeFlow'

// Private feeds carry access tokens in their URLs, so a feed URL is a secret.
const secret = 's3cret-token'
const feedUrl = `https://feeds.example.com/private.xml?token=${secret}`

let logged: string[]

beforeEach(() => {
  logged = []
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg))).join(' '))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('feed URLs are not written to logs', () => {
  it('when subscribing, ingesting and re-subscribing', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe, subscribeAndIngest } = subscribeFlow()

    const { podcastId } = await subscribeAndIngest(feedUrl)
    await subscribe(feedUrl)

    expect(data.episodesOf(podcastId!)).toHaveLength(2)
    expect(logged.join('\n')).not.toContain(secret)
  })

  it.each([
    ['unreachable', {}],
    ['not a feed', { [feedUrl]: '<html></html>' }],
  ])('when the feed is %s', async (_case, responses) => {
    fakeHttp(responses)
    const { subscribeAndIngest } = subscribeFlow()

    await subscribeAndIngest(feedUrl)

    expect(logged.join('\n')).not.toContain(secret)
  })

  it('when the data store fails with the URL in its error, which is not passed on either', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const leakyFailure = async (record: unknown): Promise<never> => {
      throw new Error(`Write failed for ${JSON.stringify(record)} (${feedUrl}, ${encodeURIComponent(feedUrl)})`)
    }
    const subscribing = subscribeFlow()
    subscribing.data.store.createSubscribeRequest = leakyFailure
    const ingesting = subscribeFlow()
    ingesting.data.store.createPodcast = leakyFailure
    await ingesting.subscribe(feedUrl)

    const failures = await Promise.allSettled([subscribing.subscribe(feedUrl), ingesting.runBackground()])

    for (const failure of failures) {
      expect(failure.status).toBe('rejected')
      const error = (failure as PromiseRejectedResult).reason as Error
      expect(`${error.message}\n${error.stack}`).not.toContain(secret)
    }
    expect(logged.join('\n')).not.toContain(secret)
  })
})

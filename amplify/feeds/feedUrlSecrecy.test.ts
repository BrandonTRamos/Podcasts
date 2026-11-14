import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeFeedStore, fakeHttp, fixture } from '../test/fakes'
import { createRefreshPodcastHandler } from './refreshPodcast'
import { createSubscribeHandler } from './subscribe'

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

function setup() {
  const data = fakeFeedStore()
  return {
    data,
    subscribe: createSubscribeHandler({ store: data.store }),
    refresh: createRefreshPodcastHandler({ store: data.store, episodeLimit: 100 }),
  }
}

describe('feed URLs are not written to logs', () => {
  it('when subscribing, re-subscribing and ingesting', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const { data, subscribe, refresh } = setup()

    const { podcastId } = await subscribe({ arguments: { feedUrl } })
    await refresh({ arguments: { podcastId: podcastId! } })
    await subscribe({ arguments: { feedUrl } })

    expect(data.episodesOf(podcastId!)).toHaveLength(2)
    expect(logged.join('\n')).not.toContain(secret)
  })

  it.each([
    ['unreachable', {}],
    ['not a feed', { [feedUrl]: '<html></html>' }],
  ])('when the feed is %s', async (_case, responses) => {
    fakeHttp(responses)
    const { subscribe } = setup()

    await subscribe({ arguments: { feedUrl } })

    expect(logged.join('\n')).not.toContain(secret)
  })

  it('when the data store fails with the URL in its error, which is not passed on either', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const leakyFailure = async (record: object): Promise<never> => {
      throw new Error(`Write failed for ${JSON.stringify(record)} (${feedUrl}, ${encodeURIComponent(feedUrl)})`)
    }
    const subscribing = setup()
    subscribing.data.store.createPodcast = leakyFailure
    const refreshing = setup()
    const { podcastId } = await refreshing.subscribe({ arguments: { feedUrl } })
    refreshing.data.store.createEpisode = leakyFailure

    const failures = await Promise.allSettled([
      subscribing.subscribe({ arguments: { feedUrl } }),
      refreshing.refresh({ arguments: { podcastId: podcastId! } }),
    ])

    for (const failure of failures) {
      expect(failure.status).toBe('rejected')
      const error = (failure as PromiseRejectedResult).reason as Error
      expect(`${error.message}\n${error.stack}`).not.toContain(secret)
    }
    expect(logged.join('\n')).not.toContain(secret)
  })
})

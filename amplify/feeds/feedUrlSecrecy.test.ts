import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

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
    const { data, subscribe, subscribeAndIngest } = feedHandlers()

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
    const { subscribeAndIngest } = feedHandlers()

    await subscribeAndIngest(feedUrl)

    expect(logged.join('\n')).not.toContain(secret)
  })

  it('when refreshing, whether the feed changed, is unchanged or fails', async () => {
    fakeHttp({ [feedUrl]: { body: fixture('show.xml'), headers: { ETag: '"v1"' } } })
    const flow = feedHandlers()
    const { podcastId } = await flow.subscribeAndIngest(feedUrl)

    await flow.refreshAll()
    fakeHttp({ [feedUrl]: { body: fixture('show.xml').replace('ep2.mp3', 'ep2b.mp3'), headers: { ETag: '"v2"' } } })
    await flow.refreshPodcast(podcastId!)
    fakeHttp({})
    await flow.refreshAll()

    expect(logged.join('\n')).not.toContain(secret)
  })

  it('when storing a refreshed feed fails with the URL in its error, which is not passed on either', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const flow = feedHandlers()
    await flow.subscribeAndIngest(feedUrl)
    flow.data.store.updatePodcast = async (id, changes) => {
      throw new Error(`Write failed for ${id} ${JSON.stringify(changes)} (${feedUrl})`)
    }
    flow.data.store.getEpisode = async () => {
      throw new Error(`Read failed (${encodeURIComponent(feedUrl)})`)
    }

    const error = await flow.refreshAll().then(
      () => null,
      (reason: Error) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(`${error!.message}\n${error!.stack}`).not.toContain(secret)
    expect(logged.join('\n')).not.toContain(secret)
  })

  it('when the data store fails with the URL in its error, which is not passed on either', async () => {
    fakeHttp({ [feedUrl]: fixture('show.xml') })
    const leakyFailure = async (record: unknown): Promise<never> => {
      throw new Error(`Write failed for ${JSON.stringify(record)} (${feedUrl}, ${encodeURIComponent(feedUrl)})`)
    }
    const subscribing = feedHandlers()
    subscribing.data.store.createSubscribeRequest = leakyFailure
    const ingesting = feedHandlers()
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

  it('when searching the directory fails in the data store with the URL in its error, which is not passed on either', async () => {
    const search = 'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=private'
    fakeHttp({ [search]: JSON.stringify({ results: [{ collectionName: 'Private', feedUrl: 'https://feeds.example.com/p.xml' }] }) })
    const flow = feedHandlers()
    flow.data.store.listPodcasts = async () => {
      throw new Error(`List failed (${feedUrl})`)
    }

    const error = await flow.search('private').then(
      () => null,
      (reason: Error) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(`${error!.message}\n${error!.stack}`).not.toContain(secret)
    expect(logged.join('\n')).not.toContain(secret)
  })
})

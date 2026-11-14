import { afterEach, describe, expect, it, vi } from 'vitest'
import { feedWithEpisodes, fakeHttp, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

const feedUrl = 'https://feeds.example.com/show.xml'
const otherUrl = 'https://feeds.example.com/other.xml'

/** Two podcasts in the library, each with episodes, some of them started or queued. */
async function libraryOfTwo() {
  fakeHttp({ [feedUrl]: fixture('show.xml'), [otherUrl]: feedWithEpisodes(3) })
  const flow = feedHandlers()
  const { podcastId } = await flow.subscribeAndIngest(feedUrl)
  const { podcastId: otherId } = await flow.subscribeAndIngest(otherUrl)
  const [episode] = flow.data.episodesOf(podcastId!)
  const [otherEpisode] = flow.data.episodesOf(otherId!)
  flow.data.seedEpisodeState({ id: episode.id, podcastId: podcastId!, queueOrder: 1 })
  flow.data.seedEpisodeState({ id: otherEpisode.id, podcastId: otherId!, queueOrder: 2 })
  return { ...flow, podcastId: podcastId!, otherId: otherId!, episode, otherEpisode }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the unsubscribe mutation', () => {
  it('removes the podcast, its episodes and their listening state, queue places included', async () => {
    const { data, unsubscribe, podcastId } = await libraryOfTwo()
    expect(data.episodesOf(podcastId)).toHaveLength(2)

    expect(await unsubscribe(podcastId)).toBe(true)

    expect(data.podcast(podcastId)).toBeUndefined()
    expect(data.episodesOf(podcastId)).toEqual([])
    expect(data.episodeStates().filter((state) => state.podcastId === podcastId)).toEqual([])
  })

  it('leaves other podcasts, their episodes and listening state alone', async () => {
    const { data, unsubscribe, podcastId, otherId, otherEpisode } = await libraryOfTwo()

    await unsubscribe(podcastId)

    expect(data.podcasts().map((podcast) => podcast.id)).toEqual([otherId])
    expect(data.episodesOf(otherId)).toHaveLength(3)
    expect(data.episodeStates()).toEqual([{ id: otherEpisode.id, podcastId: otherId, queueOrder: 2 }])
  })

  it('removes episodes nobody has listened to, and podcasts with no episodes', async () => {
    fakeHttp({ [feedUrl]: feedWithEpisodes(250) })
    const { data, subscribeAndIngest, unsubscribe } = feedHandlers()
    const { podcastId } = await subscribeAndIngest(feedUrl)
    expect(data.episodesOf(podcastId!)).toHaveLength(100)

    await unsubscribe(podcastId!)

    expect(data.podcasts()).toEqual([])
    expect(data.episodesOf(podcastId!)).toEqual([])
  })

  it('lets the feed be subscribed to again afterwards', async () => {
    const { data, subscribe, unsubscribe, podcastId } = await libraryOfTwo()

    await unsubscribe(podcastId)

    expect(await subscribe(feedUrl)).toMatchObject({ outcome: 'pending' })
    expect(data.podcasts()).toHaveLength(1)
  })

  it('succeeds for a podcast already removed, as when another device got there first', async () => {
    const { data, unsubscribe, podcastId } = await libraryOfTwo()
    await unsubscribe(podcastId)

    expect(await unsubscribe(podcastId)).toBe(true)
    expect(data.podcasts()).toHaveLength(1)
  })

  it('also removes listening state saved while it ran, as by another device still playing an episode', async () => {
    const { data, unsubscribe, podcastId, episode } = await libraryOfTwo()
    data.whenDeleting(podcastId, () => data.seedEpisodeState({ id: episode.id, podcastId }))

    await unsubscribe(podcastId)

    expect(data.episodeStates().filter((state) => state.podcastId === podcastId)).toEqual([])
  })

  it('reports success once the podcast is gone, even if clearing up after it fails', async () => {
    const { data, unsubscribe, podcastId, episode } = await libraryOfTwo()
    data.whenDeleting(podcastId, () => {
      data.seedEpisodeState({ id: episode.id, podcastId })
      data.failNextDelete(episode.id)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await unsubscribe(podcastId)).toBe(true)
    expect(data.podcast(podcastId)).toBeUndefined()
  })

  it('keeps the podcast in the library if it fails part-way, so trying again finishes the job', async () => {
    const { data, unsubscribe, podcastId } = await libraryOfTwo()
    const [, secondEpisode] = data.episodesOf(podcastId)
    data.failNextDelete(secondEpisode.id)

    await expect(unsubscribe(podcastId)).rejects.toThrow()
    expect(data.podcast(podcastId)).toBeDefined()

    await unsubscribe(podcastId)
    expect(data.podcast(podcastId)).toBeUndefined()
    expect(data.episodesOf(podcastId)).toEqual([])
  })
})

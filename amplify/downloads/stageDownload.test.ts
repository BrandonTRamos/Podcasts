import { describe, expect, it } from 'vitest'
import { byteRange, fakeAudioHost, fakeStagingBucket, fakeStagingStore } from '../test/stagingFakes'
import { createStageDownloadHandler, LINK_LIFETIME_SECONDS } from './stageDownload'

const enclosureUrl = 'https://media.example.com/show/ep1.mp3'
const now = new Date('2026-11-14T09:00:00.000Z')
const HOUR = 60 * 60 * 1000

function setUp({ keepBytes = true } = {}) {
  const data = fakeStagingStore()
  data.seedEpisode('episode-1', enclosureUrl)
  const clock = { now }
  const storage = fakeStagingBucket({ keepBytes, now: () => clock.now })
  const stage = createStageDownloadHandler({ store: data.store, bucket: storage.bucket, now: () => clock.now })
  return {
    data,
    storage,
    clock,
    /** The `stageDownload` mutation, as AppSync invokes its handler asynchronously. */
    stage: (requestId: string, episodeId = 'episode-1') => stage({ arguments: { requestId, episodeId } }),
    /** The hourly run, as EventBridge Scheduler invokes it. */
    sweep: () => stage({}),
  }
}

describe('staging a download', () => {
  it('copies the episode’s file to the private bucket and records a short-lived link to it', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 300_000)
    const { data, storage, stage } = setUp()

    await stage('request-1')

    const staging = data.staging('request-1')!
    expect(data.statusesOf('request-1')).toEqual(['preparing', 'ready'])
    expect(staging).toMatchObject({ episodeId: 'episode-1', status: 'ready' })
    expect(storage.object(staging.objectKey!)).toEqual({
      bytes: byteRange(0, 300_000),
      size: 300_000,
      contentType: 'audio/mpeg',
    })
    expect(staging.url).toBe(`https://staging.s3.example.com/${staging.objectKey}?expires-in=${LINK_LIFETIME_SECONDS}`)
    expect(LINK_LIFETIME_SECONDS).toBeLessThanOrEqual(60 * 60)
    expect(staging.urlExpiresAt).toBe(new Date(now.getTime() + LINK_LIFETIME_SECONDS * 1000).toISOString())
  })

  it('gives each request its own copy', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 1000)
    const { data, storage, stage } = setUp()

    await stage('request-1')
    await stage('request-2')

    expect(data.staging('request-1')!.objectKey).not.toBe(data.staging('request-2')!.objectKey)
    expect(storage.keys()).toHaveLength(2)
  })

  it('streams an episode of several hundred megabytes, never holding it whole', async () => {
    const host = fakeAudioHost()
    host.chunkSize = 1024 * 1024
    const size = 400 * 1024 * 1024
    host.serve(enclosureUrl, size)
    const { data, storage, stage } = setUp({ keepBytes: false })
    let stored = 0
    let mostInFlight = 0
    storage.onChunk((length) => {
      stored += length
      mostInFlight = Math.max(mostInFlight, host.sent - stored)
    })

    await stage('request-1')

    expect(data.staging('request-1')!.status).toBe('ready')
    expect(storage.object(data.staging('request-1')!.objectKey!)!.size).toBe(size)
    // What the host has sent but storage has not yet taken stays a few chunks, not the file.
    expect(mostInFlight).toBeLessThanOrEqual(8 * host.chunkSize)
  })

  it.each(['ftp://media.example.com/ep1.mp3', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'fetches only http and https audio URLs, refusing %j',
    async (url) => {
      const host = fakeAudioHost()
      const { data, storage, stage } = setUp()
      data.seedEpisode('episode-2', url)

      await stage('request-1', 'episode-2')

      expect(data.staging('request-1')!.status).toBe('unavailable')
      expect(host.requested).toEqual([])
      expect(storage.keys()).toEqual([])
    },
  )

  it('says the file is unavailable when the episode no longer exists', async () => {
    const host = fakeAudioHost()
    const { data, stage } = setUp()

    await stage('request-1', 'episode-gone')

    expect(data.staging('request-1')).toMatchObject({ episodeId: 'episode-gone', status: 'unavailable' })
    expect(host.requested).toEqual([])
  })

  it('says the file is unavailable when the host won’t send it', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 1000, { status: 404 })
    const { data, storage, stage } = setUp()

    await stage('request-1')

    expect(data.staging('request-1')!.status).toBe('unavailable')
    expect(storage.keys()).toEqual([])
  })

  it('says the file is unavailable when the host can’t be reached', async () => {
    fakeAudioHost()
    const { data, storage, stage } = setUp()
    data.seedEpisode('episode-2', 'https://unreachable.example.com/ep.mp3')

    await stage('request-1', 'episode-2')

    expect(data.staging('request-1')!.status).toBe('unavailable')
    expect(storage.keys()).toEqual([])
  })

  it('keeps no copy when the host stops part way', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 300_000, { sendsOnly: 200_000 })
    const { data, storage, stage } = setUp()

    await stage('request-1')

    expect(data.staging('request-1')!.status).toBe('failed')
    expect(data.staging('request-1')!.url).toBeUndefined()
    expect(storage.keys()).toEqual([])
  })

  it('records the failure when the copy can’t be stored, and lets it be seen', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 300_000)
    const { data, storage, stage } = setUp()
    storage.break()

    await expect(stage('request-1')).rejects.toThrow(/stageDownload failed/)

    expect(data.staging('request-1')!.status).toBe('failed')
    expect(storage.keys()).toEqual([])
  })

  it('never puts the episode’s URL in what it throws', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 300_000)
    const { storage, stage } = setUp()
    storage.break(new Error(`Could not copy ${enclosureUrl}?token=secret`))

    const error = await stage('request-1').catch((caught: unknown) => caught)

    expect(String(error)).not.toContain('media.example.com')
  })
})

describe('deleting temporary copies', () => {
  it('deletes every copy within a day of its making, on the hourly run', async () => {
    const host = fakeAudioHost()
    host.serve(enclosureUrl, 1000)
    const { storage, clock, stage, sweep } = setUp()
    await stage('request-1')
    clock.now = new Date(now.getTime() + 12 * HOUR)
    await stage('request-2')

    for (let hour = 1; hour <= 24; hour++) {
      clock.now = new Date(now.getTime() + hour * HOUR)
      await sweep()
    }

    // Made 24 hours ago: gone. Made 12 hours ago: kept, for downloads still running or to resume.
    expect(storage.keys()).toEqual(['staged/request-2'])
    expect(host.requested).toEqual([enclosureUrl, enclosureUrl])

    clock.now = new Date(now.getTime() + 36 * HOUR)
    await sweep()
    expect(storage.keys()).toEqual([])
  })
})

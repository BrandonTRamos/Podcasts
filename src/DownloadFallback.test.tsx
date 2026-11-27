import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { STAGING_TIMEOUT_MS } from './downloads'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', artworkUrl: 'https://cdn.example.com/show/artwork.jpg' }
const blockedEpisode = {
  title: 'Episode 1: The Beginning',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 2700,
  enclosureUrl: 'https://media.example.com/show/ep1.mp3',
}
/** Where the backend puts the temporary copy: a private, short-lived link. */
const stagedUrl = 'https://tincan-staging.s3.amazonaws.com/staged/request-1?X-Amz-Expires=3600&X-Amz-Signature=abc'
const later = '2099-01-01T00:00:00.000Z'

const file = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)

/**
 * A backend holding one show whose episode is on a host that blocks direct
 * download, and a device to download it to. Once prepared, the copy is
 * readable at `stagedUrl`.
 */
async function setUp() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [episodeId] = data.ingest(podcastId, [blockedEpisode])
  const device = new FakeDevice()
  device.network.host(blockedEpisode.enclosureUrl, file, { cors: false })
  device.network.host(stagedUrl, file)
  const audio = new FakeAudio()
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth: fakeAuth(owner), data, audio, mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { data, device, audio, user, episodeId }
}

function row() {
  const item = screen
    .getAllByRole('listitem')
    .find((li) => within(li).queryByRole('heading', { name: blockedEpisode.title }))
  if (!item) throw new Error('No episode in the list')
  return item
}

/** Waits until the backend has been asked for a copy, and the app is waiting for it. */
async function preparing() {
  return within(row()).findByText(/Preparing download/)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('downloading an episode whose host blocks direct download', () => {
  it('falls back to a temporary copy, showing it being prepared and then the download’s progress', async () => {
    const { data, device, audio, user, episodeId } = await setUp()
    device.network.throttle()

    await chooseAction(user, row(), 'Download')

    expect(await preparing()).toBeInTheDocument()
    expect(data.stagingRequests()).toEqual([episodeId])
    expect(within(row()).queryByText('Downloaded')).not.toBeInTheDocument()

    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: later }))
    device.network.deliver(300)

    expect(await within(row()).findByText('30%')).toBeInTheDocument()
    expect(within(row()).queryByText(/Preparing download/)).not.toBeInTheDocument()
    device.network.unthrottle()
    expect(await within(row()).findByText('Downloaded', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(file)

    await user.click(within(row()).getByRole('button', { name: blockedEpisode.title }))
    expect(device.files.contentsAt(audio.src)).toEqual(file)
  })

  it('resumes an interrupted download from the same copy, without preparing another', async () => {
    const { data, device, user } = await setUp()
    device.network.throttle()
    await chooseAction(user, row(), 'Download')
    await preparing()
    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: later }))
    device.network.deliver(400)
    await within(row()).findByText('40%')

    device.network.dropConnection()
    await within(row()).findByRole('button', { name: 'Resume download' })
    device.network.reconnect()
    device.network.unthrottle()
    const before = device.network.requests.length
    await user.click(within(row()).getByRole('button', { name: 'Resume download' }))

    expect(await within(row()).findByText('Downloaded', {}, { timeout: 3000 })).toBeInTheDocument()
    // Straight to the copy: the host blocking direct download isn't asked again.
    expect(device.network.requests.slice(before).map((request) => request.url)).toEqual([stagedUrl])
    expect(device.files.onlyFile()).toEqual(file)
    expect(data.stagingRequests()).toHaveLength(1)
    expect(device.network.requests.filter((request) => request.url === stagedUrl).at(-1)!.range).toBe('bytes=400-')
  })

  it('quietly prepares a fresh copy when the link to the last one stops working early', async () => {
    const { data, device, user } = await setUp()
    const freshUrl = 'https://tincan-staging.s3.amazonaws.com/staged/request-2?X-Amz-Signature=def'
    device.network.host(freshUrl, file)
    device.network.throttle()
    await chooseAction(user, row(), 'Download')
    await preparing()
    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: later }))
    device.network.deliver(400)
    await within(row()).findByText('40%')
    device.network.dropConnection()
    await within(row()).findByRole('button', { name: 'Resume download' })
    device.network.reconnect()
    device.network.unthrottle()
    device.network.refuse(stagedUrl)

    await user.click(within(row()).getByRole('button', { name: 'Resume download' }))
    await preparing()
    act(() => data.finishStaging({ status: 'ready', url: freshUrl, expiresAt: later }))

    expect(await within(row()).findByText('Downloaded', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(file)
    expect(device.network.requests.filter((request) => request.url === freshUrl).at(-1)!.range).toBe('bytes=400-')
  })

  it('prepares a fresh copy to resume from once the link to the last one has expired', async () => {
    const { data, device, user } = await setUp()
    device.network.throttle()
    await chooseAction(user, row(), 'Download')
    await preparing()
    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: new Date(Date.now() + 1000).toISOString() }))
    device.network.deliver(400)
    await within(row()).findByText('40%')
    device.network.dropConnection()
    await within(row()).findByRole('button', { name: 'Resume download' })
    device.network.reconnect()
    device.network.unthrottle()

    await user.click(within(row()).getByRole('button', { name: 'Resume download' }))
    await preparing()
    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: later }))

    expect(await within(row()).findByText('Downloaded', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(file)
    expect(data.stagingRequests()).toHaveLength(2)
  })

  it('says clearly when the copy can’t be prepared, and lets the listener try again', async () => {
    const { data, user } = await setUp()
    await chooseAction(user, row(), 'Download')
    await preparing()

    act(() => data.finishStaging({ status: 'failed' }))

    expect(await within(row()).findByRole('alert')).toHaveTextContent(/couldn’t be prepared for download/)
    expect(within(row()).queryByText('Downloaded')).not.toBeInTheDocument()
    await user.click(within(row()).getByRole('button', { name: 'Try again' }))
    expect(await preparing()).toBeInTheDocument()
    expect(data.stagingRequests()).toHaveLength(2)
  })

  it('says when the publisher’s host wouldn’t send the file to be copied', async () => {
    const { data, user } = await setUp()
    await chooseAction(user, row(), 'Download')
    await preparing()

    act(() => data.finishStaging({ status: 'unavailable' }))

    expect(await within(row()).findByRole('alert')).toHaveTextContent(/publisher’s host didn’t send the file/)
  })

  it('gives up waiting for a copy that never arrives', async () => {
    const { user } = await setUp()
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    await chooseAction(user, row(), 'Download')
    await preparing()

    act(() => void vi.advanceTimersByTime(STAGING_TIMEOUT_MS))

    expect(await within(row()).findByRole('alert')).toHaveTextContent(/couldn’t be prepared for download/)
  })

  it('counts the download as interrupted when the backend can’t be reached while preparing', async () => {
    const { data, user } = await setUp()
    await chooseAction(user, row(), 'Download')
    await preparing()

    act(() => data.disconnect())

    expect(await within(row()).findByRole('button', { name: 'Resume download' })).toBeInTheDocument()
  })

  it('stops preparing when the listener cancels the download', async () => {
    const { data, device, user } = await setUp()
    await chooseAction(user, row(), 'Download')
    await preparing()

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(screen.getByRole('button', { name: 'Downloads' }))
    const inProgress = await screen.findByRole('list', { name: 'Downloads in progress' })
    expect(within(inProgress).getByText(/Preparing download/)).toBeInTheDocument()
    await user.click(within(inProgress).getByRole('button', { name: 'Cancel download' }))
    act(() => data.finishStaging({ status: 'ready', url: stagedUrl, expiresAt: later }))

    expect(await screen.findByText('Nothing is downloaded to this device.')).toBeInTheDocument()
    expect(device.files.count()).toBe(0)
    expect(device.network.requests.some((request) => request.url === stagedUrl)).toBe(false)
  })
})

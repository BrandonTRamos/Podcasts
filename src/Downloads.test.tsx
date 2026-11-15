import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { STALL_MS } from './downloads'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', artworkUrl: 'https://cdn.example.com/show/artwork.jpg' }
const first = {
  title: 'Episode 1: The Beginning',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 2700,
  enclosureUrl: 'https://media.example.com/show/ep1.mp3',
}
const second = {
  title: 'Episode 2: The Sequel',
  publishedAt: '2026-11-10T08:00:00.000Z',
  durationSeconds: 3723,
  enclosureUrl: 'https://media.example.com/show/ep2.mp3',
}

/** Stand-in audio: a file of this many bytes, each different from its neighbours. */
function audioFile(length: number) {
  return Uint8Array.from({ length }, (_, i) => i % 251)
}

const firstFile = audioFile(1000)

/**
 * A backend holding one show with two episodes, the first of whose files is
 * on a host that allows direct download, and a device to download it to.
 */
async function setUp({ ranges = true }: { ranges?: boolean } = {}) {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  data.ingest(podcastId, [first, second])
  const device = new FakeDevice()
  device.network.host(first.enclosureUrl, firstFile, { ranges })
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  return { data, device, ...(await launch(data, device)) }
}

/** Opens the app, already signed in, at the show's page, as a fresh launch of it on this device would. */
async function launch(data: FakeDataApi, device: FakeDevice) {
  const audio = new FakeAudio()
  const services = { auth: fakeAuth(owner), data, audio, mediaSession: new FakeMediaSession(), device }
  const { unmount } = render(<App services={services} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, user, unmount }
}

/** The episode's entry in the list on screen. */
function row(title: string) {
  const item = screen.getAllByRole('listitem').find((li) => within(li).queryByRole('heading', { name: title }))
  if (!item) throw new Error(`No episode "${title}" in the list`)
  return item
}

function tap(user: ReturnType<typeof userEvent.setup>, title: string) {
  return user.click(within(row(title)).getByRole('button', { name: title }))
}

async function startDownload(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(row(title)).getByRole('button', { name: 'Download' }))
}

/** Waits for the episode to show as downloaded. */
async function downloaded(title: string) {
  return within(row(title)).findByText('Downloaded', {}, { timeout: 3000 })
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
})

describe('downloading an episode', () => {
  it('shows progress while the file arrives, storing it on the device as it comes', async () => {
    const { device, user } = await setUp()
    device.network.throttle()

    await startDownload(user, first.title)
    device.network.deliver(250)

    expect(await within(row(first.title)).findByText('25%')).toBeInTheDocument()
    const progress = within(row(first.title)).getByRole('progressbar', { name: 'Download progress' })
    expect(progress).toHaveAttribute('value', '250')
    expect(progress).toHaveAttribute('max', '1000')
    // What has arrived is already on the device, not held back in memory.
    expect(device.files.onlyFile()).toEqual(firstFile.subarray(0, 250))
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()

    device.network.unthrottle()

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile)
    expect(within(row(first.title)).queryByRole('progressbar', { name: 'Download progress' })).not.toBeInTheDocument()
    expect(within(row(second.title)).queryByText('Downloaded')).not.toBeInTheDocument()
  })

  it('keeps the screen awake while downloading, and lets it sleep once done', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    expect(device.screenKeptOn()).toBe(false)

    await startDownload(user, first.title)

    await waitFor(() => expect(device.screenKeptOn()).toBe(true))
    device.network.unthrottle()
    await downloaded(first.title)
    await waitFor(() => expect(device.screenKeptOn()).toBe(false))
  })

  it('keeps the screen awake again when the app returns to the foreground mid-download', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    await waitFor(() => expect(device.screenKeptOn()).toBe(true))

    setVisibility('hidden')
    device.dropScreenHolds()
    setVisibility('visible')

    await waitFor(() => expect(device.screenKeptOn()).toBe(true))
  })

  it('asks the browser to keep stored files', async () => {
    const { device, user } = await setUp()
    expect(device.persistRequests).toBe(0)

    await startDownload(user, first.title)

    await waitFor(() => expect(device.persistRequests).toBeGreaterThan(0))
  })

  it('resumes an interrupted download from where it stopped', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    device.network.dropConnection()

    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    expect(within(row(first.title)).getByText(/interrupted/i)).toBeInTheDocument()
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
    await waitFor(() => expect(device.screenKeptOn()).toBe(false))
    expect(device.files.onlyFile()).toEqual(firstFile.subarray(0, 400))

    device.network.reconnect()
    device.network.unthrottle()
    await user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.network.requests.at(-1)).toMatchObject({ url: first.enclosureUrl, range: 'bytes=400-' })
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('resumes by itself when the app comes back to the foreground', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    setVisibility('hidden')
    device.network.dropConnection()
    await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    device.network.reconnect()
    device.network.unthrottle()
    setVisibility('visible')

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.network.requests.at(-1)).toMatchObject({ range: 'bytes=400-' })
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('counts a download that stops arriving as interrupted, so it can be resumed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    const { device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    act(() => void vi.advanceTimersByTime(STALL_MS))

    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    await waitFor(() => expect(device.screenKeptOn()).toBe(false))
    device.network.unthrottle()
    await user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.network.requests.at(-1)).toMatchObject({ range: 'bytes=400-' })
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('starts again from the beginning when the file on the host has changed size since', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.network.dropConnection()
    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })

    // The publisher replaced the file, as with a re-edit or a different ad break.
    const replacement = audioFile(1200).reverse()
    device.network.host(first.enclosureUrl, replacement)
    device.network.reconnect()
    device.network.unthrottle()
    await user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(replacement)
  })

  it('starts again from the beginning when the host can’t send part of a file', async () => {
    const { device, user } = await setUp({ ranges: false })
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.network.dropConnection()
    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })

    device.network.reconnect()
    device.network.unthrottle()
    await user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('never counts a download as done when the host sends less than the whole file', async () => {
    const { device, user } = await setUp()
    device.network.endEarly(first.enclosureUrl, 600)

    await startDownload(user, first.title)

    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    expect(within(row(first.title)).getByText('60%')).toBeInTheDocument()
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()

    await user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('shows a part-downloaded episode as unfinished after a relaunch, and resumes it', async () => {
    const { data, device, user, unmount } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.network.dropConnection()
    await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    unmount()

    device.network.reconnect()
    device.network.unthrottle()
    const relaunched = await launch(data, device)

    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
    await relaunched.user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.network.requests.at(-1)).toMatchObject({ range: 'bytes=400-' })
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('keeps what was stored when the app is killed mid-download, and resumes from there', async () => {
    const { data, device, user, unmount } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    // As iOS may do to the app while the phone is locked: nothing gets to finish or close.
    device.killApp()
    unmount()
    device.network.unthrottle()
    const relaunched = await launch(data, device)

    const resume = await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    expect(within(row(first.title)).getByText('40%')).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile.subarray(0, 400))
    await relaunched.user.click(resume)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.network.requests.at(-1)).toMatchObject({ range: 'bytes=400-' })
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('starts again from the beginning when the file on the host changed size while the app was closed', async () => {
    const { data, device, user, unmount } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.killApp()
    unmount()

    // A different ad break, say: the same URL now serves a longer file.
    const replacement = audioFile(1200).reverse()
    device.network.host(first.enclosureUrl, replacement)
    device.network.unthrottle()
    const relaunched = await launch(data, device)
    await relaunched.user.click(await within(row(first.title)).findByRole('button', { name: 'Resume download' }))

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(replacement)
  })

  it('still shows a finished download as downloaded after a relaunch', async () => {
    const { data, device, user, unmount } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)
    unmount()

    await launch(data, device)

    expect(await downloaded(first.title)).toBeInTheDocument()
    expect(within(row(second.title)).getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })

  it('shows the badge in the latest episodes too', async () => {
    const { user } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(screen.getByRole('button', { name: 'Latest' }))
    await screen.findByRole('list', { name: 'Latest episodes' })

    expect(within(row(first.title)).getByText('Downloaded')).toBeInTheDocument()
    expect(within(row(second.title)).queryByText('Downloaded')).not.toBeInTheDocument()
  })

  it('shows the badge in the queue too', async () => {
    const { user } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)
    await user.click(within(row(first.title)).getByRole('button', { name: 'Add to queue' }))
    await user.click(within(row(second.title)).getByRole('button', { name: 'Add to queue' }))

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    await screen.findByRole('list', { name: 'Queued episodes' })

    expect(within(row(first.title)).getByText('Downloaded')).toBeInTheDocument()
    expect(within(row(second.title)).queryByText('Downloaded')).not.toBeInTheDocument()
  })

  it('downloads from the episode’s own screen', async () => {
    const { device, user } = await setUp()
    await user.click(within(row(first.title)).getByRole('button', { name: 'Show notes' }))
    await screen.findByRole('heading', { level: 1, name: first.title })

    await user.click(screen.getByRole('button', { name: 'Download' }))

    expect(await screen.findByText('Downloaded')).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('says the download was interrupted, not blocked, when there is no connection', async () => {
    const { device, user } = await setUp()
    device.network.dropConnection()

    await startDownload(user, first.title)

    expect(await within(row(first.title)).findByRole('button', { name: 'Resume download' })).toBeInTheDocument()
    expect(within(row(first.title)).queryByText(/Preparing download/)).not.toBeInTheDocument()
  })

  it('says when the device has no room for the file', async () => {
    const { device, user } = await setUp()
    device.files.runOutOfSpace()

    await startDownload(user, first.title)

    expect(await within(row(first.title)).findByText(/not enough space/i)).toBeInTheDocument()
    expect(within(row(first.title)).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
  })

  it('says when the publisher’s host won’t give the file', async () => {
    const { user } = await setUp()

    await startDownload(user, second.title)

    expect(await within(row(second.title)).findByText(/couldn’t be downloaded/i)).toBeInTheDocument()
    expect(within(row(second.title)).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('playing a downloaded episode', () => {
  it('plays the stored copy when there is one, and streams otherwise', async () => {
    const { audio, device, user } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)

    await tap(user, first.title)
    expect(device.files.contentsAt(audio.src)).toEqual(firstFile)
    expect(audio.paused).toBe(false)

    await tap(user, second.title)
    expect(audio.src).toBe(second.enclosureUrl)
  })

  it('seeks within the stored copy', async () => {
    const { audio, device, user } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)
    await tap(user, first.title)
    await user.click(within(screen.getByRole('region', { name: 'Mini player' })).getByRole('button', { name: new RegExp(first.title) }))
    act(() => audio.loadMetadata(2700))

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '1800' } })

    expect(audio.currentTime).toBe(1800)
    expect(device.files.contentsAt(audio.src)).toEqual(firstFile)
  })

  it('plays the stored copy after a relaunch', async () => {
    const { data, device, user, unmount } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)
    unmount()

    const relaunched = await launch(data, device)
    await downloaded(first.title)
    await tap(relaunched.user, first.title)

    expect(device.files.contentsAt(relaunched.audio.src)).toEqual(firstFile)
  })

  it('moves on to the stored copy of the next queued episode', async () => {
    const { audio, device, user } = await setUp()
    await startDownload(user, first.title)
    await downloaded(first.title)
    await user.click(within(row(first.title)).getByRole('button', { name: 'Add to queue' }))
    await tap(user, second.title)
    act(() => audio.loadMetadata(3723))

    act(() => audio.playToEnd())

    expect(device.files.contentsAt(audio.src)).toEqual(firstFile)
  })

  it('streams an episode whose download is unfinished', async () => {
    const { audio, device, user } = await setUp()
    device.network.throttle()
    await startDownload(user, first.title)
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    await tap(user, first.title)

    expect(audio.src).toBe(first.enclosureUrl)
  })
})

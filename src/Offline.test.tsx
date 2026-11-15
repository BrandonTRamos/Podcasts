import { act, fireEvent, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const feedUrl = 'https://feeds.example.com/show.xml'
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
const third = {
  title: 'Episode 3: The Finale',
  publishedAt: '2026-11-12T08:00:00.000Z',
  durationSeconds: 7200,
  enclosureUrl: 'https://media.example.com/show/ep3.mp3',
}

/** Stand-in audio for the first episode: a file of distinct bytes. */
const firstFile = Uint8Array.from({ length: 1000 }, (_, i) => i % 251)

/** A backend holding one show with three episodes, the first of which can be downloaded, with the owner signed in. */
async function backendWithShow() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast(feedUrl, show)
  const [firstId, secondId, thirdId] = data.ingest(podcastId, [first, second, third])
  await fakeAuth(owner).signIn(owner.email, owner.password)
  return { data, podcastId, firstId, secondId, thirdId }
}

type Data = FakeDataApi | ReturnType<FakeDataApi['anotherDevice']>

/**
 * Launches TinCan on a device, as opening it from the home screen does. Each
 * launch gets its own part of the page, so two devices can be open at once.
 */
function launch(data: Data, device: FakeDevice) {
  const audio = new FakeAudio()
  const auth = fakeAuth(owner, { device })
  const container = document.body.appendChild(document.createElement('div'))
  const { unmount } = render(
    <App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device }} />,
    { container },
  )
  const ui = within(container)
  const user = userEvent.setup()
  const app = {
    audio,
    auth,
    ui,
    user,
    unmount,
    async openShow() {
      await user.click(await ui.findByRole('button', { name: /The Example Show/ }))
      await ui.findByRole('list', { name: 'Episodes' })
    },
    /** The episode's entry in the show's list. */
    row(title: string) {
      const items = within(ui.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
      const item = items.find((li) => within(li).queryByRole('heading', { name: title }))
      if (!item) throw new Error(`No episode "${title}" in the list`)
      return item
    },
    /** The button that plays the episode: its title, in the show's list. */
    playButton(title: string) {
      return within(app.row(title)).getByRole('button', { name: title })
    },
    async tap(title: string) {
      await user.click(app.playButton(title))
    },
    miniPlayer: () => ui.getByRole('region', { name: 'Mini player' }),
    offlineNotice: () => ui.queryByText(/You’re offline/),
  }
  return app
}

/** Uses TinCan online, as before a flight: opens the show, so this device keeps a copy of it, and downloads the first episode. */
async function prepareForFlight(data: Data, device: FakeDevice) {
  device.network.host(first.enclosureUrl, firstFile)
  const app = launch(data, device)
  await app.openShow()
  await app.user.click(within(app.row(first.title)).getByRole('button', { name: 'Download' }))
  await within(app.row(first.title)).findByText('Downloaded')
  return app
}

/** The device loses its network, as in airplane mode, and the backend can't be reached from it. */
function goOffline(data: Data, device: FakeDevice) {
  act(() => {
    if ('goOffline' in data) data.goOffline()
    else data.disconnect()
    device.goOffline()
  })
}

function goOnline(data: Data, device: FakeDevice) {
  act(() => {
    if ('goOnline' in data) data.goOnline()
    else data.reconnect()
    device.goOnline()
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('opening TinCan with no network', () => {
  it('shows the library, its episodes and what has been played, as last seen', async () => {
    const { data, podcastId, secondId, thirdId } = await backendWithShow()
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 0, played: true })
    data.seedEpisodeState({ episodeId: thirdId, podcastId, positionSeconds: 1800, played: false, queueOrder: 1 })
    const device = new FakeDevice()
    const before = await prepareForFlight(data, device)
    before.unmount()

    goOffline(data, device)
    const app = launch(data, device)

    expect(await app.ui.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    await app.openShow()
    expect(within(app.row(second.title)).getByText('Played')).toBeInTheDocument()
    expect(within(app.row(third.title)).getByText('1 hr 30 min left')).toBeInTheDocument()
    expect(within(app.row(third.title)).getByText('Queued')).toBeInTheDocument()
    expect(within(app.row(first.title)).getByText('Downloaded')).toBeInTheDocument()
    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows that it is offline, and when it is back online', async () => {
    const { data } = await backendWithShow()
    const device = new FakeDevice()
    const app = launch(data, device)
    await app.ui.findByRole('button', { name: /The Example Show/ })
    expect(app.offlineNotice()).not.toBeInTheDocument()

    goOffline(data, device)

    // Awaited: the app may start watching the network just after it first shows.
    expect(await app.ui.findByText(/You’re offline/)).toBeInTheDocument()
    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
    expect(app.ui.getByRole('button', { name: /The Example Show/ })).toBeInTheDocument()

    goOnline(data, device)

    await waitFor(() => expect(app.offlineNotice()).not.toBeInTheDocument())
  })

  it('opens with no sign-in prompt when the session has expired', async () => {
    const { data } = await backendWithShow()
    const device = new FakeDevice()
    const before = await prepareForFlight(data, device)
    before.unmount()
    before.auth.expireSession()

    goOffline(data, device)
    const app = launch(data, device)

    expect(await app.ui.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(app.ui.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(app.offlineNotice()).toBeInTheDocument()
    await app.openShow()
    await app.tap(first.title)
    expect(device.files.contentsAt(app.audio.src)).toEqual(firstFile)
    expect(app.audio.paused).toBe(false)
  })

  it('renews an expired session once back online, with nothing to sign in to', async () => {
    const { data, firstId } = await backendWithShow()
    const device = new FakeDevice()
    const before = await prepareForFlight(data, device)
    before.unmount()
    before.auth.expireSession()
    goOffline(data, device)
    const app = launch(data, device)
    await app.openShow()
    await app.user.click(within(app.row(first.title)).getByRole('button', { name: 'Mark played' }))

    goOnline(data, device)

    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ played: true }))
    expect(app.ui.queryByText(/sign in/i)).not.toBeInTheDocument()
  })

  it('asks to sign in again once back online if the session can’t be renewed, and syncs once signed in', async () => {
    const { data, firstId } = await backendWithShow()
    const device = new FakeDevice()
    const before = await prepareForFlight(data, device)
    before.unmount()
    before.auth.expireSession({ renewable: false })
    goOffline(data, device)
    const app = launch(data, device)
    await app.openShow()
    await app.user.click(within(app.row(first.title)).getByRole('button', { name: 'Mark played' }))

    goOnline(data, device)

    const notice = await app.ui.findByRole('status', { name: 'Session expired' })
    expect(notice).toHaveTextContent('Sign in again to sync what you play on this device.')
    // Still in the app, with the change kept, until the listener chooses to sign in.
    expect(within(app.row(first.title)).getByText('Played')).toBeInTheDocument()
    await app.user.click(within(notice).getByRole('button', { name: 'Sign in' }))
    await app.user.type(app.ui.getByLabelText('Email'), owner.email)
    await app.user.type(app.ui.getByLabelText('Password'), owner.password)
    await app.user.click(app.ui.getByRole('button', { name: 'Sign in' }))

    expect(await app.ui.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ played: true }))
  })
})

describe('playing with no network', () => {
  it('plays a downloaded episode from the device, with seeking', async () => {
    const { data } = await backendWithShow()
    const device = new FakeDevice()
    const before = await prepareForFlight(data, device)
    before.unmount()
    goOffline(data, device)
    const app = launch(data, device)
    await app.openShow()

    await app.tap(first.title)

    expect(device.files.contentsAt(app.audio.src)).toEqual(firstFile)
    expect(app.audio.paused).toBe(false)
    act(() => app.audio.loadMetadata(2712))
    act(() => app.audio.progressTo(600))
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    await app.user.click(app.ui.getByRole('button', { name: 'Skip forward 30 seconds' }))
    expect(app.audio.currentTime).toBe(630)
    fireEvent.change(app.ui.getByRole('slider', { name: 'Seek' }), { target: { value: '1800' } })
    expect(app.audio.currentTime).toBe(1800)
  })

  it('shows episodes that are not downloaded as unavailable', async () => {
    const { data } = await backendWithShow()
    const device = new FakeDevice()
    const app = await prepareForFlight(data, device)

    goOffline(data, device)

    expect(await within(app.row(second.title)).findByText('Not available offline')).toBeInTheDocument()
    expect(app.playButton(second.title)).toBeDisabled()
    expect(app.playButton(first.title)).toBeEnabled()
    expect(within(app.row(first.title)).queryByText('Not available offline')).not.toBeInTheDocument()

    goOnline(data, device)

    await waitFor(() => expect(app.playButton(second.title)).toBeEnabled())
    expect(within(app.row(second.title)).queryByText('Not available offline')).not.toBeInTheDocument()
  })
})

describe('syncing what was played offline', () => {
  it('keeps position, played state and queue changes made offline, through a relaunch, and syncs them when back online', async () => {
    const { data, firstId, secondId, thirdId } = await backendWithShow()
    const device = new FakeDevice()
    const app = await prepareForFlight(data, device)
    goOffline(data, device)

    await app.tap(first.title)
    act(() => app.audio.progressTo(600))
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: 'Pause' }))
    await app.user.click(within(app.row(second.title)).getByRole('button', { name: 'Mark played' }))
    await app.user.click(within(app.row(third.title)).getByRole('button', { name: 'Add to queue' }))
    await act(async () => {})
    expect(data.savedState(firstId)).toBeUndefined()

    app.unmount()
    const relaunched = launch(data, device)
    await relaunched.openShow()
    expect(within(relaunched.row(first.title)).getByText('35 min left')).toBeInTheDocument()
    expect(within(relaunched.row(second.title)).getByText('Played')).toBeInTheDocument()
    expect(within(relaunched.row(third.title)).getByText('Queued')).toBeInTheDocument()

    goOnline(data, device)

    await waitFor(() => {
      expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600, played: false })
      expect(data.savedState(secondId)).toMatchObject({ played: true })
      expect(data.savedState(thirdId)?.queueOrder).not.toBeNull()
    })
    expect(within(relaunched.row(third.title)).getByText('Queued')).toBeInTheDocument()
  })

  it('keeps every change made offline to one episode, however the network orders their saves', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const at = (time: string) => vi.setSystemTime(new Date(`2026-11-14T${time}:00.000Z`))
    const { data, firstId } = await backendWithShow()
    const device = new FakeDevice()
    const app = await prepareForFlight(data, device)
    goOffline(data, device)
    at('10:00')
    await app.user.click(within(app.row(first.title)).getByRole('button', { name: 'Mark played' }))
    at('10:05')
    await app.tap(first.title)
    act(() => app.audio.progressTo(600))
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: 'Pause' }))
    data.holdSaves()

    goOnline(data, device)
    await act(async () => {})
    // The later change, if sent alongside, would land first, and the earlier one then lose to it.
    act(() => data.releaseSaves({ newestFirst: true }))

    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ played: true, positionSeconds: 600 }))
    await act(async () => {})
    expect(within(app.row(first.title)).getByText('Played')).toBeInTheDocument()
  })

  it('shows changes made on other devices meanwhile once back online', async () => {
    const { data, podcastId, secondId } = await backendWithShow()
    const device = new FakeDevice()
    const app = await prepareForFlight(data, device)
    goOffline(data, device)
    // Made while this device was offline: its live update never reached it.
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 0, played: true })

    goOnline(data, device)

    expect(await within(app.row(second.title)).findByText('Played')).toBeInTheDocument()
  })
})

describe('a network that seems up but reaches nothing', () => {
  it('catches up on returning to the foreground, though the browser thought it online throughout', async () => {
    const { data } = await backendWithShow()
    const device = new FakeDevice()
    const app = launch(data, device)
    await app.ui.findByRole('button', { name: /The Example Show/ })
    // A captive network: the backend can't be reached, though the device says it is online.
    act(() => data.goOffline())
    data.seedPodcast('https://feeds.example.com/other.xml', { title: 'Another Show' })
    act(() => data.goOnline())

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => void document.dispatchEvent(new Event('visibilitychange')))

    expect(await app.ui.findByRole('button', { name: /Another Show/ })).toBeInTheDocument()
    Reflect.deleteProperty(document, 'visibilityState')
  })
})

describe('the same episode changed on two devices', () => {
  const at = (time: string) => vi.setSystemTime(new Date(`2026-11-14T${time}:00.000Z`))

  it('keeps the later change, though the earlier one reached the backend last', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { data, firstId } = await backendWithShow()
    const phoneData = data.anotherDevice()
    const phoneDevice = new FakeDevice()
    const phone = await prepareForFlight(phoneData, phoneDevice)
    goOffline(phoneData, phoneDevice)
    at('10:00')
    await phone.user.click(within(phone.row(first.title)).getByRole('button', { name: 'Mark played' }))

    at('12:00')
    const desktop = launch(data, new FakeDevice())
    await desktop.openShow()
    await desktop.tap(first.title)
    act(() => desktop.audio.progressTo(900))
    await desktop.user.click(within(desktop.miniPlayer()).getByRole('button', { name: 'Pause' }))

    at('14:00')
    goOnline(phoneData, phoneDevice)

    await waitFor(() => expect(within(phone.row(first.title)).queryByText('Played')).not.toBeInTheDocument())
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 900, played: false })
    expect(within(phone.row(first.title)).getByText('30 min left')).toBeInTheDocument()
  })

  it('keeps a change made offline when it is the later one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { data, firstId } = await backendWithShow()
    const phoneData = data.anotherDevice()
    const phoneDevice = new FakeDevice()
    const phone = await prepareForFlight(phoneData, phoneDevice)
    at('10:00')
    const desktop = launch(data, new FakeDevice())
    await desktop.openShow()
    await desktop.tap(first.title)
    act(() => desktop.audio.progressTo(900))
    await desktop.user.click(within(desktop.miniPlayer()).getByRole('button', { name: 'Pause' }))

    goOffline(phoneData, phoneDevice)
    at('12:00')
    await phone.user.click(within(phone.row(first.title)).getByRole('button', { name: 'Mark played' }))
    at('14:00')
    goOnline(phoneData, phoneDevice)

    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ played: true }))
    expect(within(phone.row(first.title)).getByText('Played')).toBeInTheDocument()
  })
})

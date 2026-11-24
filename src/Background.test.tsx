import { act, render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { KEEP_PLACE_MS } from './keptPlace'
import { RETRY_DELAYS_MS, SETTLED_SECONDS, STALE_PAUSE_MS } from './player'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

// What the app does while it is in the background (another app in front, or
// the phone locked), and when the listener comes back to it. iOS may suspend
// it there, drop its network, or close it outright and load it afresh later.

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', artworkUrl: 'https://cdn.example.com/show/artwork.jpg' }
const first = {
  title: 'Episode 1: The Beginning',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 2700,
  enclosureUrl: 'https://media.example.com/show/ep1.mp3',
}

/** A backend holding one show with one episode, and a device signed in to it. */
async function setUp() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [firstId] = data.ingest(podcastId, [first])
  await fakeAuth(owner).signIn(owner.email, owner.password)
  return { data, device: new FakeDevice(), podcastId, firstId }
}

/**
 * Opens the app on the device, as a launch of it would, in its own part of
 * the page: an app iOS closed gets no chance to tidy up, so tests of that
 * leave the earlier launch where it is rather than unmount it.
 */
async function launch(data: FakeDataApi, device: FakeDevice) {
  const audio = new FakeAudio()
  const mediaSession = new FakeMediaSession()
  const container = document.body.appendChild(document.createElement('div'))
  const { unmount } = render(<App services={{ auth: fakeAuth(owner), data, audio, mediaSession, device }} />, { container })
  await waitFor(() => expect(container).not.toBeEmptyDOMElement())
  await act(async () => {})
  const ui = within(container)
  return {
    audio,
    mediaSession,
    device,
    ui,
    user: userEvent.setup(),
    unmount,
    miniPlayer: () => ui.getByRole('region', { name: 'Mini player' }),
    async openShow() {
      await this.user.click(await ui.findByRole('button', { name: /The Example Show/ }))
      await ui.findByRole('list', { name: 'Episodes' })
    },
  }
}

/** Launches the app and plays the episode to ten minutes in. */
async function launchAndPlay(data: FakeDataApi, device: FakeDevice) {
  const app = await launch(data, device)
  await app.openShow()
  await app.user.click(within(app.ui.getByRole('list', { name: 'Episodes' })).getByRole('button', { name: first.title }))
  act(() => app.audio.loadMetadata(2712))
  act(() => app.audio.progressTo(600))
  return app
}

/** The app goes to the background or comes back, and is told. */
function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

/** From here on, time passes only as the test says. */
function holdTime() {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
})

describe('an episode paused while the app is in the background', () => {
  it('is loaded afresh at the same place when played after a long pause, without waiting to see it stuck', async () => {
    const { data, device } = await setUp()
    const { audio, mediaSession } = await launchAndPlay(data, device)
    holdTime()
    setVisibility('hidden')
    act(() => mediaSession.press('pause'))

    wait(STALE_PAUSE_MS)
    act(() => mediaSession.press('play'))

    expect(audio.loads).toBe(2)
    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.currentTime).toBe(600)
    expect(audio.paused).toBe(false)
    expect(mediaSession.playbackState).toBe('playing')
    expect(device.playbackLog.lines().at(-1)).toMatch(/paused 60s in the background: loading afresh/)
  })

  it('plays straight on after a short pause', async () => {
    const { data, device } = await setUp()
    const { audio, mediaSession } = await launchAndPlay(data, device)
    holdTime()
    setVisibility('hidden')
    act(() => mediaSession.press('pause'))

    wait(STALE_PAUSE_MS - 1000)
    act(() => mediaSession.press('play'))

    expect(audio.loads).toBe(1)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(600)
  })

  it('counts from when the app was hidden, if it was paused before that', async () => {
    const { data, device } = await setUp()
    const { audio, mediaSession } = await launchAndPlay(data, device)
    holdTime()
    act(() => mediaSession.press('pause'))
    wait(STALE_PAUSE_MS)
    setVisibility('hidden')

    wait(STALE_PAUSE_MS - 1000)
    act(() => mediaSession.press('play'))
    expect(audio.loads).toBe(1)

    act(() => mediaSession.press('pause'))
    wait(STALE_PAUSE_MS)
    setVisibility('visible')
    act(() => mediaSession.press('play'))
    expect(audio.loads).toBe(2)
    expect(audio.currentTime).toBe(600)
  })
})

describe('an episode paused with the app in front', () => {
  it('plays straight on, however long the pause', async () => {
    const { data, device } = await setUp()
    const { audio, mediaSession } = await launchAndPlay(data, device)
    holdTime()
    act(() => mediaSession.press('pause'))

    wait(STALE_PAUSE_MS * 10)
    act(() => mediaSession.press('play'))

    expect(audio.loads).toBe(1)
    expect(audio.paused).toBe(false)
  })
})

describe('a file that fails while it is playing', () => {
  it('is tried again from the same place, with no word of failure', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()

    act(() => app.audio.failToLoad())

    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(app.miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(app.audio.loads).toBe(1)

    wait(RETRY_DELAYS_MS[0])

    expect(app.audio.loads).toBe(2)
    expect(app.audio.src).toBe(first.enclosureUrl)
    expect(app.audio.currentTime).toBe(600)
    expect(app.audio.paused).toBe(false)
    expect(device.playbackLog.lines().some((line) => /failed at 600\.0: trying again/.test(line))).toBe(true)
  })

  it('is shown as failed once every try has failed too', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()

    act(() => app.audio.failToLoad())
    for (const delay of RETRY_DELAYS_MS) {
      expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
      wait(delay)
      act(() => app.audio.failToLoad())
    }

    expect(app.audio.loads).toBe(1 + RETRY_DELAYS_MS.length)
    expect(within(app.miniPlayer()).getByRole('alert')).toBeInTheDocument()
    expect(app.mediaSession.playbackState).toBe('paused')
    wait(RETRY_DELAYS_MS.at(-1)! * 10)
    expect(app.audio.loads).toBe(1 + RETRY_DELAYS_MS.length)
  })

  it('has the place it had got to saved before it is given up on', async () => {
    const { data, device, firstId } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    for (let second = 1; second <= 5; second++) act(() => app.audio.progressTo(600 + second))

    act(() => app.audio.failToLoad())
    for (const delay of RETRY_DELAYS_MS) {
      wait(delay)
      act(() => app.audio.failToLoad())
    }

    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 605, played: false }))
  })

  it('gets every try again once it has played on', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    act(() => app.audio.failToLoad())
    wait(RETRY_DELAYS_MS[0])
    act(() => app.audio.loadMetadata(2712))
    for (let second = 1; second <= SETTLED_SECONDS; second++) act(() => app.audio.progressTo(600 + second))
    act(() => app.audio.progressTo(630))

    for (const delay of RETRY_DELAYS_MS) {
      act(() => app.audio.failToLoad())
      wait(delay)
    }

    expect(app.audio.loads).toBe(2 + RETRY_DELAYS_MS.length)
    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
    expect(app.audio.currentTime).toBe(630)
    expect(app.audio.paused).toBe(false)
  })

  it('gets no more tries for having played on a moment between failures', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()

    act(() => app.audio.failToLoad())
    for (const delay of RETRY_DELAYS_MS) {
      wait(delay)
      act(() => app.audio.loadMetadata(2712))
      act(() => app.audio.progressTo(601))
      act(() => app.audio.failToLoad())
    }

    expect(app.audio.loads).toBe(1 + RETRY_DELAYS_MS.length)
    expect(within(app.miniPlayer()).getByRole('alert')).toBeInTheDocument()
  })

  it('is not tried again once the listener pauses it, until they play it', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    act(() => app.audio.failToLoad())

    act(() => app.mediaSession.press('pause'))
    wait(RETRY_DELAYS_MS[0] * 10)

    expect(app.audio.loads).toBe(1)
    expect(app.mediaSession.playbackState).toBe('paused')

    act(() => app.mediaSession.press('play'))

    expect(app.audio.loads).toBe(2)
    expect(app.audio.currentTime).toBe(600)
    expect(app.audio.paused).toBe(false)
  })

  it('is tried at once when the network comes back', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    act(() => app.audio.failToLoad())
    wait(RETRY_DELAYS_MS[0])
    act(() => app.audio.failToLoad())

    act(() => void window.dispatchEvent(new Event('online')))

    expect(app.audio.loads).toBe(3)
    expect(app.audio.currentTime).toBe(600)
    // The wait it cut short does not then try it a further time.
    wait(RETRY_DELAYS_MS[1])
    expect(app.audio.loads).toBe(3)
  })

  it('is tried at once when the listener comes back to the app', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    setVisibility('hidden')
    act(() => app.audio.failToLoad())

    setVisibility('visible')

    expect(app.audio.loads).toBe(2)
    expect(app.audio.currentTime).toBe(600)
  })

  it('is tried again when play is pressed on the lock screen, after it has been shown as failed', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    act(() => app.audio.failToLoad())
    for (const delay of RETRY_DELAYS_MS) {
      wait(delay)
      act(() => app.audio.failToLoad())
    }

    act(() => app.mediaSession.press('play'))

    expect(app.audio.loads).toBe(2 + RETRY_DELAYS_MS.length)
    expect(app.audio.currentTime).toBe(600)
    expect(app.audio.paused).toBe(false)
    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
    expect(app.mediaSession.playbackState).toBe('playing')
  })
})

describe('a file that fails while it is paused', () => {
  it('shows no failure, and is loaded again at the same place when played', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    act(() => app.mediaSession.press('pause'))

    act(() => app.audio.failToLoad())

    expect(app.ui.queryByRole('alert')).not.toBeInTheDocument()
    expect(app.audio.loads).toBe(1)

    act(() => app.mediaSession.press('play'))

    expect(app.audio.loads).toBe(2)
    expect(app.audio.currentTime).toBe(600)
    expect(app.audio.paused).toBe(false)
  })
})

describe('while an episode plays with the app hidden', () => {
  it('tells the OS the position only when the OS would otherwise have it wrong', async () => {
    const { data, device } = await setUp()
    const { audio, mediaSession } = await launchAndPlay(data, device)
    holdTime()
    setVisibility('hidden')
    const told = mediaSession.positionUpdates

    // Ten seconds of playback, a tick every quarter of a second.
    for (let tick = 1; tick <= 40; tick++) {
      wait(250)
      act(() => audio.progressTo(600 + tick / 4))
    }
    expect(mediaSession.positionUpdates).toBe(told)

    act(() => mediaSession.press('seekforward'))

    expect(mediaSession.positionUpdates).toBe(told + 1)
    expect(mediaSession.positionState).toMatchObject({ position: 640 })
  })

  it('draws nothing of the position moving on, and catches up when shown again', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    const seekBar = () => app.ui.getByRole('slider', { name: 'Seek' })
    expect(seekBar()).toHaveValue('600')

    setVisibility('hidden')
    act(() => app.audio.progressTo(900))
    expect(seekBar()).toHaveValue('600')

    setVisibility('visible')
    expect(seekBar()).toHaveValue('900')
  })

  it('still draws it pausing', async () => {
    const { data, device } = await setUp()
    const app = await launchAndPlay(data, device)
    setVisibility('hidden')

    act(() => app.mediaSession.press('pause'))

    expect(within(app.miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })
})

describe('an app iOS closed while it played in the background', () => {
  /** Plays to ten minutes in, then on in the background to 10:05, where iOS closes the app. */
  async function playThenGetClosed(data: FakeDataApi, device: FakeDevice) {
    const app = await launchAndPlay(data, device)
    holdTime()
    setVisibility('hidden')
    wait(KEEP_PLACE_MS)
    act(() => app.audio.progressTo(605))
    Reflect.deleteProperty(document, 'visibilityState')
  }

  it('picks up, at the next launch, within seconds of where it was', async () => {
    const { data, device, firstId } = await setUp()
    await playThenGetClosed(data, device)
    // Going to the background saved the position; playing on there did not.
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600 })

    const app = await launch(data, device)

    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 605, played: false }))
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: 'Play' }))
    expect(app.audio.currentTime).toBe(605)
  })

  it('gives way to a place saved later on another device', async () => {
    const { data, device, podcastId, firstId } = await setUp()
    await playThenGetClosed(data, device)
    wait(60_000)
    await data.anotherDevice().saveEpisodeState(firstId, podcastId, { positionSeconds: 1200 }, new Date().toISOString())
    wait(60_000)

    const app = await launch(data, device)

    await waitFor(() => expect(within(app.miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument())
    await act(async () => {})
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 1200 })
    await app.user.click(within(app.miniPlayer()).getByRole('button', { name: 'Play' }))
    expect(app.audio.currentTime).toBe(1200)
  })

  it('keeps no place once the position has been saved since', async () => {
    const { data, device, firstId } = await setUp()
    const app = await launchAndPlay(data, device)
    holdTime()
    wait(KEEP_PLACE_MS)
    act(() => app.audio.progressTo(605))
    act(() => app.mediaSession.press('pause'))
    await waitFor(() => expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 605 }))
    const writes = data.stateWrites().length

    await launch(data, device)

    expect(data.stateWrites()).toHaveLength(writes)
  })
})

describe('an app iOS closed while it was in the background', () => {
  it('opens, when the listener comes back, on the screen they were on', async () => {
    const { data, device } = await setUp()
    const before = await launch(data, device)
    await before.openShow()
    setVisibility('hidden')
    before.unmount()
    Reflect.deleteProperty(document, 'visibilityState')

    const app = await launch(data, device)

    expect(await app.ui.findByRole('heading', { level: 1, name: show.title })).toBeInTheDocument()
    expect(app.ui.queryByRole('heading', { level: 1, name: 'Library' })).not.toBeInTheDocument()
  })

  it('says in the playback log, once, that the screens were restored', async () => {
    const { data, device } = await setUp()
    const before = await launch(data, device)
    await before.openShow()
    setVisibility('hidden')
    before.unmount()
    Reflect.deleteProperty(document, 'visibilityState')
    const earlier = device.playbackLog.lines().length

    await launch(data, device)

    const lines = device.playbackLog.lines().slice(earlier).filter((line) => line.includes(' screens '))
    expect(lines.map((line) => line.slice(19))).toEqual(['screens restored from a run iOS closed'])
  })

  it('says in the playback log that the screens were not restored, at a fresh start', async () => {
    const { data, device } = await setUp()

    await launch(data, device)

    expect(device.playbackLog.lines().map((line) => line.slice(19))).toContain('screens not restored')
  })

  it('opens on now playing, if that was open, with the episode ready to play', async () => {
    const { data, device } = await setUp()
    const before = await launchAndPlay(data, device)
    await before.user.click(within(before.miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    act(() => before.mediaSession.press('pause'))
    setVisibility('hidden')
    before.unmount()
    Reflect.deleteProperty(document, 'visibilityState')

    const app = await launch(data, device)

    expect(await app.ui.findByRole('button', { name: 'Close now playing' })).toBeInTheDocument()
    expect(app.ui.getByRole('heading', { level: 1, name: first.title })).toBeInTheDocument()
    await app.user.click(app.ui.getByRole('button', { name: 'Play' }))
    expect(app.audio.currentTime).toBe(600)
  })

  it('opens on the library after that, once it has been closed in plain sight', async () => {
    const { data, device } = await setUp()
    const before = await launch(data, device)
    await before.openShow()
    setVisibility('hidden')
    setVisibility('visible')
    before.unmount()

    const app = await launch(data, device)

    expect(await app.ui.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
  })

  it('opens on the library if what was kept of the screen makes no sense', async () => {
    const { data, device } = await setUp()
    device.storage.set('view', JSON.stringify({ screen: { name: 'podcast' }, nowPlayingOpen: true }))

    const app = await launch(data, device)

    expect(await app.ui.findByRole('heading', { level: 1, name: 'Library' })).toBeInTheDocument()
  })
})

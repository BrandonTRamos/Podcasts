import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { LONG_PRESS_MS } from './longPress'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = {
  title: 'The Example Show',
  author: 'Example Media',
  artworkUrl: 'https://cdn.example.com/show/artwork.jpg',
}
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

/** Signs the owner in to a library holding one show with two episodes, and opens the show. */
async function renderShow() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  data.ingest(podcastId, [first, second])
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  return { ...(await launch(data)), data }
}

/** Opens the app, already signed in, at the show's page, as a fresh launch of it would. */
async function launch(data: FakeDataApi) {
  const audio = new FakeAudio()
  const services = { auth: fakeAuth(owner), data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }
  const { unmount } = render(<App services={services} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, user, unmount }
}

async function openNowPlaying(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(title) }))
}

function speedSlider() {
  return screen.getByRole('slider', { name: 'Playback speed' })
}

async function openSpeed(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Change speed/ }))
}

function slideSpeedTo(speed: string) {
  fireEvent.change(speedSlider(), { target: { value: speed } })
}

/** The episode's button in the show's list, as opposed to the mini player's. */
function episodeInList(title: string) {
  return within(screen.getByRole('list', { name: 'Episodes' })).getByRole('button', { name: title })
}

function miniPlayer() {
  return screen.getByRole('region', { name: 'Mini player' })
}

describe('streaming an episode', () => {
  it('starts streaming from the publisher’s URL when the episode is tapped', async () => {
    const { audio, user } = await renderShow()
    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: first.title }))

    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.paused).toBe(false)
    expect(miniPlayer()).toHaveTextContent(first.title)
    expect(miniPlayer().querySelector('img')).toHaveAttribute('src', show.artworkUrl)
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('shows it paused when the browser refuses to start it, and plays on the next tap of Play', async () => {
    const { audio, user } = await renderShow()
    audio.refuseNextPlay()

    await user.click(screen.getByRole('button', { name: first.title }))

    expect(await within(miniPlayer()).findByRole('button', { name: 'Play' })).toBeInTheDocument()
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))
    expect(audio.paused).toBe(false)
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})

describe('controlling playback', () => {
  it('pauses and plays again', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Pause' }))
    expect(audio.paused).toBe(true)

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))
    expect(audio.paused).toBe(false)
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('shows elapsed time and duration on the seek bar, and seeks with it', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))

    // The feed's duration stands in until the file says how long it is.
    expect(screen.getByText('0:00')).toBeInTheDocument()
    expect(screen.getByText('45:00')).toBeInTheDocument()

    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))

    expect(screen.getByText('12:30')).toBeInTheDocument()
    expect(screen.getByText('45:12')).toBeInTheDocument()
    const seekBar = screen.getByRole('slider', { name: 'Seek' })
    expect(seekBar).toHaveValue('750')
    expect(seekBar).toHaveAttribute('max', '2712')

    fireEvent.change(seekBar, { target: { value: '1800' } })

    expect(audio.currentTime).toBe(1800)
    expect(screen.getByText('30:00')).toBeInTheDocument()
  })

  it('skips forward past the feed’s duration while the file’s own length is still unknown', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    act(() => audio.progressTo(2690))

    await user.click(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))

    expect(audio.currentTime).toBe(2720)
  })

  it('skips back 15 seconds and forward 30, without passing either end', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))

    await user.click(screen.getByRole('button', { name: 'Skip back 15 seconds' }))
    expect(audio.currentTime).toBe(735)
    expect(screen.getByText('12:15')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    expect(audio.currentTime).toBe(765)
    expect(screen.getByText('12:45')).toBeInTheDocument()

    act(() => audio.progressTo(10))
    await user.click(screen.getByRole('button', { name: 'Skip back 15 seconds' }))
    expect(audio.currentTime).toBe(0)
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveValue('0')

    act(() => audio.progressTo(2700))
    await user.click(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    expect(audio.currentTime).toBe(2712)
    expect(screen.getAllByText('45:12')).toHaveLength(2)
  })
})

describe('playback speed', () => {
  it('shows the speed on now playing, with the slider hidden until the speed is tapped', async () => {
    const { user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)

    expect(screen.getByText('1.00×')).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Playback speed' })).not.toBeInTheDocument()

    await openSpeed(user)
    expect(speedSlider()).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Hide speed/ }))
    expect(screen.queryByRole('slider', { name: 'Playback speed' })).not.toBeInTheDocument()
  })

  it('offers a speed slider on now playing from 0.5× to 3× in steps of 0.05, starting at normal speed', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    await openSpeed(user)

    expect(speedSlider()).toHaveAttribute('min', '0.5')
    expect(speedSlider()).toHaveAttribute('max', '3')
    expect(speedSlider()).toHaveAttribute('step', '0.05')
    expect(speedSlider()).toHaveValue('1')
    expect(speedSlider()).toHaveAttribute('aria-valuetext', '1.00×')
    expect(audio.playbackRate).toBe(1)
  })

  it('applies the chosen speed at once, without interrupting playback', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.progressTo(600))
    await openNowPlaying(user, first.title)
    await openSpeed(user)

    slideSpeedTo('1.15')

    expect(audio.playbackRate).toBe(1.15)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(600)
    expect(screen.getByText('1.15×')).toBeInTheDocument()
  })

  it('lands on an exact 0.05 step, whatever the slider reports', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    await openSpeed(user)

    slideSpeedTo('1.4000000000000001')

    expect(audio.playbackRate).toBe(1.4)
    expect(screen.getByText('1.40×')).toBeInTheDocument()
  })

  it('keeps the speed for the next episode played', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    await openSpeed(user)
    slideSpeedTo('1.85')
    await user.click(screen.getByRole('button', { name: 'Close now playing' }))

    await user.click(screen.getByRole('button', { name: second.title }))

    expect(audio.src).toBe(second.enclosureUrl)
    expect(audio.playbackRate).toBe(1.85)
    await openNowPlaying(user, second.title)
    expect(screen.getByText('1.85×')).toBeInTheDocument()
    await openSpeed(user)
    expect(speedSlider()).toHaveValue('1.85')
  })

  it('remembers the speed after the app is closed and opened again', async () => {
    const { data, user, unmount } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    await openSpeed(user)
    slideSpeedTo('1.05')
    unmount()

    const relaunched = await launch(data)
    await relaunched.user.click(screen.getByRole('button', { name: second.title }))

    expect(relaunched.audio.playbackRate).toBe(1.05)
    await openNowPlaying(relaunched.user, second.title)
    await openSpeed(relaunched.user)
    expect(speedSlider()).toHaveValue('1.05')
  })

  it('goes back to normal speed from the reset beside the slider', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    await openSpeed(user)
    slideSpeedTo('2.4')

    await user.click(screen.getByRole('button', { name: /Reset to normal speed/ }))

    expect(audio.playbackRate).toBe(1)
    expect(speedSlider()).toHaveValue('1')
    expect(screen.getByRole('button', { name: /Reset to normal speed/ })).toBeDisabled()
  })
})

describe('choosing how far the skips move', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Presses and holds the button long enough to count, then lets go, which sends its click. */
  function hold(button: HTMLElement) {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.pointerDown(button, { button: 0 })
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS))
    fireEvent.pointerUp(button)
    fireEvent.click(button)
    vi.useRealTimers()
  }

  async function playFirst() {
    const { audio, user, data, unmount } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await openNowPlaying(user, first.title)
    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))
    return { audio, user, data, unmount }
  }

  it('asks how far skip back moves when it is held, without skipping', async () => {
    const { audio, user } = await playFirst()

    hold(screen.getByRole('button', { name: 'Skip back 15 seconds' }))

    expect(audio.currentTime).toBe(750)
    const dialog = screen.getByRole('dialog', { name: 'Skip back by' })
    expect(within(dialog).getByRole('button', { name: '15 seconds' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(dialog).getByRole('button', { name: '10 seconds' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skip back 10 seconds' }))
    expect(audio.currentTime).toBe(740)
    await user.click(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    expect(audio.currentTime).toBe(770)
  })

  it('asks how far skip forward moves when it is held, or right-clicked', async () => {
    const { audio, user } = await playFirst()

    hold(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Skip forward by' })).getByRole('button', { name: '60 seconds' }))
    await user.click(screen.getByRole('button', { name: 'Skip forward 60 seconds' }))
    expect(audio.currentTime).toBe(810)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Skip forward 60 seconds' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Skip forward by' })).getByRole('button', { name: '45 seconds' }))
    expect(screen.getByRole('button', { name: 'Skip forward 45 seconds' })).toBeInTheDocument()
  })

  it('leaves the skip as it was when the choice is cancelled', async () => {
    const { user } = await playFirst()

    hold(screen.getByRole('button', { name: 'Skip back 15 seconds' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip back 15 seconds' })).toBeInTheDocument()
  })

  it('skips at once on a short press', async () => {
    const { audio } = await playFirst()
    const button = screen.getByRole('button', { name: 'Skip back 15 seconds' })

    fireEvent.pointerDown(button, { button: 0 })
    fireEvent.pointerUp(button)
    fireEvent.click(button)

    expect(audio.currentTime).toBe(735)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('remembers the chosen skips after the app is closed and opened again', async () => {
    const { data, user, unmount } = await playFirst()
    hold(screen.getByRole('button', { name: 'Skip back 15 seconds' }))
    await user.click(screen.getByRole('button', { name: '5 seconds' }))
    hold(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    await user.click(screen.getByRole('button', { name: '90 seconds' }))
    unmount()

    const relaunched = await launch(data)
    await relaunched.user.click(screen.getByRole('button', { name: second.title }))
    await openNowPlaying(relaunched.user, second.title)

    expect(screen.getByRole('button', { name: 'Skip back 5 seconds' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skip forward 90 seconds' })).toBeInTheDocument()
  })
})

describe('the mini player and now playing', () => {
  it('keeps the mini player on every screen but now playing while an episode is loaded', async () => {
    const { user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(miniPlayer()).toHaveTextContent(first.title)
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Pause' }))
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('opens a now-playing screen with the artwork and the full set of controls, and closes it again', async () => {
    const { user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))

    const nowPlaying = screen.getByRole('main')
    expect(within(nowPlaying).getByRole('heading', { name: first.title })).toBeInTheDocument()
    expect(nowPlaying).toHaveTextContent(show.title)
    expect(nowPlaying.querySelector('img')).toHaveAttribute('src', show.artworkUrl)
    for (const name of ['Skip back 15 seconds', 'Pause', 'Skip forward 30 seconds']) {
      expect(within(nowPlaying).getByRole('button', { name })).toBeEnabled()
    }
    expect(within(nowPlaying).getByRole('slider', { name: 'Seek' })).toBeEnabled()
    // Now playing has the full controls: the mini player and the tabs make way for it.
    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close now playing' }))

    expect(screen.getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(miniPlayer()).toHaveTextContent(first.title)
    expect(miniPlayer().querySelector('img')).toHaveAttribute('src', show.artworkUrl)
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })
})

describe('the episode playing, in its list', () => {
  it('offers to pause it there, and to play it again once paused', async () => {
    const { audio, user } = await renderShow()
    const list = screen.getByRole('list', { name: 'Episodes' })
    expect(within(list).queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument()

    await user.click(episodeInList(first.title))
    act(() => audio.progressTo(600))

    // Only the episode playing offers it.
    expect(within(list).getAllByRole('button', { name: /^Pause/ })).toHaveLength(1)
    await user.click(within(list).getByRole('button', { name: `Pause ${first.title}` }))

    expect(audio.paused).toBe(true)
    expect(within(list).queryByRole('button', { name: /^Pause/ })).not.toBeInTheDocument()
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()

    await user.click(episodeInList(first.title))

    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(600)
    expect(within(list).getByRole('button', { name: `Pause ${first.title}` })).toBeInTheDocument()
  })

  it('moves to whichever episode is started next', async () => {
    const { user } = await renderShow()
    const list = screen.getByRole('list', { name: 'Episodes' })
    await user.click(episodeInList(first.title))

    await user.click(episodeInList(second.title))

    expect(within(list).getByRole('button', { name: `Pause ${second.title}` })).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: `Pause ${first.title}` })).not.toBeInTheDocument()
  })
})

describe('switching episodes', () => {
  it('replaces the current episode with the one started next', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.progressTo(600))

    await user.click(screen.getByRole('button', { name: second.title }))

    expect(audio.src).toBe(second.enclosureUrl)
    expect(audio.paused).toBe(false)
    expect(miniPlayer()).toHaveTextContent(second.title)
    expect(miniPlayer()).not.toHaveTextContent(first.title)
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(second.title) }))
    expect(screen.getByText('0:00')).toBeInTheDocument()
    expect(screen.getByText('1:02:03')).toBeInTheDocument()
  })
})

describe('tapping the episode that is already loaded', () => {
  it('carries on from where it is, instead of starting over', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.progressTo(600))
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Pause' }))

    await user.click(episodeInList(first.title))

    expect(audio.currentTime).toBe(600)
    expect(audio.paused).toBe(false)
  })
})

describe('an episode that fails to load', () => {
  const message = 'Couldn’t load this episode from the publisher. Try again later, or play something else.'

  it('tries the file again when the episode is tapped again', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.failToLoad())

    await user.click(episodeInList(first.title))

    expect(audio.src).toBe(first.enclosureUrl)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('says so clearly, and leaves the app usable', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    act(() => audio.failToLoad())

    expect(within(miniPlayer()).getByRole('alert')).toHaveTextContent(message)
    expect(within(miniPlayer()).queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    const nowPlaying = screen.getByRole('main')
    expect(within(nowPlaying).getByRole('alert')).toHaveTextContent(message)
    expect(within(nowPlaying).getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(within(nowPlaying).getByRole('slider', { name: 'Seek' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Close now playing' }))
    await user.click(screen.getByRole('button', { name: second.title }))

    expect(audio.src).toBe(second.enclosureUrl)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })
})

describe('signing out', () => {
  it('stops playback and unloads the episode', async () => {
    const { audio, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    await chooseLibraryAction(user, 'Sign out')

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
  })
})

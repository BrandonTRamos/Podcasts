import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { STUCK_MS } from './player'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction, openLibrary } from './test/ui'

// The OS media controls: the lock screen, notification centre, and headphone
// and Bluetooth buttons, all of which reach the app through the media session.

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
async function renderShow({ artworkUrl = show.artworkUrl }: { artworkUrl?: string | null } = {}) {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', { ...show, artworkUrl })
  data.ingest(podcastId, [first, second])
  const audio = new FakeAudio()
  const mediaSession = new FakeMediaSession()
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const device = new FakeDevice()
  render(<App services={{ auth, data, audio, mediaSession, device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, mediaSession, device, user }
}

function miniPlayer() {
  return screen.getByRole('region', { name: 'Mini player' })
}

describe('what the OS media controls show', () => {
  it('shows nothing until an episode is played', async () => {
    const { mediaSession } = await renderShow()

    expect(mediaSession.metadata).toBeNull()
    expect(mediaSession.playbackState).toBe('none')
    expect(mediaSession.positionState).toBeNull()
  })

  it('shows the episode’s title, the podcast’s name and its artwork', async () => {
    const { mediaSession, user } = await renderShow()

    await user.click(screen.getByRole('button', { name: first.title }))

    expect(mediaSession.metadata).toEqual({
      title: first.title,
      artist: show.title,
      artwork: [{ src: show.artworkUrl }],
    })
    expect(mediaSession.playbackState).toBe('playing')
  })

  it('shows no artwork for a podcast that has none', async () => {
    const { mediaSession, user } = await renderShow({ artworkUrl: null })

    await user.click(screen.getByRole('button', { name: first.title }))

    expect(mediaSession.metadata).toEqual({ title: first.title, artist: show.title, artwork: [] })
  })

  it('shows the episode that replaced the one before', async () => {
    const { mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    await user.click(screen.getByRole('button', { name: second.title }))

    expect(mediaSession.metadata).toMatchObject({ title: second.title, artist: show.title })
  })

  it('shows the position and duration, the feed’s duration until the file’s is known', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    expect(mediaSession.positionState).toEqual({ position: 0, duration: 2700, playbackRate: 1 })

    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))

    expect(mediaSession.positionState).toEqual({ position: 750, duration: 2712, playbackRate: 1 })
  })

  it('never shows a position past the end, even when the feed understates the length', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    act(() => audio.progressTo(2750))

    expect(mediaSession.positionState).toEqual({ position: 2700, duration: 2700, playbackRate: 1 })
  })

  it('shows the playback speed, so the OS can move its progress bar on at the right pace', async () => {
    const { mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    await user.click(screen.getByRole('button', { name: /Change speed/ }))

    fireEvent.change(screen.getByRole('slider', { name: 'Playback speed' }), { target: { value: '1.45' } })

    expect(mediaSession.positionState).toMatchObject({ playbackRate: 1.45 })
  })

  it('shows it paused when paused in the app', async () => {
    const { mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Pause' }))

    expect(mediaSession.playbackState).toBe('paused')
  })

  it('clears everything on sign out', async () => {
    const { mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    await chooseLibraryAction(user, 'Sign out')

    await screen.findByRole('heading', { name: 'Sign in to TinCan' })
    expect(mediaSession.metadata).toBeNull()
    expect(mediaSession.playbackState).toBe('none')
    expect(mediaSession.positionState).toBeNull()
    expect(mediaSession.actions()).toEqual([])
  })
})

describe('controlling playback from the OS media controls', () => {
  it('offers play, pause, skip back, skip forward and scrubbing, and no track skipping while nothing is queued', async () => {
    const { mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    // On iOS, next and previous track controls would take the place of the skip
    // buttons. Next is offered once something is queued (see Queue.test.tsx).
    expect(mediaSession.actions().sort()).toEqual(['pause', 'play', 'seekbackward', 'seekforward', 'seekto'])
  })

  it('pauses and plays', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))

    act(() => mediaSession.press('pause'))

    expect(audio.paused).toBe(true)
    expect(mediaSession.playbackState).toBe('paused')
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()

    act(() => mediaSession.press('play'))

    expect(audio.paused).toBe(false)
    expect(mediaSession.playbackState).toBe('playing')
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('skips back 15 seconds and forward 30', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))

    act(() => mediaSession.press('seekbackward'))
    expect(audio.currentTime).toBe(735)
    expect(mediaSession.positionState).toMatchObject({ position: 735 })

    act(() => mediaSession.press('seekforward'))
    expect(audio.currentTime).toBe(765)
    expect(mediaSession.positionState).toMatchObject({ position: 765 })
  })

  it('skips by the amounts chosen in the app', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(750))
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Skip back 15 seconds' }))
    await user.click(screen.getByRole('button', { name: '10 seconds' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    await user.click(screen.getByRole('button', { name: '60 seconds' }))

    act(() => mediaSession.press('seekbackward'))
    expect(audio.currentTime).toBe(740)

    act(() => mediaSession.press('seekforward'))
    expect(audio.currentTime).toBe(800)
  })

  it('seeks to where the lock screen’s scrubber is dragged', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.loadMetadata(2712))

    act(() => mediaSession.scrubTo(1800))

    expect(audio.currentTime).toBe(1800)
    expect(mediaSession.positionState).toMatchObject({ position: 1800 })
  })

  // The lock screen has no list to tap the episode in again, so its play button is the way to try.
  it('tries the file again when play is pressed for an episode that failed to load', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.failToLoad())
    expect(mediaSession.playbackState).toBe('paused')
    expect(within(miniPlayer()).getByRole('alert')).toBeInTheDocument()

    act(() => mediaSession.press('play'))

    expect(audio.loads).toBe(2)
    expect(audio.src).toBe(first.enclosureUrl)
    expect(mediaSession.playbackState).toBe('playing')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('headphone and Bluetooth buttons', () => {
  // A headset's single play/pause button reaches the app as "pause" while the
  // OS shows it playing, and as "play" while it shows it paused.
  it('pause playback, then play it on from the same place', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.progressTo(600))

    expect(mediaSession.playbackState).toBe('playing')
    act(() => mediaSession.press('pause'))
    expect(audio.paused).toBe(true)

    expect(mediaSession.playbackState).toBe('paused')
    act(() => mediaSession.press('play'))
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(600)
  })
})

// On an iPhone, pressing play on the lock screen after a long pause can leave
// the element saying it plays while its position stays put and nothing is heard.
describe('a file that stays stuck after play is pressed', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Plays the first episode to ten minutes in, pauses it, and presses play on the lock screen. */
  async function pressPlayAfterAPause() {
    const shown = await renderShow()
    const { audio, mediaSession, user } = shown
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.loadMetadata(2712))
    act(() => audio.progressTo(600))
    act(() => mediaSession.press('pause'))
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })
    act(() => mediaSession.press('play'))
    return shown
  }

  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

  it('is loaded afresh at the same place and played', async () => {
    const { audio, mediaSession } = await pressPlayAfterAPause()
    expect(audio.loads).toBe(1)

    wait(STUCK_MS)

    expect(audio.loads).toBe(2)
    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.currentTime).toBe(600)
    expect(audio.paused).toBe(false)
    expect(mediaSession.playbackState).toBe('playing')
    expect(mediaSession.metadata).toMatchObject({ title: first.title })
  })

  it('is left alone until then', async () => {
    const { audio } = await pressPlayAfterAPause()

    wait(STUCK_MS - 1)

    expect(audio.loads).toBe(1)
  })

  it('is left alone once it moves', async () => {
    const { audio } = await pressPlayAfterAPause()

    act(() => audio.progressTo(601))
    wait(STUCK_MS)

    expect(audio.loads).toBe(1)
  })

  it('is left alone when paused again', async () => {
    const { audio, mediaSession } = await pressPlayAfterAPause()

    act(() => mediaSession.press('pause'))
    wait(STUCK_MS)

    expect(audio.loads).toBe(1)
    expect(audio.paused).toBe(true)
  })

  it('is loaded afresh only once, however long it stays stuck', async () => {
    const { audio } = await pressPlayAfterAPause()

    wait(STUCK_MS)
    wait(STUCK_MS * 3)

    expect(audio.loads).toBe(2)
  })

  it('is loaded afresh when played from the app too', async () => {
    const { audio, mediaSession, user } = await pressPlayAfterAPause()
    act(() => mediaSession.press('pause'))

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))
    wait(STUCK_MS)

    expect(audio.loads).toBe(2)
  })

  it('is loaded afresh when iOS itself played it on, as it does once a phone call is over', async () => {
    const { audio, mediaSession } = await pressPlayAfterAPause()
    act(() => audio.progressTo(601))
    act(() => mediaSession.press('pause'))

    act(() => void audio.play())
    wait(STUCK_MS)

    expect(audio.loads).toBe(2)
    expect(audio.currentTime).toBe(601)
    expect(audio.paused).toBe(false)
  })

  it('goes in the playback log', async () => {
    const { device } = await pressPlayAfterAPause()

    wait(STUCK_MS)

    expect(device.playbackLog.lines().at(-1)).toMatch(/stuck at 600\.0/)
  })
})

describe('a new episode slow to start', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is left to load, as a slow network is no reason to start over', async () => {
    const { audio, user } = await renderShow()
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] })

    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => void vi.advanceTimersByTime(STUCK_MS * 3))

    expect(audio.loads).toBe(1)
  })
})

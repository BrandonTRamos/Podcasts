import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction } from './test/ui'

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
  render(<App services={{ auth, data, audio, mediaSession, device: new FakeDevice() }} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, mediaSession, user }
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Playback speed' }), '1.5×')

    expect(mediaSession.positionState).toMatchObject({ playbackRate: 1.5 })
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

  it('seeks to where the lock screen’s scrubber is dragged', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.loadMetadata(2712))

    act(() => mediaSession.scrubTo(1800))

    expect(audio.currentTime).toBe(1800)
    expect(mediaSession.positionState).toMatchObject({ position: 1800 })
  })

  it('does nothing harmful when play is pressed for an episode that failed to load', async () => {
    const { audio, mediaSession, user } = await renderShow()
    await user.click(screen.getByRole('button', { name: first.title }))
    act(() => audio.failToLoad())

    act(() => mediaSession.press('play'))

    expect(mediaSession.playbackState).toBe('paused')
    expect(within(miniPlayer()).getByRole('alert')).toBeInTheDocument()
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

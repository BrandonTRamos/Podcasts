import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi } from './test/fakes'

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
  const audio = new FakeAudio()
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio }} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, user }
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

describe('the mini player and now playing', () => {
  it('keeps the mini player on every screen while an episode is loaded', async () => {
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

    await user.click(screen.getByRole('button', { name: 'Close now playing' }))

    expect(screen.getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(miniPlayer()).toHaveTextContent(first.title)
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
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled()

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

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
  })
})

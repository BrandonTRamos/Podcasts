import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', artworkUrl: 'https://cdn.example.com/show/artwork.jpg' }
const first = {
  title: 'Episode 1: The Beginning',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 2700,
  enclosureUrl: 'https://media.example.com/show/ep1.mp3',
}

type User = ReturnType<typeof userEvent.setup>

/** A backend holding one show with one episode, and a device signed in to it. */
async function setUp() {
  const data = fakeDataApi()
  data.ingest(data.seedPodcast('https://feeds.example.com/show.xml', show), [first])
  await fakeAuth(owner).signIn(owner.email, owner.password)
  return { data, device: new FakeDevice() }
}

/** Opens the app on the device, at the library, as a launch of it would. */
async function launch(data: FakeDataApi, device: FakeDevice) {
  const audio = new FakeAudio()
  const { unmount } = render(<App services={{ auth: fakeAuth(owner), data, audio, mediaSession: new FakeMediaSession(), device }} />)
  await screen.findByRole('heading', { level: 1, name: 'Library' })
  await act(async () => {})
  return { audio, user: userEvent.setup(), unmount }
}

async function openShow(user: User) {
  await user.click(within(await screen.findByRole('list', { name: 'Podcasts' })).getByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
}

const miniPlayer = () => screen.getByRole('region', { name: 'Mini player' })

/** Plays the episode, then pauses it 12:30 in, and closes the app. */
async function playThenClose(data: FakeDataApi, device: FakeDevice) {
  const { audio, user, unmount } = await launch(data, device)
  await openShow(user)
  await user.click(within(screen.getByRole('list', { name: 'Episodes' })).getByRole('button', { name: first.title }))
  act(() => audio.loadMetadata(2712))
  act(() => audio.progressTo(750))
  await user.click(within(miniPlayer()).getByRole('button', { name: 'Pause' }))
  unmount()
}

describe('the episode last played', () => {
  it('is ready to play, paused, in the mini player on the library at the next launch', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)

    const { audio } = await launch(data, device)

    expect(await screen.findByRole('region', { name: 'Mini player' })).toHaveTextContent(first.title)
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()
    // Nothing loads or plays until the listener asks.
    expect(audio.src).toBe('')
    expect(audio.paused).toBe(true)
  })

  it('plays on from where the listener left it when Play is tapped', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)

    const { audio, user } = await launch(data, device)
    await user.click(within(await screen.findByRole('region', { name: 'Mini player' })).getByRole('button', { name: 'Play' }))

    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(750)
    expect(within(miniPlayer()).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('shows where it will start in now playing, before it plays', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)

    const { user } = await launch(data, device)
    await user.click(within(await screen.findByRole('region', { name: 'Mini player' })).getByRole('button', { name: new RegExp(first.title) }))

    expect(await screen.findByText('12:30')).toBeInTheDocument()
  })

  it('is not ready after unsubscribing from its podcast', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const relaunched = await launch(data, device)
    await openShow(relaunched.user)
    await relaunched.user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    const dialog = screen.getByRole('alertdialog', { name: `Unsubscribe from ${show.title}?` })
    await relaunched.user.click(within(dialog).getByRole('button', { name: 'Unsubscribe' }))
    relaunched.unmount()

    await launch(data, device)

    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()
  })

  it('is forgotten on signing out', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const relaunched = await launch(data, device)
    await chooseLibraryAction(relaunched.user, 'Sign out')
    relaunched.unmount()
    await fakeAuth(owner).signIn(owner.email, owner.password)

    await launch(data, device)

    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()
  })
})

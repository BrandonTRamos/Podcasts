import { act, render, screen, waitFor, within } from '@testing-library/react'
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
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [firstId] = data.ingest(podcastId, [first])
  await fakeAuth(owner).signIn(owner.email, owner.password)
  return { data, podcastId, firstId, device: new FakeDevice() }
}

/** Opens the app on the device, at the library, as a launch of it would. */
async function launch(data: FakeDataApi, device: FakeDevice, audio = new FakeAudio()) {
  const mediaSession = new FakeMediaSession()
  const { unmount } = render(<App services={{ auth: fakeAuth(owner), data, audio, mediaSession, device }} />)
  await screen.findByRole('heading', { level: 1, name: 'Library' })
  await act(async () => {})
  return { audio, mediaSession, user: userEvent.setup(), unmount }
}

async function openShow(user: User) {
  await user.click(within(await screen.findByRole('list', { name: 'Podcasts' })).getByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
}

const miniPlayer = () => screen.getByRole('region', { name: 'Mini player' })

/** Whether this part of the screen tells the listener, and assistive technology, that the episode is loading. */
function showsLoading(region: HTMLElement) {
  return within(region)
    .queryAllByRole('status')
    .some((status) => status.textContent === 'Loading')
}

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

    const { audio, mediaSession } = await launch(data, device)

    expect(await screen.findByRole('region', { name: 'Mini player' })).toHaveTextContent(first.title)
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(within(miniPlayer()).queryByText('Loading')).not.toBeInTheDocument()
    expect(mediaSession.playbackState).toBe('paused')
    // Its file is loaded, paused where it will start, but nothing plays until the listener asks.
    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.preload).toBe('metadata')
    expect(audio.currentTime).toBe(750)
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

  it('plays on the file loaded at launch, without loading it afresh', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const { audio, user } = await launch(data, device)
    act(() => audio.loadMetadata(2712))

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))

    expect(audio.loads).toBe(1)
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(750)
    // Played, the browser may fetch as much of it as it likes.
    expect(audio.preload).toBe('auto')
  })

  it('shows as loading from play until its position first moves, though its metadata had loaded', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const { audio, user } = await launch(data, device)
    act(() => audio.loadMetadata(2712))

    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))

    expect(showsLoading(miniPlayer())).toBe(true)
    act(() => audio.progressTo(750.25))
    expect(showsLoading(miniPlayer())).toBe(false)
  })

  it('shows no failure, and saves nothing, if its file fails to load before it is played; it loads again when played', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const { audio, user } = await launch(data, device)
    const writes = data.stateWrites().length

    act(() => audio.failToLoad())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(miniPlayer()).getByRole('button', { name: 'Play' })).toBeEnabled()
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))
    expect(audio.loads).toBe(2)
    expect(audio.src).toBe(first.enclosureUrl)
    expect(audio.currentTime).toBe(750)
    expect(audio.paused).toBe(false)
    expect(data.stateWrites()).toHaveLength(writes)
  })

  it('shows where it will start in now playing, before it plays', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)

    const { user } = await launch(data, device)
    await user.click(within(await screen.findByRole('region', { name: 'Mini player' })).getByRole('button', { name: new RegExp(first.title) }))

    expect(await screen.findByText('12:30')).toBeInTheDocument()
  })

  it('shows where it will start before its metadata has loaded, though the browser holds seeks until then', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const audio = new FakeAudio()
    audio.ignoreEarlySeeks()

    const { user } = await launch(data, device, audio)
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))

    expect(await screen.findByText('12:30')).toBeInTheDocument()
    act(() => audio.loadMetadata(2712))
    expect(audio.currentTime).toBe(750)
  })

  it('starts where the listener sought to before playing it', async () => {
    const { data, device } = await setUp()
    await playThenClose(data, device)
    const { audio, user } = await launch(data, device)
    // Seeks made before the file's metadata has loaded are ignored, as by some browsers.
    audio.ignoreEarlySeeks()
    await user.click(within(miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))

    await user.click(screen.getByRole('button', { name: 'Skip forward 30 seconds' }))
    expect(await screen.findByText('13:00')).toBeInTheDocument()
    act(() => audio.loadMetadata(2712))
    await user.click(screen.getByRole('button', { name: 'Play' }))

    expect(audio.loads).toBe(1)
    expect(audio.currentTime).toBe(780)
    expect(audio.paused).toBe(false)
  })

  it('moves to a place saved on another device before it is played', async () => {
    const { data, device, podcastId, firstId } = await setUp()
    await playThenClose(data, device)
    const { audio, user } = await launch(data, device)
    act(() => audio.loadMetadata(2712))

    await act(() => data.anotherDevice().saveEpisodeState(firstId, podcastId, { positionSeconds: 1500 }, new Date().toISOString()))
    await waitFor(() => expect(audio.currentTime).toBe(1500))
    await user.click(within(miniPlayer()).getByRole('button', { name: 'Play' }))

    expect(audio.loads).toBe(1)
    expect(audio.currentTime).toBe(1500)
    expect(audio.paused).toBe(false)
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

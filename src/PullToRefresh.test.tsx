import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const showUrl = 'https://feeds.example.com/show.xml'
const otherUrl = 'https://feeds.other.example.com/other.xml'

async function renderSignedIn(data: ReturnType<typeof fakeDataApi>, device = new FakeDevice()) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  return user
}

/** Drags a finger down the page from near its top by `distance`, then lets go. */
async function pull(distance: number) {
  const at = (y: number) => ({ touches: [{ clientX: 150, clientY: y }], changedTouches: [{ clientX: 150, clientY: y }] })
  fireEvent.touchStart(window, at(100))
  for (let y = 100; y <= 100 + distance; y += 20) fireEvent.touchMove(window, at(y))
  fireEvent.touchMove(window, at(100 + distance))
  fireEvent.touchEnd(window, { touches: [], changedTouches: [{ clientX: 150, clientY: 100 + distance }] })
  await act(() => Promise.resolve())
}

afterEach(() => {
  vi.useRealTimers()
})

describe('pulling down to refresh', () => {
  it('asks for every podcast’s feed to be refreshed, showing it refreshing meanwhile', async () => {
    const data = fakeDataApi()
    const showId = data.seedPodcast(showUrl, { title: 'The Example Show' })
    const otherId = data.seedPodcast(otherUrl, { title: 'The Other Show' })
    await renderSignedIn(data)
    await screen.findByRole('button', { name: /The Example Show/ })

    await pull(300)

    expect(screen.getByRole('status')).toHaveTextContent('Refreshing…')
    expect([...data.refreshRequests()].sort()).toEqual([showId, otherId].sort())
    await vi.waitFor(() => expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument())
  })

  it('catches up on what changed while live updates were missed', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    await renderSignedIn(data)
    await screen.findByRole('button', { name: /The Example Show/ })

    // Added while the app was suspended, so its live update never arrived.
    data.sleep()
    act(() => void data.seedPodcast(otherUrl, { title: 'The Other Show' }))
    data.wake()
    expect(screen.queryByRole('button', { name: /The Other Show/ })).not.toBeInTheDocument()

    await pull(300)

    expect(await screen.findByRole('button', { name: /The Other Show/ })).toBeInTheDocument()
  })

  it('moves the whole screen down with the finger, and back up once let go', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    await renderSignedIn(data)
    const library = screen.getByRole('main')
    const offset = () => Number.parseFloat(getComputedStyle(library.closest('.pull-refresh')!).getPropertyValue('--pull'))
    const at = (y: number) => ({ touches: [{ clientX: 150, clientY: y }] })

    fireEvent.touchStart(window, at(100))
    fireEvent.touchMove(window, at(160))
    const partway = offset()
    fireEvent.touchMove(window, at(260))

    expect(partway).toBeGreaterThan(0)
    expect(offset()).toBeGreaterThan(partway)
    expect(library.closest('.pull-refresh-screen')).not.toBeNull()

    fireEvent.touchEnd(window, { touches: [] })
    await act(() => Promise.resolve())
    await vi.waitFor(() => expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument())
    expect(offset()).toBe(0)
  })

  it('does nothing when let go before pulling far enough', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    await renderSignedIn(data)
    await screen.findByRole('button', { name: /The Example Show/ })

    await pull(60)

    expect(data.refreshRequests()).toEqual([])
    expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument()
  })

  it('says it couldn’t refresh when offline, and keeps the library as it was', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    const device = new FakeDevice()
    await renderSignedIn(data, device)
    await screen.findByRole('button', { name: /The Example Show/ })
    act(() => {
      data.disconnect()
      device.goOffline()
    })

    await pull(300)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh. Check your connection and try again.')
    expect(data.refreshRequests()).toEqual([])
    expect(screen.getByRole('button', { name: /The Example Show/ })).toBeInTheDocument()
  })

  it('says it couldn’t refresh when a podcast couldn’t be asked', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    await renderSignedIn(data)
    await screen.findByRole('button', { name: /The Example Show/ })
    data.failNextRequest()

    await pull(300)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t refresh.')
  })

  it('works from the latest episodes too, but not from an open podcast', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { title: 'The Example Show' })
    const user = await renderSignedIn(data)

    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Latest' }))
    await pull(300)
    expect(data.refreshRequests()).toHaveLength(1)

    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Library' }))
    await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
    await screen.findByRole('heading', { name: 'The Example Show', level: 1 })
    await vi.waitFor(() => expect(screen.queryByText('Refreshing…')).not.toBeInTheDocument())
    await pull(300)
    expect(data.refreshRequests()).toHaveLength(1)
  })
})

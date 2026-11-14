import { act, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import type { DataApi } from './services'
import { FakeAudio, fakeAuth, fakeDataApi, FakeMediaSession } from './test/fakes'

// The queue: episodes lined up to play one after another, the same on every device.

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

/** A backend holding one show with three episodes. */
function backendWithShow() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast(feedUrl, show)
  const [firstId, secondId, thirdId] = data.ingest(podcastId, [first, second, third])
  return { data, podcastId, firstId, secondId, thirdId }
}

/**
 * Opens TinCan signed in on a device, at the show's page. Each device gets its
 * own audio element, media controls and part of the page, so two can be open at once.
 */
async function openShowOn(data: DataApi) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  const mediaSession = new FakeMediaSession()
  const container = document.body.appendChild(document.createElement('div'))
  render(<App services={{ auth, data, audio, mediaSession }} />, { container })
  const ui = within(container)
  const user = userEvent.setup()
  await user.click(await ui.findByRole('button', { name: /The Example Show/ }))
  await ui.findByRole('list', { name: 'Episodes' })

  const device = {
    audio,
    mediaSession,
    user,
    ui,
    /** The episode's entry in the show's list. */
    row(title: string) {
      const items = within(ui.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
      const item = items.find((li) => within(li).queryByRole('heading', { name: title }))
      if (!item) throw new Error(`No episode "${title}" in the list`)
      return item
    },
    /** Taps the episode in the show's list. */
    async tap(title: string) {
      await user.click(within(ui.getByRole('list', { name: 'Episodes' })).getByRole('button', { name: title }))
    },
    async addToQueue(title: string) {
      await user.click(within(device.row(title)).getByRole('button', { name: 'Add to queue' }))
    },
    async playNext(title: string) {
      await user.click(within(device.row(title)).getByRole('button', { name: 'Play next' }))
    },
    /** Goes from the show's page to the queue. */
    async openQueue() {
      await user.click(ui.getByRole('button', { name: 'Back to library' }))
      await user.click(await ui.findByRole('button', { name: 'Queue' }))
      await ui.findByRole('heading', { name: 'Queue' })
    },
    /** The titles in the queue, in order, as the queue screen shows them. */
    queued() {
      const list = ui.queryByRole('list', { name: 'Queued episodes' })
      if (!list) return []
      return within(list)
        .getAllByRole('listitem')
        .map((item) => within(item).getByRole('heading').textContent)
    },
    queueEntry(title: string) {
      const items = within(ui.getByRole('list', { name: 'Queued episodes' })).getAllByRole('listitem')
      const item = items.find((li) => within(li).queryByRole('heading', { name: title }))
      if (!item) throw new Error(`No episode "${title}" in the queue`)
      return item
    },
    miniPlayer: () => ui.getByRole('region', { name: 'Mini player' }),
  }
  return device
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('lining up episodes', () => {
  it('starts with nothing queued', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)

    await device.openQueue()

    expect(device.queued()).toEqual([])
    expect(device.ui.getByText('Nothing queued.')).toBeInTheDocument()
  })

  it('adds episodes to the end of the queue', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)

    await device.addToQueue(second.title)
    await device.addToQueue(first.title)
    await device.openQueue()

    expect(device.queued()).toEqual([second.title, first.title])
    expect(device.queueEntry(second.title)).toHaveTextContent(show.title)
  })

  it('adds an episode to play next, ahead of those already queued', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)

    await device.addToQueue(first.title)
    await device.addToQueue(second.title)
    await device.playNext(third.title)
    await device.openQueue()

    expect(device.queued()).toEqual([third.title, first.title, second.title])
  })

  it('moves an episode already queued rather than queueing it twice', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)

    await device.addToQueue(first.title)
    await device.addToQueue(second.title)
    await device.addToQueue(first.title)
    await device.openQueue()

    expect(device.queued()).toEqual([second.title, first.title])
  })

  it('shows which episodes in the show are queued', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)

    await device.addToQueue(first.title)

    expect(within(device.row(first.title)).getByText('Queued')).toBeInTheDocument()
    expect(within(device.row(second.title)).queryByText('Queued')).not.toBeInTheDocument()
  })
})

describe('editing the queue', () => {
  async function withThreeQueued() {
    const backend = backendWithShow()
    const device = await openShowOn(backend.data)
    await device.addToQueue(first.title)
    await device.addToQueue(second.title)
    await device.addToQueue(third.title)
    await device.openQueue()
    return { ...backend, device }
  }

  it('moves an episode up and down', async () => {
    const { device } = await withThreeQueued()

    await device.user.click(within(device.queueEntry(third.title)).getByRole('button', { name: 'Move up' }))
    expect(device.queued()).toEqual([first.title, third.title, second.title])

    await device.user.click(within(device.queueEntry(first.title)).getByRole('button', { name: 'Move down' }))
    expect(device.queued()).toEqual([third.title, first.title, second.title])
  })

  it('cannot move the first episode up or the last one down', async () => {
    const { device } = await withThreeQueued()

    expect(within(device.queueEntry(first.title)).getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(within(device.queueEntry(third.title)).getByRole('button', { name: 'Move down' })).toBeDisabled()
  })

  it('keeps the order through many moves between the same two episodes', async () => {
    const { device } = await withThreeQueued()

    for (let i = 0; i < 60; i++) {
      await device.user.click(within(device.queueEntry(third.title)).getByRole('button', { name: 'Move up' }))
      await device.user.click(within(device.queueEntry(third.title)).getByRole('button', { name: 'Move down' }))
    }
    await device.user.click(within(device.queueEntry(third.title)).getByRole('button', { name: 'Move up' }))

    expect(device.queued()).toEqual([first.title, third.title, second.title])
  })

  it('removes an episode', async () => {
    const { data, secondId, device } = await withThreeQueued()

    await device.user.click(within(device.queueEntry(second.title)).getByRole('button', { name: 'Remove' }))

    expect(device.queued()).toEqual([first.title, third.title])
    expect(data.savedState(secondId)).toMatchObject({ queueOrder: null })
  })

  it('plays a queued episode when it is tapped, and takes it off the queue', async () => {
    const { device } = await withThreeQueued()

    await device.user.click(within(device.queueEntry(second.title)).getByRole('button', { name: second.title }))

    expect(device.audio.src).toBe(second.enclosureUrl)
    expect(device.audio.paused).toBe(false)
    expect(device.queued()).toEqual([first.title, third.title])
  })

  it('takes an episode off the queue when it is played from the show', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(first.title)
    await device.addToQueue(second.title)

    await device.tap(first.title)
    await device.openQueue()

    expect(device.queued()).toEqual([second.title])
  })
})

describe('carrying on to the next episode', () => {
  it('starts the next queued episode when one ends, and takes it off the queue', async () => {
    const { data, firstId, secondId } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.addToQueue(third.title)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))

    act(() => device.audio.playToEnd())

    expect(device.audio.src).toBe(second.enclosureUrl)
    expect(device.audio.paused).toBe(false)
    expect(device.miniPlayer()).toHaveTextContent(second.title)
    expect(data.savedState(firstId)).toMatchObject({ played: true })
    await act(async () => {})
    expect(data.savedState(secondId)).toMatchObject({ queueOrder: null })
    await device.openQueue()
    expect(device.queued()).toEqual([third.title])
  })

  it('goes through the queue in order', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.addToQueue(third.title)
    await device.tap(first.title)

    act(() => device.audio.loadMetadata(2712))
    act(() => device.audio.playToEnd())
    act(() => device.audio.loadMetadata(3723))
    act(() => device.audio.playToEnd())

    expect(device.audio.src).toBe(third.enclosureUrl)
    expect(device.audio.paused).toBe(false)
  })

  it('starts the next episode where it was left, if it was part-played', async () => {
    const { data, podcastId, secondId } = backendWithShow()
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 1200, played: false })
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))

    act(() => device.audio.playToEnd())

    expect(device.audio.src).toBe(second.enclosureUrl)
    expect(device.audio.currentTime).toBe(1200)
  })

  it('stops at the end of the episode when nothing is queued', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))

    act(() => device.audio.playToEnd())

    expect(device.audio.src).toBe(first.enclosureUrl)
    expect(device.audio.paused).toBe(true)
    expect(within(device.miniPlayer()).getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  // iOS throttles scripts while the screen is locked, so anything awaited
  // before the next file is set can stall the queue.
  it('sets the next episode playing within the end of the last, with nothing awaited first', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))
    let atEnd: { src: string; playing: boolean } | undefined
    // Added after the app's own listener, so it runs straight after it.
    device.audio.addEventListener('ended', () => (atEnd = { src: device.audio.src, playing: !device.audio.paused }))

    act(() => device.audio.playToEnd())

    expect(atEnd).toEqual({ src: second.enclosureUrl, playing: true })
  })

  it('needs no network to move on to the next episode', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.addToQueue(third.title)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))
    data.goOffline()

    act(() => device.audio.playToEnd())

    expect(device.audio.src).toBe(second.enclosureUrl)
    expect(device.audio.paused).toBe(false)
    await act(async () => {})
    await device.openQueue()
    expect(device.queued()).toEqual([third.title])
  })
})

describe('the same queue on every device', () => {
  it('shows the queue on a second device as it was left on the first', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.addToQueue(first.title)
    await phone.addToQueue(second.title)
    await phone.playNext(third.title)

    const desktop = await openShowOn(data.anotherDevice())
    await desktop.openQueue()

    expect(desktop.queued()).toEqual([third.title, first.title, second.title])
  })

  it('shows changes made on another device while both are open', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.openQueue()
    const desktop = await openShowOn(data.anotherDevice())

    await desktop.addToQueue(first.title)
    await desktop.addToQueue(second.title)
    await act(async () => {})
    expect(phone.queued()).toEqual([first.title, second.title])

    await desktop.openQueue()
    await desktop.user.click(within(desktop.queueEntry(first.title)).getByRole('button', { name: 'Remove' }))
    await act(async () => {})
    expect(phone.queued()).toEqual([second.title])
  })

  it('catches up with changes made elsewhere while the app was in the background', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.addToQueue(first.title)
    await phone.addToQueue(second.title)
    await phone.openQueue()
    setVisibility('hidden')
    data.sleep()
    const desktop = await openShowOn(data.anotherDevice())
    await desktop.openQueue()
    await desktop.user.click(within(desktop.queueEntry(first.title)).getByRole('button', { name: 'Remove' }))
    await desktop.user.click(desktop.ui.getByRole('button', { name: 'Back to library' }))
    await desktop.user.click(await desktop.ui.findByRole('button', { name: /The Example Show/ }))
    await desktop.ui.findByRole('list', { name: 'Episodes' })
    await desktop.addToQueue(third.title)

    data.wake()
    setVisibility('visible')
    await act(async () => {})

    expect(phone.queued()).toEqual([second.title, third.title])
  })

  it('plays on into an episode queued on another device', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.tap(first.title)
    act(() => phone.audio.loadMetadata(2712))
    const desktop = await openShowOn(data.anotherDevice())
    await desktop.addToQueue(third.title)
    await act(async () => {})

    act(() => phone.audio.playToEnd())

    expect(phone.audio.src).toBe(third.enclosureUrl)
    expect(phone.audio.paused).toBe(false)
  })
})

describe('the next control on the OS media controls', () => {
  it('is offered only while something is queued', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)

    // Without a queue, the OS keeps its skip-forward button in that place.
    expect(device.mediaSession.actions()).not.toContain('nexttrack')

    await device.addToQueue(second.title)
    expect(device.mediaSession.actions()).toContain('nexttrack')

    act(() => device.mediaSession.press('nexttrack'))
    expect(device.mediaSession.actions()).not.toContain('nexttrack')
  })

  it('skips to the next queued episode, keeping the place in the one skipped', async () => {
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.addToQueue(second.title)
    await device.addToQueue(third.title)
    await device.tap(first.title)
    act(() => device.audio.progressTo(600))

    act(() => device.mediaSession.press('nexttrack'))

    expect(device.audio.src).toBe(second.enclosureUrl)
    expect(device.audio.paused).toBe(false)
    expect(device.mediaSession.metadata).toMatchObject({ title: second.title })
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600, played: false })
    await device.openQueue()
    expect(device.queued()).toEqual([third.title])
  })
})

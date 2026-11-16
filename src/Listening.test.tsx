import { act, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { DataApi } from './services'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction } from './test/ui'

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

/** A backend holding one show with two episodes. */
function backendWithShow() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast(feedUrl, show)
  const [firstId, secondId] = data.ingest(podcastId, [first, second])
  return { data, podcastId, firstId, secondId }
}

/**
 * Opens TinCan signed in on a device, at the show's page. Each device gets its
 * own audio element and its own part of the page, so two can be open at once.
 */
async function openShowOn(data: DataApi) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  const container = document.body.appendChild(document.createElement('div'))
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />, { container })
  const ui = within(container)
  const user = userEvent.setup()
  await user.click(await ui.findByRole('button', { name: /The Example Show/ }))
  await ui.findByRole('list', { name: 'Episodes' })

  return {
    audio,
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
    miniPlayer: () => ui.getByRole('region', { name: 'Mini player' }),
  }
}

/** Sets the date, leaving timers real. Undone after each test. */
function setToday(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse(iso))
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
})

describe('saving the position', () => {
  it('saves it when playback is paused', async () => {
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.progressTo(600))

    await device.user.click(within(device.miniPlayer()).getByRole('button', { name: 'Pause' }))

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600, played: false })
  })

  it('saves it when the app goes to the background, and carries on playing', async () => {
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.progressTo(754))

    setVisibility('hidden')

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 754, played: false })
    expect(device.audio.paused).toBe(false)
  })

  it('saves where the last episode got to when another is started', async () => {
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.progressTo(321))

    await device.tap(second.title)

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 321, played: false })
  })

  it('saves at most once every 60 seconds during continuous playback', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.parse('2026-11-14T09:00:00.000Z')
    vi.setSystemTime(start)
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)

    // The element reports progress several times a second; each second the
    // backend has answered any save, as it would long before the next is due.
    for (let tenths = 1; tenths <= 1850; tenths++) {
      vi.setSystemTime(start + tenths * 100)
      act(() => device.audio.progressTo(tenths / 10))
      if (tenths % 10 === 0) await act(async () => {})
    }

    expect(data.stateWrites().map((write) => write.positionSeconds)).toEqual([60, 120, 180])
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 180, played: false })
    // Nearly two thousand renders: about 2s alone, but past the default 5s when every test file runs at once.
  }, 15_000)
})

describe('resuming', () => {
  it('opens a part-played episode at the saved position', async () => {
    const { data, podcastId, firstId } = backendWithShow()
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 600, played: false })
    const device = await openShowOn(data)

    await device.tap(first.title)

    expect(device.audio.src).toBe(first.enclosureUrl)
    expect(device.audio.currentTime).toBe(600)
    expect(device.audio.paused).toBe(false)
    act(() => device.audio.loadMetadata(2712))
    expect(device.audio.currentTime).toBe(600)
    await device.user.click(within(device.miniPlayer()).getByRole('button', { name: new RegExp(first.title) }))
    expect(device.ui.getByRole('slider', { name: 'Seek' })).toHaveValue('600')
    expect(device.ui.getByText('10:00')).toBeInTheDocument()
  })

  it('keeps the saved position on a browser that ignores a seek before the file has loaded', async () => {
    const { data, podcastId, firstId } = backendWithShow()
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 600, played: false })
    const device = await openShowOn(data)
    device.audio.ignoreEarlySeeks()

    await device.tap(first.title)
    await device.user.click(within(device.miniPlayer()).getByRole('button', { name: 'Pause' }))

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600 })
    act(() => device.audio.loadMetadata(2712))
    expect(device.audio.currentTime).toBe(600)
  })

  it('picks up where it was left after something else was played', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.progressTo(600))
    await device.tap(second.title)
    act(() => device.audio.progressTo(30))

    await device.tap(first.title)

    expect(device.audio.src).toBe(first.enclosureUrl)
    expect(device.audio.currentTime).toBe(600)
  })

  it('starts a played episode from the beginning', async () => {
    const { data, podcastId, firstId } = backendWithShow()
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 2700, played: true })
    const device = await openShowOn(data)

    await device.tap(first.title)

    expect(device.audio.currentTime).toBe(0)
    expect(device.audio.paused).toBe(false)
  })
})

describe('following the listener between devices', () => {
  it('opens an episode on one device where another left it', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    const desktop = await openShowOn(data.anotherDevice())
    await desktop.tap(first.title)
    act(() => desktop.audio.progressTo(1500))
    await desktop.user.click(within(desktop.miniPlayer()).getByRole('button', { name: 'Pause' }))

    await phone.tap(first.title)

    expect(phone.audio.currentTime).toBe(1500)
  })

  it('catches up with what another device saved while the app was in the background', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    setVisibility('hidden')
    data.sleep()
    const desktop = await openShowOn(data.anotherDevice())
    await desktop.tap(first.title)
    act(() => desktop.audio.progressTo(1500))
    await desktop.user.click(within(desktop.miniPlayer()).getByRole('button', { name: 'Pause' }))

    data.wake()
    setVisibility('visible')

    expect(await within(phone.row(first.title)).findByText('20 min left')).toBeInTheDocument()
    await phone.tap(first.title)
    expect(phone.audio.currentTime).toBe(1500)
  })

  it('keeps an episode marked played on another device played when this one saves its position', async () => {
    const { data, firstId } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.tap(first.title)
    act(() => phone.audio.progressTo(600))
    data.sleep()
    const desktop = await openShowOn(data.anotherDevice())
    await chooseAction(desktop.user, desktop.row(first.title), 'Mark played')

    await phone.user.click(within(phone.miniPlayer()).getByRole('button', { name: 'Pause' }))

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 600, played: true })
  })

  it('moves an episode left paused on to where another device got to', async () => {
    const { data } = backendWithShow()
    const phone = await openShowOn(data)
    await phone.tap(first.title)
    act(() => phone.audio.progressTo(600))
    await phone.user.click(within(phone.miniPlayer()).getByRole('button', { name: 'Pause' }))
    setVisibility('hidden')
    data.sleep()
    const desktop = await openShowOn(data.anotherDevice())
    await desktop.tap(first.title)
    expect(desktop.audio.currentTime).toBe(600)
    act(() => desktop.audio.progressTo(1500))
    await desktop.user.click(within(desktop.miniPlayer()).getByRole('button', { name: 'Pause' }))

    data.wake()
    setVisibility('visible')
    await within(phone.row(first.title)).findByText('20 min left')
    await phone.user.click(within(phone.miniPlayer()).getByRole('button', { name: 'Play' }))

    expect(phone.audio.currentTime).toBe(1500)
    expect(phone.audio.paused).toBe(false)
  })
})

describe('played state', () => {
  it('marks an episode played when it plays to the end', async () => {
    const { data, firstId } = backendWithShow()
    const device = await openShowOn(data)
    await device.tap(first.title)
    act(() => device.audio.loadMetadata(2712))

    act(() => device.audio.playToEnd())

    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 2712, played: true })
    expect(await within(device.row(first.title)).findByText('Played')).toBeInTheDocument()
  })

  it('lets the listener mark an episode played, and unplayed again', async () => {
    setToday('2026-11-05T09:00:00.000Z')
    const { data, podcastId, firstId } = backendWithShow()
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 900, played: false })
    const device = await openShowOn(data)

    await chooseAction(device.user, device.row(first.title), 'Mark played')

    expect(within(device.row(first.title)).getByText('Played')).toBeInTheDocument()
    expect(data.savedState(firstId)).toMatchObject({ played: true })

    await chooseAction(device.user, device.row(first.title), 'Mark unplayed')

    expect(within(device.row(first.title)).getByText('New')).toBeInTheDocument()
    expect(within(device.row(first.title)).queryByText('Played')).not.toBeInTheDocument()
    expect(data.savedState(firstId)).toMatchObject({ positionSeconds: 0, played: false })
  })

  it('keeps showing a change whose save failed', async () => {
    const { data } = backendWithShow()
    const device = await openShowOn(data)
    data.failNextRequest()

    await chooseAction(device.user, device.row(first.title), 'Mark played')
    await act(async () => {})

    expect(within(device.row(first.title)).getByText('Played')).toBeInTheDocument()
  })

  it('shows which episodes are played, how far through part-played ones are, and which are new', async () => {
    setToday('2026-11-14T09:00:00.000Z')
    const { data, podcastId, firstId, secondId } = backendWithShow()
    data.ingest(podcastId, [third])
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 900, played: false })
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 3723, played: true })
    const device = await openShowOn(data)

    const partPlayed = device.row(first.title)
    expect(within(partPlayed).getByRole('progressbar', { name: 'Listened' })).toHaveAttribute('value', '900')
    expect(within(partPlayed).getByRole('progressbar', { name: 'Listened' })).toHaveAttribute('max', '2700')
    expect(partPlayed).toHaveTextContent('30 min left')
    expect(within(device.row(second.title)).getByText('Played')).toBeInTheDocument()
    expect(within(device.row(second.title)).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(device.row(third.title)).getByText('New')).toBeInTheDocument()
    expect(within(device.row(third.title)).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('calls an episode new only for a week after it came out', async () => {
    setToday('2026-11-14T09:00:00.000Z')
    const { data, podcastId } = backendWithShow()
    data.ingest(podcastId, [{ ...third, title: 'Undated', publishedAt: null }])
    const device = await openShowOn(data)

    expect(within(device.row(second.title)).getByText('New')).toBeInTheDocument()
    // Eleven days old and never started: neither new nor played.
    expect(within(device.row(first.title)).queryByText('New')).not.toBeInTheDocument()
    expect(within(device.row(first.title)).queryByText('Played')).not.toBeInTheDocument()
    expect(device.row(first.title)).toHaveTextContent('45 min')
    expect(within(device.row('Undated')).queryByText('New')).not.toBeInTheDocument()
  })

  it('stops calling an episode new once it is started or played', async () => {
    setToday('2026-11-14T09:00:00.000Z')
    const { data, podcastId, secondId } = backendWithShow()
    data.ingest(podcastId, [third])
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 60, played: false })
    const device = await openShowOn(data)

    expect(within(device.row(second.title)).queryByText('New')).not.toBeInTheDocument()

    await chooseAction(device.user, device.row(third.title), 'Mark played')

    expect(within(device.row(third.title)).queryByText('New')).not.toBeInTheDocument()
  })

  it('filters the list to unplayed episodes', async () => {
    const { data, podcastId, firstId, secondId } = backendWithShow()
    data.ingest(podcastId, [third])
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 900, played: false })
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 3723, played: true })
    const device = await openShowOn(data)
    const titles = () =>
      within(device.ui.getByRole('list', { name: 'Episodes' }))
        .getAllByRole('heading')
        .map((heading) => heading.textContent)

    await device.user.click(device.ui.getByRole('checkbox', { name: 'Unplayed only' }))

    expect(titles()).toEqual([third.title, first.title])

    await chooseAction(device.user, device.row(third.title), 'Mark played')
    expect(titles()).toEqual([first.title])

    await device.user.click(device.ui.getByRole('checkbox', { name: 'Unplayed only' }))
    expect(titles()).toEqual([third.title, second.title, first.title])
  })

  it('says so when every episode has been played', async () => {
    const { data, podcastId, firstId, secondId } = backendWithShow()
    data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 2700, played: true })
    data.seedEpisodeState({ episodeId: secondId, podcastId, positionSeconds: 3723, played: true })
    const device = await openShowOn(data)

    await device.user.click(device.ui.getByRole('checkbox', { name: 'Unplayed only' }))

    expect(device.ui.getByText('No unplayed episodes.')).toBeInTheDocument()
  })
})

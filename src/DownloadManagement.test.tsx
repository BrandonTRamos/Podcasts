import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openActions } from './test/ui'

// Managing downloads: what is stored on this device, how much room it takes,
// and freeing it; and badges that stay true when the OS clears a download.

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show' }
const other = { title: 'Another Show' }
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
const elsewhere = {
  title: 'Elsewhere 1: Hello',
  publishedAt: '2026-11-05T08:00:00.000Z',
  durationSeconds: 1800,
  enclosureUrl: 'https://media.example.com/other/1.mp3',
}

/** Stand-in audio: a file of this many bytes, each different from its neighbours. */
function audioFile(length: number) {
  return Uint8Array.from({ length }, (_, i) => i % 251)
}

const firstFile = audioFile(1000)
const secondFile = audioFile(2500)
const elsewhereFile = audioFile(1500)

/** Two shows, every episode on a host that allows direct download, and a device to download them to. */
async function setUp() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const otherId = data.seedPodcast('https://feeds.example.com/other.xml', other)
  data.ingest(podcastId, [first, second])
  data.ingest(otherId, [elsewhere])
  const device = new FakeDevice()
  device.network.host(first.enclosureUrl, firstFile)
  device.network.host(second.enclosureUrl, secondFile)
  device.network.host(elsewhere.enclosureUrl, elsewhereFile)
  await fakeAuth(owner).signIn(owner.email, owner.password)
  return { data, device, ...(await launch(data, device)) }
}

/** Opens the app, already signed in, at the library, as a fresh launch of it on this device would. */
async function launch(data: FakeDataApi, device: FakeDevice) {
  const audio = new FakeAudio()
  const services = { auth: fakeAuth(owner), data, audio, mediaSession: new FakeMediaSession(), device }
  const { unmount } = render(<App services={services} />)
  await screen.findByRole('list', { name: 'Podcasts' })
  return { audio, user: userEvent.setup(), unmount }
}

type User = ReturnType<typeof userEvent.setup>

/** Opens the show's page, from wherever the listener is. */
async function openShow(user: User, title: string) {
  if (screen.queryByRole('heading', { level: 1, name: title })) return
  await user.click(screen.getByRole('button', { name: 'Library' }))
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }))
  await screen.findByRole('list', { name: 'Episodes' })
}

async function openDownloads(user: User) {
  await user.click(screen.getByRole('button', { name: 'Downloads' }))
  await screen.findByRole('heading', { level: 1, name: 'Downloads' })
}

/** The episode's entry in whichever list on screen holds it. */
function row(title: string) {
  const item = screen.getAllByRole('listitem').find((li) => within(li).queryByText(title))
  if (!item) throw new Error(`No episode "${title}" on screen`)
  return item
}

/** The titles in a list on the downloads screen, or none if it isn't shown. */
function titlesIn(name: string) {
  const list = screen.queryByRole('list', { name })
  return list ? within(list).getAllByRole('listitem').map((li) => within(li).getByRole('heading').textContent) : []
}

/** Downloads the episode from its show's page, and waits for it to finish. */
async function download(user: User, showTitle: string, title: string) {
  await openShow(user, showTitle)
  await chooseAction(user, row(title), 'Download')
  await within(row(title)).findByText('Downloaded', {}, { timeout: 3000 })
}

describe('the downloads screen', () => {
  it('says when nothing is downloaded', async () => {
    const { user } = await setUp()

    await openDownloads(user)

    expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument()
  })

  it('lists each downloaded episode with its podcast and size, and the total space used', async () => {
    const { user } = await setUp()
    await download(user, show.title, first.title)
    await download(user, show.title, second.title)

    await openDownloads(user)

    expect(titlesIn('Downloaded episodes')).toEqual([first.title, second.title])
    expect(within(row(first.title)).getByText(show.title)).toBeInTheDocument()
    expect(within(row(first.title)).getByText('1.0 KB')).toBeInTheDocument()
    expect(within(row(second.title)).getByText('2.5 KB')).toBeInTheDocument()
    expect(screen.getByText('3.5 KB used on this device')).toBeInTheDocument()
  })

  it('still lists downloads, with their sizes, after a relaunch', async () => {
    const { data, device, user, unmount } = await setUp()
    await download(user, show.title, first.title)
    unmount()

    const relaunched = await launch(data, device)
    await openDownloads(relaunched.user)

    expect(await screen.findByRole('list', { name: 'Downloaded episodes' })).toBeInTheDocument()
    expect(titlesIn('Downloaded episodes')).toEqual([first.title])
    expect(within(row(first.title)).getByText('1.0 KB')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB used on this device')).toBeInTheDocument()
  })

  it('plays a downloaded episode from its stored copy', async () => {
    const { audio, device, user } = await setUp()
    await download(user, show.title, first.title)
    await openDownloads(user)

    await user.click(within(row(first.title)).getByRole('button', { name: first.title }))

    expect(device.files.contentsAt(audio.src)).toEqual(firstFile)
  })

  it('still lists downloads after signing out and back in', async () => {
    const { user } = await setUp()
    await download(user, show.title, first.title)
    await user.click(screen.getByRole('button', { name: 'Library' }))

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.type(await screen.findByLabelText('Email'), owner.email)
    await user.type(screen.getByLabelText('Password'), owner.password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await openDownloads(user)

    expect(titlesIn('Downloaded episodes')).toEqual([first.title])
  })
})

describe('deleting a download', () => {
  it('frees the space and clears the episode’s badge', async () => {
    const { device, user } = await setUp()
    await download(user, show.title, first.title)
    await download(user, show.title, second.title)
    await openDownloads(user)

    await user.click(within(row(first.title)).getByRole('button', { name: 'Delete download' }))

    await waitFor(() => expect(titlesIn('Downloaded episodes')).toEqual([second.title]))
    expect(screen.getByText('2.5 KB used on this device')).toBeInTheDocument()
    expect(device.files.count()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await openShow(user, show.title)
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
    await openActions(user, row(first.title))
    expect(within(row(first.title)).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(within(row(second.title)).getByText('Downloaded')).toBeInTheDocument()
  })

  it('streams the episode afterwards', async () => {
    const { audio, user } = await setUp()
    await download(user, show.title, first.title)
    await openDownloads(user)
    await user.click(within(row(first.title)).getByRole('button', { name: 'Delete download' }))
    await waitFor(() => expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await openShow(user, show.title)
    await user.click(within(row(first.title)).getByRole('button', { name: first.title }))

    expect(audio.src).toBe(first.enclosureUrl)
  })

  it('stops the episode if it is playing from the deleted copy', async () => {
    const { user } = await setUp()
    await download(user, show.title, first.title)
    await openDownloads(user)
    await user.click(within(row(first.title)).getByRole('button', { name: first.title }))
    expect(screen.getByRole('region', { name: 'Mini player' })).toBeInTheDocument()

    await user.click(within(row(first.title)).getByRole('button', { name: 'Delete download' }))

    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()
  })

  it('stays deleted after a relaunch', async () => {
    const { data, device, user, unmount } = await setUp()
    await download(user, show.title, first.title)
    await openDownloads(user)
    await user.click(within(row(first.title)).getByRole('button', { name: 'Delete download' }))
    await waitFor(() => expect(device.files.count()).toBe(0))
    unmount()

    const relaunched = await launch(data, device)
    await openDownloads(relaunched.user)

    expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Lost downloads' })).not.toBeInTheDocument()
  })
})

describe('downloads in progress', () => {
  it('are shown with their progress', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await openShow(user, show.title)
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    await openDownloads(user)

    expect(titlesIn('Downloads in progress')).toEqual([first.title])
    expect(within(row(first.title)).getByText('40%')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Downloaded episodes' })).not.toBeInTheDocument()
  })

  it('can be cancelled, which keeps nothing of them', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await openShow(user, show.title)
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    await openDownloads(user)

    await user.click(within(row(first.title)).getByRole('button', { name: 'Cancel download' }))

    await waitFor(() => expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument())
    expect(device.files.count()).toBe(0)
    await waitFor(() => expect(device.screenKeptOn()).toBe(false))
    device.network.unthrottle()
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await openShow(user, show.title)
    await openActions(user, row(first.title))
    expect(within(row(first.title)).getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
  })

  it('can be cancelled once interrupted', async () => {
    const { data, device, user, unmount } = await setUp()
    device.network.throttle()
    await openShow(user, show.title)
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.network.dropConnection()
    await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    await openDownloads(user)
    expect(within(row(first.title)).getByText(/interrupted/i)).toBeInTheDocument()

    await user.click(within(row(first.title)).getByRole('button', { name: 'Cancel download' }))

    await waitFor(() => expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument())
    expect(device.files.count()).toBe(0)
    unmount()
    const relaunched = await launch(data, device)
    await openDownloads(relaunched.user)
    expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument()
  })

  it('can be resumed again while a cancel is still deleting what was stored', async () => {
    const { audio, device, user } = await setUp()
    device.network.throttle()
    await openShow(user, show.title)
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')
    device.network.dropConnection()
    await within(row(first.title)).findByRole('button', { name: 'Resume download' })
    await openDownloads(user)

    device.files.holdRemovals()
    await user.click(within(row(first.title)).getByRole('button', { name: 'Cancel download' }))
    await openShow(user, show.title)
    device.network.reconnect()
    device.network.unthrottle()
    await user.click(within(row(first.title)).getByRole('button', { name: 'Resume download' }))
    device.files.releaseRemovals()

    expect(await within(row(first.title)).findByText('Downloaded', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(device.files.onlyFile()).toEqual(firstFile)
    await user.click(within(row(first.title)).getByRole('button', { name: first.title }))
    expect(device.files.contentsAt(audio.src)).toEqual(firstFile)
  })

  it('count toward the space used', async () => {
    const { device, user } = await setUp()
    await download(user, show.title, second.title)
    device.network.throttle()
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    await openDownloads(user)

    expect(screen.getByText('2.9 KB used on this device')).toBeInTheDocument()
  })
})

describe('a download the device cleared between launches', () => {
  async function clearedBetweenLaunches() {
    const setup = await setUp()
    await download(setup.user, show.title, first.title)
    await download(setup.user, show.title, second.title)
    setup.unmount()
    // As iOS may do to free space while the app is closed.
    setup.device.files.evictAll()
    const relaunched = await launch(setup.data, setup.device)
    return { ...setup, ...relaunched }
  }

  it('loses its badge, and the episode says its download was lost', async () => {
    const { user } = await clearedBetweenLaunches()

    await openShow(user, show.title)

    expect(await within(row(first.title)).findByText(/download is no longer on this device/i)).toBeInTheDocument()
    expect(within(row(first.title)).queryByText('Downloaded')).not.toBeInTheDocument()
    expect(within(row(first.title)).getByRole('button', { name: 'Download again' })).toBeInTheDocument()
  })

  it('streams the episode rather than the missing copy', async () => {
    const { audio, user } = await clearedBetweenLaunches()
    await openShow(user, show.title)
    await within(row(first.title)).findByText(/download is no longer on this device/i)

    await user.click(within(row(first.title)).getByRole('button', { name: first.title }))

    expect(audio.src).toBe(first.enclosureUrl)
  })

  it('shows as lost on the downloads screen, using no space', async () => {
    const { user } = await clearedBetweenLaunches()

    await openDownloads(user)

    await waitFor(() => expect(titlesIn('Lost downloads')).toEqual([first.title, second.title]))
    expect(screen.queryByRole('list', { name: 'Downloaded episodes' })).not.toBeInTheDocument()
    expect(screen.getByText('0.0 KB used on this device')).toBeInTheDocument()
  })

  it('can be downloaded again', async () => {
    const { device, user } = await clearedBetweenLaunches()
    await openDownloads(user)
    await waitFor(() => expect(titlesIn('Lost downloads')).toHaveLength(2))

    await user.click(within(row(first.title)).getByRole('button', { name: 'Download again' }))

    await waitFor(() => expect(titlesIn('Downloaded episodes')).toEqual([first.title]))
    expect(titlesIn('Lost downloads')).toEqual([second.title])
    expect(device.files.onlyFile()).toEqual(firstFile)
  })

  it('can be dismissed, and stays dismissed after a relaunch', async () => {
    const { data, device, user, unmount } = await clearedBetweenLaunches()
    await openDownloads(user)
    await waitFor(() => expect(titlesIn('Lost downloads')).toHaveLength(2))

    await user.click(within(row(first.title)).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(titlesIn('Lost downloads')).toEqual([second.title]))
    unmount()
    const relaunched = await launch(data, device)
    await openDownloads(relaunched.user)
    await waitFor(() => expect(titlesIn('Lost downloads')).toEqual([second.title]))
    await relaunched.user.click(screen.getByRole('button', { name: 'Library' }))
    await openShow(relaunched.user, show.title)
    await openActions(relaunched.user, row(first.title))
    expect(within(row(first.title)).getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })

  it('stays downloaded when its file is still there', async () => {
    const { data, device, user, unmount } = await setUp()
    await download(user, show.title, first.title)
    unmount()

    const relaunched = await launch(data, device)
    await openShow(relaunched.user, show.title)

    expect(await within(row(first.title)).findByText('Downloaded')).toBeInTheDocument()
    expect(within(row(first.title)).queryByText(/no longer on this device/i)).not.toBeInTheDocument()
  })
})

describe('unsubscribing', () => {
  it('removes that podcast’s downloads, and no others', async () => {
    const { device, user } = await setUp()
    await download(user, show.title, first.title)
    await download(user, show.title, second.title)
    await user.click(screen.getByRole('button', { name: 'Library' }))
    await download(user, other.title, elsewhere.title)

    await user.click(screen.getByRole('button', { name: 'Library' }))
    await openShow(user, show.title)
    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    const dialog = screen.getByRole('alertdialog', { name: `Unsubscribe from ${show.title}?` })
    await user.click(within(dialog).getByRole('button', { name: 'Unsubscribe' }))
    await screen.findByRole('heading', { name: 'Library' })

    await openDownloads(user)
    await waitFor(() => expect(titlesIn('Downloaded episodes')).toEqual([elsewhere.title]))
    expect(device.files.onlyFile()).toEqual(elsewhereFile)
  })

  it('cancels a download of that podcast in progress', async () => {
    const { device, user } = await setUp()
    device.network.throttle()
    await openShow(user, show.title)
    await chooseAction(user, row(first.title), 'Download')
    device.network.deliver(400)
    await within(row(first.title)).findByText('40%')

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    const dialog = screen.getByRole('alertdialog', { name: `Unsubscribe from ${show.title}?` })
    await user.click(within(dialog).getByRole('button', { name: 'Unsubscribe' }))
    await screen.findByRole('heading', { name: 'Library' })

    await waitFor(() => expect(device.files.count()).toBe(0))
    await openDownloads(user)
    expect(screen.getByText('Nothing is downloaded to this device.')).toBeInTheDocument()
  })
})

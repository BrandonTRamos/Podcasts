import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openLibrary, openShowNotes } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show' }

/** When the tests take place: the sequel, the latest, came out within three days, the rest longer ago. */
const NOW = '2026-11-12T12:00:00.000Z'

const sequel = { title: 'Episode 12: The Roman Sequel', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 3600 }
const cafe = {
  title: 'Episode 11: Café Society',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 2700,
  enclosureUrl: 'https://media.example.com/show/ep11.mp3',
}
const guest = { title: 'Episode 10: An Interview', publishedAt: '2026-10-27T08:00:00.000Z', durationSeconds: 1800 }
/** Further back in the feed than the library keeps. */
const fall = { title: 'Episode 2: The Fall of Rome', publishedAt: '2019-02-01T08:00:00.000Z', durationSeconds: 4000 }

/** A library holding the show, its newest three episodes stored and an older one only in its feed, open on the show. */
async function renderShow({ data = fakeDataApi(), sequelPlayed = false } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse(NOW))
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [sequelId, cafeId, guestId] = data.ingest(podcastId, [sequel, cafe, guest])
  if (sequelPlayed) data.seedEpisodeState({ episodeId: sequelId, podcastId, positionSeconds: 3600, played: true })
  data.publishOlderEpisodes(podcastId, [fall])
  const device = new FakeDevice()
  device.network.host(cafe.enclosureUrl, Uint8Array.from({ length: 1000 }, (_, i) => i % 251))
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { data, user, podcastId, sequelId, cafeId, guestId }
}

afterEach(() => vi.useRealTimers())

const tab = (name: 'Episodes' | 'Recently Added') => screen.getByRole('tab', { name })
const episodes = () => screen.getByRole('list', { name: 'Episodes' })
const recent = () => screen.getByRole('list', { name: 'Recently added' })
const titlesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole('heading')
    .map((heading) => heading.textContent)
const addButton = (list: HTMLElement, title: string) => within(list).getByRole('button', { name: `Add ${title}` })

function rowIn(list: HTMLElement, title: string) {
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByRole('heading', { name: title }))
  if (!item) throw new Error(`No episode "${title}" in the list`)
  return item
}

describe('a podcast’s Recently Added', () => {
  it('opens on Episodes, each with an Add button, and has the new episodes under Recently Added', async () => {
    const { user } = await renderShow()

    expect(tab('Episodes')).toHaveAttribute('aria-selected', 'true')
    for (const { title } of [sequel, cafe, guest]) {
      expect(addButton(episodes(), title)).toHaveAttribute('aria-pressed', 'false')
    }

    await user.click(tab('Recently Added'))

    expect(tab('Recently Added')).toHaveAttribute('aria-selected', 'true')
    expect(titlesIn(recent())).toEqual([sequel.title])
    expect(screen.queryByRole('searchbox', { name: 'Search episodes' })).not.toBeInTheDocument()
  })

  it('gains an episode when it is added, the latest added first, and loses it when it is taken out', async () => {
    const { data, user, guestId } = await renderShow()

    await user.click(addButton(episodes(), guest.title))

    expect(addButton(episodes(), guest.title)).toHaveAttribute('aria-pressed', 'true')
    expect(addButton(episodes(), guest.title)).toHaveTextContent('Added')
    await waitFor(() => expect(data.savedState(guestId)?.addedAt).toBe(NOW))

    await user.click(tab('Recently Added'))
    expect(titlesIn(recent())).toEqual([guest.title, sequel.title])

    await user.click(addButton(recent(), guest.title))

    expect(titlesIn(recent())).toEqual([sequel.title])
    await waitFor(() => expect(data.savedState(guestId)?.addedAt).toBeNull())
  })

  it('keeps an added episode once it is no longer new', async () => {
    const { user } = await renderShow({ sequelPlayed: true })
    await user.click(tab('Recently Added'))
    expect(screen.getByText(/Nothing recently added\./)).toBeInTheDocument()

    await user.click(tab('Episodes'))
    await user.click(addButton(episodes(), sequel.title))
    await user.click(tab('Recently Added'))

    expect(titlesIn(recent())).toEqual([sequel.title])
  })

  it('has the episodes downloaded to this device', async () => {
    const { user } = await renderShow()

    await chooseAction(user, rowIn(episodes(), cafe.title), 'Download')
    await within(rowIn(episodes(), cafe.title)).findByText('Downloaded', {}, { timeout: 3000 })
    await user.click(tab('Recently Added'))

    expect(titlesIn(recent())).toEqual([sequel.title, cafe.title])
  })

  it('has an older episode added from the feed', async () => {
    const { user } = await renderShow()
    await user.type(screen.getByRole('searchbox', { name: 'Search episodes' }), 'fall{Enter}')
    const found = await screen.findByRole('list', { name: 'More from the feed' })

    await user.click(addButton(found, fall.title))
    await waitFor(() => expect(addButton(found, fall.title)).toHaveAttribute('aria-pressed', 'true'))
    await user.click(tab('Recently Added'))

    expect(titlesIn(recent())).toEqual([fall.title, sequel.title])
  })

  it('shows the unplayed only when asked to', async () => {
    const { user } = await renderShow({ sequelPlayed: true })
    await user.click(addButton(episodes(), sequel.title))
    await user.click(addButton(episodes(), guest.title))
    await user.click(tab('Recently Added'))
    expect(titlesIn(recent())).toHaveLength(2)

    await user.click(screen.getByRole('checkbox', { name: 'Unplayed only' }))

    expect(titlesIn(recent())).toEqual([guest.title])
  })

  it('is still showing on coming back from an episode, and Episodes is on opening the podcast again', async () => {
    const { user } = await renderShow()
    await user.click(tab('Recently Added'))

    await openShowNotes(user, rowIn(recent(), sequel.title))
    await screen.findByRole('heading', { level: 1, name: sequel.title })
    await user.click(screen.getByRole('button', { name: /Back to/ }))

    expect(titlesIn(recent())).toEqual([sequel.title])

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(await screen.findByRole('button', { name: /The Example Show/ }))

    expect(titlesIn(await screen.findByRole('list', { name: 'Episodes' }))).toEqual([sequel.title, cafe.title, guest.title])
  })
})

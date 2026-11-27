import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { inListOrder, placementsFor } from './categories'
import { HOLD_MS } from './holdToDrag'
import type { Podcast } from './services'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

function podcast(id: string, title: string, libraryOrder: number | null = null): Podcast {
  return { id, title, author: null, artworkUrl: null, lastFetchedAt: null, lastFetchError: null, categoryId: null, libraryOrder, favoriteOrder: null }
}

describe('the order of a list of podcasts', () => {
  it('puts those placed by hand first, lowest first, then the rest by title', () => {
    const list = [podcast('a', 'Alpha'), podcast('b', 'Bravo', 2), podcast('c', 'Charlie'), podcast('d', 'Delta', 1)]
    expect(inListOrder(list).map((p) => p.title)).toEqual(['Delta', 'Bravo', 'Alpha', 'Charlie'])
  })
})

describe('placing a podcast in a list', () => {
  const placed = [podcast('a', 'Alpha', 1), podcast('b', 'Bravo', 2), podcast('c', 'Charlie', 3)]

  it('takes one write between two placed neighbours', () => {
    expect(placementsFor(placed, 'x', 1)).toEqual([{ podcastId: 'x', libraryOrder: 1.5 }])
  })

  it('goes before the first, or after the last, in one write', () => {
    expect(placementsFor(placed, 'x', 0)).toEqual([{ podcastId: 'x', libraryOrder: 0 }])
    expect(placementsFor(placed, 'x', 3)).toEqual([{ podcastId: 'x', libraryOrder: 4 }])
  })

  it('first of a list never placed by hand takes one write', () => {
    const unplaced = [podcast('a', 'Alpha'), podcast('b', 'Bravo')]
    expect(placementsFor(unplaced, 'x', 0)).toEqual([{ podcastId: 'x', libraryOrder: 1 }])
  })

  it('numbers those before it afresh when they have no place yet', () => {
    const unplaced = [podcast('a', 'Alpha'), podcast('b', 'Bravo'), podcast('c', 'Charlie')]
    expect(placementsFor(unplaced, 'x', 2)).toEqual([
      { podcastId: 'a', libraryOrder: 1 },
      { podcastId: 'b', libraryOrder: 2 },
      { podcastId: 'x', libraryOrder: 3 },
    ])
  })

  it('leaves out the podcast itself when moving it within its list', () => {
    expect(placementsFor([...placed, podcast('x', 'X-ray', 4)], 'x', 0)).toEqual([{ podcastId: 'x', libraryOrder: 0 }])
  })

  it('numbers the list afresh when its neighbours are too close to split', () => {
    const close = [podcast('a', 'Alpha', 1), podcast('b', 'Bravo', 1 + Number.EPSILON)]
    expect(placementsFor(close, 'x', 1)).toEqual([
      { podcastId: 'x', libraryOrder: 2 },
      { podcastId: 'b', libraryOrder: 3 },
    ])
  })
})

/** Opens TinCan with the owner signed in, on their library. */
async function launch(data: ReturnType<typeof fakeDataApi>) {
  const device = new FakeDevice()
  const auth = fakeAuth(owner, { device })
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  return { user }
}

const toggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ podcasts?$`) })

function titlesIn(list: string) {
  return within(screen.getByRole('list', { name: list }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.podcast-title')?.textContent)
}

const rowOf = (title: string) => screen.getByText(title).closest('li')!

/**
 * Holds `title`'s row, then drags it over `to` (in its top half, or its
 * bottom) and lets go. The browser's layout is stood in for: jsdom has none,
 * so everything else lies nowhere.
 */
async function holdAndDrag(title: string, to: HTMLElement, half: 'top' | 'bottom' = 'top') {
  const row = rowOf(title)
  vi.spyOn(to, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 60))
  fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 })
  await act(() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50)))
  const y = half === 'top' ? 110 : 150
  fireEvent.mouseMove(window, { clientX: 10, clientY: y })
  fireEvent.mouseUp(window, { clientX: 10, clientY: y })
}

describe('dragging a podcast in the library', () => {
  it('moves it to another place in its list, and keeps it there', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    data.seedPodcast('https://feeds.example.com/b.xml', { title: 'Bravo' })
    data.seedPodcast('https://feeds.example.com/c.xml', { title: 'Charlie' })
    await launch(data)
    await screen.findByRole('list', { name: 'Podcasts' })

    await holdAndDrag('Charlie', rowOf('Alpha'), 'top')

    expect(titlesIn('Podcasts')).toEqual(['Charlie', 'Alpha', 'Bravo'])
    // Still first once the library brings the saved order.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(titlesIn('Podcasts')).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  it('moves it into a closed category by dropping it on the heading', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    data.seedPodcast('https://feeds.example.com/b.xml', { title: 'Bravo' })
    const news = data.seedCategory('News')
    await data.setPodcastCategory(data.podcastIdFor('https://feeds.example.com/b.xml')!, news)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('Other'))

    await holdAndDrag('Alpha', toggle('News').closest('.category-heading')!)

    await waitFor(() => expect(toggle('News')).toHaveAccessibleName('News, 2 podcasts'))
    expect(screen.queryByRole('region', { name: 'Other' })).not.toBeInTheDocument()
    await user.click(toggle('News'))
    expect(titlesIn('News')).toEqual(['Alpha', 'Bravo'])
  })

  it('moves it between the podcasts of another open category', async () => {
    const data = fakeDataApi()
    for (const title of ['Alpha', 'Bravo', 'Charlie']) data.seedPodcast(`https://feeds.example.com/${title}.xml`, { title })
    const news = data.seedCategory('News')
    await data.setPodcastCategory(data.podcastIdFor('https://feeds.example.com/Alpha.xml')!, news)
    await data.setPodcastCategory(data.podcastIdFor('https://feeds.example.com/Charlie.xml')!, news)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('News'))
    await user.click(toggle('Other'))

    await holdAndDrag('Bravo', rowOf('Alpha'), 'bottom')

    expect(titlesIn('News')).toEqual(['Alpha', 'Bravo', 'Charlie'])
    await waitFor(() => expect(toggle('News')).toHaveAccessibleName('News, 3 podcasts'))
    expect(titlesIn('News')).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('opens the podcast on a short press, as before', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    const { user } = await launch(data)

    await user.click(await screen.findByRole('button', { name: /Alpha/ }))

    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument()
  })

  it('does not open the podcast it was held on when let go', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    data.seedPodcast('https://feeds.example.com/b.xml', { title: 'Bravo' })
    await launch(data)
    await screen.findByRole('list', { name: 'Podcasts' })

    await holdAndDrag('Bravo', rowOf('Bravo'))
    fireEvent.click(screen.getByRole('button', { name: /Bravo/ }))

    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  it('puts it back and says so when the move can’t be saved', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    data.seedPodcast('https://feeds.example.com/b.xml', { title: 'Bravo' })
    await launch(data)
    await screen.findByRole('list', { name: 'Podcasts' })
    data.goOffline()

    await holdAndDrag('Bravo', rowOf('Alpha'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t move the podcast')
    expect(titlesIn('Podcasts')).toEqual(['Alpha', 'Bravo'])
  })
})

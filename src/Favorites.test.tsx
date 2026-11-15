import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { categoryNameProblem } from './categories'
import { HOLD_MS } from './holdToDrag'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

/** A backend with three shows, Daily Brief and Garden Hour in News, Reel Talk in none. */
function backendWithShows() {
  const data = fakeDataApi()
  const news = data.seedCategory('News')
  const daily = data.seedPodcast('https://feeds.example.com/daily.xml', { title: 'The Daily Brief', categoryId: news })
  const garden = data.seedPodcast('https://feeds.example.com/garden.xml', { title: 'Garden Hour', categoryId: news })
  const reel = data.seedPodcast('https://feeds.example.com/reel.xml', { title: 'Reel Talk' })
  return { data, news, daily, garden, reel }
}

/** Opens TinCan with the owner signed in, on their library. */
async function launch(data: ReturnType<typeof fakeDataApi>) {
  const device = new FakeDevice()
  const auth = fakeAuth(owner, { device })
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)
  await screen.findByRole('heading', { name: 'Library' })
  return { user: userEvent.setup() }
}

type User = ReturnType<typeof userEvent.setup>

const toggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ podcasts?$`) })

/** The sections' names, top to bottom. */
const sectionNames = () => screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))

/** The titles listed in an open section, in order. */
function titlesIn(name: string) {
  const list = within(screen.getByRole('region', { name })).queryByRole('list', { name })
  return list ? within(list).getAllByRole('listitem').map((item) => item.querySelector('.podcast-title')!.textContent) : []
}

/** The row of `title` in the section `name`. */
const rowIn = (name: string, title: string) =>
  within(screen.getByRole('list', { name })).getByText(title).closest('li')!

async function openPodcast(user: User, title: string) {
  await user.click(screen.getAllByRole('button', { name: new RegExp(title) })[0])
  await screen.findByRole('heading', { name: title })
}

const star = () => screen.getByRole('button', { name: 'Favorite' })
const backToLibrary = (user: User) => user.click(screen.getByRole('button', { name: 'Back to library' }))

/** Holds `row`, drags it over `to` (in its top half, or its bottom) and lets go. jsdom has no layout, so `to` is stood in for. */
async function holdAndDrag(row: HTMLElement, to: HTMLElement, half: 'top' | 'bottom' = 'top') {
  // Only `to` lies there: an earlier drag's stand-in is taken away.
  vi.restoreAllMocks()
  vi.spyOn(to, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 60))
  fireEvent.mouseDown(row, { button: 0, clientX: 10, clientY: 10 })
  await act(() => new Promise((resolve) => setTimeout(resolve, HOLD_MS + 50)))
  const y = half === 'top' ? 110 : 150
  fireEvent.mouseMove(window, { clientX: 10, clientY: y })
  fireEvent.mouseUp(window, { clientX: 10, clientY: y })
}

describe('starring a podcast', () => {
  it('copies it into Favorites, pinned to the top and open, while it stays in its category', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument()
    await user.click(toggle('News'))

    await openPodcast(user, 'Garden Hour')
    expect(star()).toHaveAttribute('aria-pressed', 'false')
    await user.click(star())
    expect(star()).toHaveAttribute('aria-pressed', 'true')
    await backToLibrary(user)

    expect(sectionNames()).toEqual(['Favorites', 'News', 'Other'])
    expect(toggle('Favorites')).toHaveAttribute('aria-expanded', 'true')
    expect(titlesIn('Favorites')).toEqual(['Garden Hour'])
    expect(toggle('News')).toHaveAccessibleName('News, 2 podcasts')
    expect(screen.getByText('3 podcasts')).toBeInTheDocument()
  })

  it('adds later favorites after earlier ones', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })

    for (const title of ['Reel Talk', 'The Daily Brief']) {
      await user.click(toggle(title === 'Reel Talk' ? 'Other' : 'News'))
      await openPodcast(user, title)
      await user.click(star())
      await backToLibrary(user)
    }

    await waitFor(() => expect(titlesIn('Favorites')).toEqual(['Reel Talk', 'The Daily Brief']))
  })

  it('takes it out of Favorites when unstarred, leaving it in its category', async () => {
    const { data, garden } = backendWithShows()
    await data.placeFavorite(garden, 1)
    const { user } = await launch(data)
    expect(await screen.findByRole('region', { name: 'Favorites' })).toBeInTheDocument()

    await openPodcast(user, 'Garden Hour')
    expect(star()).toHaveAttribute('aria-pressed', 'true')
    await user.click(star())
    await backToLibrary(user)

    expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument()
    expect(toggle('News')).toHaveAccessibleName('News, 2 podcasts')
  })

  it('says when the star can’t be saved, and shows it as it was', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('Other'))
    await openPodcast(user, 'Reel Talk')
    data.failNextRequest()

    await user.click(star())

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change your favorites.')
    expect(star()).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows favorites when there are no categories, above the rest', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/a.xml', { title: 'Alpha' })
    data.seedPodcast('https://feeds.example.com/b.xml', { title: 'Bravo', favoriteOrder: 1 })
    await launch(data)

    await screen.findByRole('region', { name: 'Favorites' })
    expect(titlesIn('Favorites')).toEqual(['Bravo'])
    expect(within(screen.getByRole('list', { name: 'Podcasts' })).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('reordering favorites', () => {
  it('moves one to another place among them by dragging, leaving the categories as they were', async () => {
    const { data, daily, garden, reel } = backendWithShows()
    await data.placeFavorite(daily, 1)
    await data.placeFavorite(garden, 2)
    await data.placeFavorite(reel, 3)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'Favorites' })
    await user.click(toggle('News'))

    await holdAndDrag(rowIn('Favorites', 'Reel Talk'), rowIn('Favorites', 'The Daily Brief'), 'top')

    expect(titlesIn('Favorites')).toEqual(['Reel Talk', 'The Daily Brief', 'Garden Hour'])
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(titlesIn('Favorites')).toEqual(['Reel Talk', 'The Daily Brief', 'Garden Hour'])
    expect(titlesIn('News')).toEqual(['Garden Hour', 'The Daily Brief'])
    expect(toggle('Other')).toHaveAccessibleName('Other, 1 podcast')
  })

  it('doesn’t drop a favorite into a category, nor a category’s podcast into Favorites', async () => {
    const { data, garden } = backendWithShows()
    await data.placeFavorite(garden, 1)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'Favorites' })
    await user.click(toggle('News'))

    await holdAndDrag(rowIn('Favorites', 'Garden Hour'), toggle('Other').closest('.category-heading')!)
    await holdAndDrag(rowIn('News', 'The Daily Brief'), rowIn('Favorites', 'Garden Hour'))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(titlesIn('Favorites')).toEqual(['Garden Hour'])
    expect(titlesIn('News')).toEqual(['Garden Hour', 'The Daily Brief'])
    expect(toggle('Other')).toHaveAccessibleName('Other, 1 podcast')
  })
})

describe('naming a category', () => {
  it('keeps Favorites for the starred podcasts', () => {
    expect(categoryNameProblem(' favorites ', [])).toBe('Favorites is kept for your starred podcasts.')
  })
})

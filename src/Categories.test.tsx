import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction, openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

/** A backend with three shows in the library and no categories yet. */
function backendWithShows() {
  const data = fakeDataApi()
  const daily = data.seedPodcast('https://feeds.example.com/daily.xml', { title: 'The Daily Brief' })
  const reel = data.seedPodcast('https://feeds.example.com/reel.xml', { title: 'Reel Talk' })
  const garden = data.seedPodcast('https://feeds.example.com/garden.xml', { title: 'Garden Hour' })
  return { data, daily, reel, garden }
}

/** Opens TinCan with the owner signed in, on their library. */
async function launch(data = fakeDataApi(), device = new FakeDevice()) {
  const auth = fakeAuth(owner, { device })
  await auth.signIn(owner.email, owner.password)
  const { unmount } = render(
    <App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />,
  )
  const user = userEvent.setup()
  await openLibrary(user)
  return { user, unmount }
}

type User = ReturnType<typeof userEvent.setup>

/** The heading button that opens and closes a category (or Other). */
const toggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, \\d+ podcasts?$`) })

/** The titles listed in an open category, in order. */
function titlesIn(name: string) {
  const list = within(screen.getByRole('region', { name })).queryByRole('list', { name })
  return list ? within(list).getAllByRole('listitem').map((item) => item.querySelector('.podcast-title')!.textContent) : []
}

async function createCategory(user: User, name: string) {
  await chooseLibraryAction(user, 'New category')
  await user.type(screen.getByLabelText('Name'), name)
  await user.click(screen.getByRole('button', { name: 'Create' }))
}

async function openPodcast(user: User, title: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(title) }))
  await screen.findByRole('heading', { name: title })
}

async function chooseCategory(user: User, name: string) {
  await user.selectOptions(screen.getByLabelText('Category'), name)
}

const backToLibrary = (user: User) => user.click(screen.getByRole('button', { name: 'Back to library' }))

describe('a library with no categories', () => {
  it('lists every podcast as one list, with no Other heading', async () => {
    const { data } = backendWithShows()
    await launch(data)

    const list = await screen.findByRole('list', { name: 'Podcasts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Other/ })).not.toBeInTheDocument()
  })
})

describe('grouping the library into categories', () => {
  it('shows each category, by name, then Other holding every podcast in none, all closed', async () => {
    const { data, daily, reel } = backendWithShows()
    const news = data.seedCategory('News')
    const movies = data.seedCategory('Movies')
    await data.setPodcastCategory(daily, news)
    await data.setPodcastCategory(reel, movies)
    await launch(data)

    await screen.findByRole('region', { name: 'News' })
    const headings = screen.getAllByRole('button', { expanded: false, name: /podcasts?$/ })
    expect(headings.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Movies, 1 podcast',
      'News, 1 podcast',
      'Other, 1 podcast',
    ])
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('opens and closes a category from its heading', async () => {
    const { data, daily, garden } = backendWithShows()
    const news = data.seedCategory('News')
    await data.setPodcastCategory(daily, news)
    await data.setPodcastCategory(garden, news)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })

    await user.click(toggle('News'))
    expect(toggle('News')).toHaveAttribute('aria-expanded', 'true')
    expect(titlesIn('News')).toEqual(['Garden Hour', 'The Daily Brief'])
    expect(titlesIn('Other')).toEqual([])

    await user.click(toggle('Other'))
    expect(titlesIn('Other')).toEqual(['Reel Talk'])

    await user.click(toggle('News'))
    expect(titlesIn('News')).toEqual([])
    expect(titlesIn('Other')).toEqual(['Reel Talk'])
  })

  it('keeps a category open while the listener visits one of its podcasts', async () => {
    const { data, daily } = backendWithShows()
    await data.setPodcastCategory(daily, data.seedCategory('News'))
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('News'))

    await openPodcast(user, 'The Daily Brief')
    await backToLibrary(user)

    expect(await screen.findByRole('list', { name: 'News' })).toBeInTheDocument()
  })

  it('makes a new category from the library, shown open and empty', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)

    await createCategory(user, '  News  ')

    expect(await screen.findByRole('region', { name: 'News' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle('News')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/No podcasts here yet/)).toBeInTheDocument()
    expect(toggle('Other')).toHaveAttribute('aria-expanded', 'false')
    expect(toggle('Other')).toHaveAccessibleName('Other, 3 podcasts')
  })

  it.each([
    ['no name', '   ', 'Enter a name for the category.'],
    ['a name already taken, in any case', 'news', 'You already have a category called News.'],
    ['Other', 'other', 'Other is kept for podcasts in no category.'],
  ])('refuses %s', async (_case, name, message) => {
    const { data } = backendWithShows()
    data.seedCategory('News')
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })

    await chooseLibraryAction(user, 'New category')
    if (name.trim()) await user.type(screen.getByLabelText('Name'), name)
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getAllByRole('region')).toHaveLength(2)
  })

  it('says when a category can’t be made offline, and keeps the dialog', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)
    await screen.findByRole('list', { name: 'Podcasts' })
    data.failNextRequest()

    await createCategory(user, 'News')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save the category.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('putting a podcast in a category', () => {
  it('moves it from Other to the category chosen on its screen, and back', async () => {
    const { data } = backendWithShows()
    data.seedCategory('News')
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('Other'))

    await openPodcast(user, 'The Daily Brief')
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Other')
    await chooseCategory(user, 'News')
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('News')
    await backToLibrary(user)
    await user.click(toggle('News'))

    expect(titlesIn('News')).toEqual(['The Daily Brief'])
    expect(titlesIn('Other')).toEqual(['Garden Hour', 'Reel Talk'])

    await openPodcast(user, 'The Daily Brief')
    await chooseCategory(user, 'Other')
    await backToLibrary(user)
    expect(titlesIn('News')).toEqual([])
    expect(titlesIn('Other')).toEqual(['Garden Hour', 'Reel Talk', 'The Daily Brief'])
  })

  it('makes a new category from the podcast’s screen and puts it there', async () => {
    const { data } = backendWithShows()
    const { user } = await launch(data)
    await screen.findByRole('list', { name: 'Podcasts' })

    await openPodcast(user, 'Reel Talk')
    await chooseCategory(user, 'New category…')
    await user.type(screen.getByLabelText('Name'), 'Movies')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByRole('option', { name: 'Movies' })).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Movies')
    await backToLibrary(user)
    await user.click(toggle('Movies'))
    expect(titlesIn('Movies')).toEqual(['Reel Talk'])
    expect(toggle('Other')).toHaveAccessibleName('Other, 2 podcasts')
  })

  it('says when the change can’t be saved, and shows the category it was in', async () => {
    const { data } = backendWithShows()
    data.seedCategory('News')
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('Other'))
    await openPodcast(user, 'Garden Hour')
    data.failNextRequest()

    await chooseCategory(user, 'News')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t change the category.')
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Other')
  })

  it('shows a change made on another device', async () => {
    const { data, garden } = backendWithShows()
    const news = data.seedCategory('News')
    await launch(data)
    await screen.findByRole('region', { name: 'News' })

    await act(() => data.anotherDevice().setPodcastCategory(garden, news))

    expect(toggle('News')).toHaveAccessibleName('News, 1 podcast')
    expect(toggle('Other')).toHaveAccessibleName('Other, 2 podcasts')
  })
})

describe('changing a category', () => {
  it('renames it', async () => {
    const { data, daily } = backendWithShows()
    await data.setPodcastCategory(daily, data.seedCategory('Newz'))
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'Newz' })

    await user.click(screen.getByRole('button', { name: 'Newz actions' }))
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByLabelText('Name')
    expect(field).toHaveValue('Newz')
    await user.clear(field)
    await user.type(field, 'News')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByRole('region', { name: 'News' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Newz' })).not.toBeInTheDocument()
    expect(toggle('News')).toHaveAccessibleName('News, 1 podcast')
  })

  it('deletes it, once confirmed, moving its podcasts to Other', async () => {
    const { data, daily, reel } = backendWithShows()
    const news = data.seedCategory('News')
    await data.setPodcastCategory(daily, news)
    await data.setPodcastCategory(reel, news)
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })

    await user.click(screen.getByRole('button', { name: 'News actions' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete News?' })
    expect(confirm).toHaveTextContent('Its podcasts stay in your library, in Other.')
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    // With no categories left, the library is one list again.
    const list = await screen.findByRole('list', { name: 'Podcasts' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the category when deleting is cancelled', async () => {
    const { data } = backendWithShows()
    data.seedCategory('News')
    const { user } = await launch(data)
    await screen.findByRole('region', { name: 'News' })

    await user.click(screen.getByRole('button', { name: 'News actions' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'News' })).toBeInTheDocument()
  })
})

describe('opening TinCan with no network', () => {
  it('shows the library in its categories, as last seen', async () => {
    const { data, daily } = backendWithShows()
    await data.setPodcastCategory(daily, data.seedCategory('News'))
    const device = new FakeDevice()
    const before = await launch(data, device)
    await screen.findByRole('region', { name: 'News' })
    before.unmount()

    act(() => {
      data.goOffline()
      device.goOffline()
    })
    const { user } = await launch(data, device)

    await screen.findByRole('region', { name: 'News' })
    await user.click(toggle('News'))
    expect(titlesIn('News')).toEqual(['The Daily Brief'])
    expect(toggle('Other')).toHaveAccessibleName('Other, 2 podcasts')
  })
})

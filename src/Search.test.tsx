import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const rome = {
  title: 'The History of Rome',
  author: 'Mike Duncan',
  artworkUrl: 'https://cdn.example.com/rome/artwork.jpg',
  feedUrl: 'https://feeds.example.com/history-of-rome.xml',
}
const romeDaily = { title: 'Rome Daily', author: null, artworkUrl: null, feedUrl: 'https://feeds.example.com/rome-daily.xml' }
const cooking = { title: 'Cooking Hour', author: 'Chef', artworkUrl: null, feedUrl: 'https://feeds.example.com/cooking.xml' }

/** Renders the app with the owner already signed in, on their library. */
async function renderSignedIn(data = fakeDataApi()) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  await screen.findByRole('heading', { name: 'Library' })
  return { data, user: userEvent.setup() }
}

/** A directory listing these shows; each one's feed is reachable. */
function directoryWith(...shows: Parameters<ReturnType<typeof fakeDataApi>['listInDirectory']>[0][]) {
  const data = fakeDataApi()
  for (const show of shows) data.listInDirectory(show)
  return data
}

/** Opens the Search screen, which starts on the directory's top shows. */
async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryByRole('heading', { name: 'Search' })) return
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByRole('heading', { name: 'Search' })
}

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  await openSearch(user)
  const input = screen.getByLabelText('Podcast name')
  await user.clear(input)
  await user.type(input, term)
  await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Search' }))
}

async function results() {
  return within(await screen.findByRole('list', { name: 'Search results' })).getAllByRole('listitem')
}

/** The chart showing, once it has loaded: 'Top shows', or 'Top shows in <genre>'. */
async function chart(name: string) {
  return within(await screen.findByRole('list', { name })).getAllByRole('listitem')
}

/** The button that browses a chart: 'Top shows' for all podcasts, or a genre's name. */
function chartButton(name: string) {
  return within(screen.getByRole('group', { name: 'Top shows by genre' })).getByRole('button', { name })
}

function result(title: string) {
  const item = screen
    .getAllByRole('listitem')
    .find((li) => within(li).queryByRole('heading', { name: title }) !== null)
  if (!item) throw new Error(`No result titled ${title}`)
  return item
}

describe('searching for a podcast', () => {
  it('shows the matching podcasts with title, author and artwork', async () => {
    const data = directoryWith(rome, romeDaily, cooking)
    const { user } = await renderSignedIn(data)

    await search(user, 'rome')

    const items = await results()
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('The History of Rome')
    expect(items[0]).toHaveTextContent('Mike Duncan')
    expect(items[0].querySelector('img')).toHaveAttribute('src', rome.artworkUrl)
    expect(items[1]).toHaveTextContent('Rome Daily')
    expect(within(items[1]).getByRole('button', { name: 'Subscribe' })).toBeEnabled()
  })

  it('never shows the listener a feed URL', async () => {
    const { user } = await renderSignedIn(directoryWith(rome))

    await search(user, 'rome')

    expect(await screen.findByRole('list', { name: 'Search results' })).not.toHaveTextContent('feeds.example.com')
  })

  it('says when nothing matches', async () => {
    const { user } = await renderSignedIn(directoryWith(rome))

    await search(user, 'zzzz')

    expect(await screen.findByRole('status')).toHaveTextContent('No podcasts found for “zzzz”.')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('marks the results already in the library as subscribed', async () => {
    const data = directoryWith(rome, romeDaily)
    data.seedPodcast(rome.feedUrl, { title: rome.title })
    const { user } = await renderSignedIn(data)

    await search(user, 'rome')
    await results()

    expect(result('The History of Rome')).toHaveTextContent('Subscribed')
    expect(within(result('The History of Rome')).queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument()
    expect(within(result('Rome Daily')).getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })

  it('opens a subscribed result’s podcast', async () => {
    const data = directoryWith(rome)
    data.seedPodcast(rome.feedUrl, { title: rome.title })
    const { user } = await renderSignedIn(data)
    await search(user, 'rome')
    await results()

    await user.click(within(result('The History of Rome')).getByRole('button', { name: 'Open' }))

    expect(await screen.findByRole('heading', { name: 'The History of Rome', level: 1 })).toBeInTheDocument()
  })
})

describe('subscribing from a search result', () => {
  it('adds the podcast to the library, the same as subscribing by URL', async () => {
    const data = directoryWith(rome, romeDaily)
    const { user } = await renderSignedIn(data)
    await search(user, 'rome')
    await results()

    await user.click(within(result('The History of Rome')).getByRole('button', { name: 'Subscribe' }))

    expect(result('The History of Rome')).toHaveTextContent('Subscribing…')
    act(() => data.finishSubscribing())

    expect(await within(result('The History of Rome')).findByText('Subscribed')).toBeInTheDocument()
    expect(within(result('Rome Daily')).getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Library' }))
    const [item] = within(await screen.findByRole('list', { name: 'Podcasts' })).getAllByRole('listitem')
    expect(item).toHaveTextContent('The History of Rome')
    expect(item).toHaveTextContent('Mike Duncan')
    expect(item.querySelector('img')).toHaveAttribute('src', rome.artworkUrl)
  })

  it('marks it subscribed when the library already had it', async () => {
    const data = directoryWith(rome)
    const { user } = await renderSignedIn(data)
    await search(user, 'rome')
    await results()
    // Added by another device after the search ran.
    data.seedPodcast(rome.feedUrl, { title: rome.title })

    await user.click(within(result('The History of Rome')).getByRole('button', { name: 'Subscribe' }))

    expect(await within(result('The History of Rome')).findByText('Subscribed')).toBeInTheDocument()
  })

  it('shows a clear error on the result when its feed does not work, and lets the listener try again', async () => {
    const data = fakeDataApi()
    data.listInDirectory(rome, { feed: 'unreachable' })
    const { user } = await renderSignedIn(data)
    await search(user, 'rome')
    await results()

    await user.click(within(result('The History of Rome')).getByRole('button', { name: 'Subscribe' }))
    act(() => data.finishSubscribing())

    expect(await within(result('The History of Rome')).findByRole('alert')).toHaveTextContent(
      'Couldn’t reach that feed. Try again later.',
    )
    expect(within(result('The History of Rome')).getByRole('button', { name: 'Subscribe' })).toBeEnabled()
  })

  it('shows a clear error on the result when the request fails', async () => {
    const data = directoryWith(rome)
    const { user } = await renderSignedIn(data)
    await search(user, 'rome')
    await results()
    data.failNextRequest()

    await user.click(within(result('The History of Rome')).getByRole('button', { name: 'Subscribe' }))

    expect(await within(result('The History of Rome')).findByRole('alert')).toHaveTextContent(
      'Couldn’t subscribe. Check your connection and try again.',
    )
  })
})

describe('when search fails', () => {
  it('says the directory is unavailable, and the app stays usable', async () => {
    const data = directoryWith(rome)
    data.seedPodcast('https://feeds.example.com/mine.xml', { title: 'My Show' })
    data.breakDirectory()
    const { user } = await renderSignedIn(data)

    await search(user, 'rome')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach the podcast directory. Try again later.')
    expect(screen.getByLabelText('Podcast name')).toHaveValue('rome')

    data.repairDirectory()
    await search(user, 'rome')
    expect(await results()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('button', { name: /My Show/ })).toBeInTheDocument()
  })

  it('says when the request fails', async () => {
    const data = directoryWith(rome)
    const { user } = await renderSignedIn(data)
    await openSearch(user)
    await chart('Top shows')
    data.failNextRequest()

    await search(user, 'rome')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t search. Check your connection and try again.')
  })
})

describe('browsing the directory’s top shows', () => {
  const laughs = { title: 'Laughs', author: 'Jo Ker', artworkUrl: 'https://cdn.example.com/laughs.jpg', feedUrl: 'https://feeds.example.com/laughs.xml' }
  const giggles = { title: 'Giggles', author: null, artworkUrl: null, feedUrl: 'https://feeds.example.com/giggles.xml' }

  /** A directory whose chart of all podcasts runs Rome, Laughs, Cooking Hour, Giggles: one history show, two comedies and one in no genre browsed here. */
  function directoryWithCharts() {
    const data = fakeDataApi()
    data.listInDirectory(rome, { genre: 'history' })
    data.listInDirectory(laughs, { genre: 'comedy' })
    data.listInDirectory(cooking)
    data.listInDirectory(giggles, { genre: 'comedy' })
    return data
  }

  it('opens on the top shows over all, most popular first, with title, author and artwork', async () => {
    const data = directoryWithCharts()
    const { user } = await renderSignedIn(data)

    await openSearch(user)

    const items = await chart('Top shows')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'The History of Rome',
      'Laughs',
      'Cooking Hour',
      'Giggles',
    ])
    expect(items[0]).toHaveTextContent('Mike Duncan')
    expect(items[0].querySelector('img')).toHaveAttribute('src', rome.artworkUrl)
    expect(within(items[0]).getByRole('button', { name: 'Subscribe' })).toBeEnabled()
    expect(chartButton('Top shows')).toHaveAttribute('aria-pressed', 'true')
    expect(chartButton('Comedy')).toHaveAttribute('aria-pressed', 'false')
    expect(data.chartRequests).toEqual([null])
  })

  it('lists a genre’s top shows when the genre is chosen', async () => {
    const data = directoryWithCharts()
    const { user } = await renderSignedIn(data)
    await openSearch(user)
    await chart('Top shows')

    await user.click(chartButton('Comedy'))

    const items = await chart('Top shows in Comedy')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual(['Laughs', 'Giggles'])
    expect(chartButton('Comedy')).toHaveAttribute('aria-pressed', 'true')
    expect(chartButton('Top shows')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('list', { name: 'Top shows' })).not.toBeInTheDocument()
    expect(data.chartRequests).toEqual([null, 'comedy'])

    await user.click(chartButton('Top shows'))

    expect(await chart('Top shows')).toHaveLength(4)
  })

  it('offers every genre', async () => {
    const { user } = await renderSignedIn(directoryWithCharts())

    await openSearch(user)

    const buttons = within(screen.getByRole('group', { name: 'Top shows by genre' })).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Top shows',
      'Arts',
      'Business',
      'Comedy',
      'Education',
      'Fiction',
      'Government',
      'Health & Fitness',
      'History',
      'Kids & Family',
      'Leisure',
      'Music',
      'News',
      'Religion & Spirituality',
      'Science',
      'Society & Culture',
      'Sports',
      'Technology',
      'True Crime',
      'TV & Film',
    ])
  })

  it('never shows the listener a feed URL', async () => {
    const { user } = await renderSignedIn(directoryWithCharts())

    await openSearch(user)
    await chart('Top shows')

    expect(screen.getByRole('main')).not.toHaveTextContent('feeds.example.com')
  })

  it('subscribes to a show from a chart, and marks the ones already in the library', async () => {
    const data = directoryWithCharts()
    data.seedPodcast(giggles.feedUrl, { title: giggles.title })
    const { user } = await renderSignedIn(data)
    await openSearch(user)
    await user.click(chartButton('Comedy'))
    await chart('Top shows in Comedy')

    expect(result('Giggles')).toHaveTextContent('Subscribed')
    expect(within(result('Giggles')).getByRole('button', { name: 'Open' })).toBeInTheDocument()
    await user.click(within(result('Laughs')).getByRole('button', { name: 'Subscribe' }))
    expect(result('Laughs')).toHaveTextContent('Subscribing…')
    act(() => data.finishSubscribing())

    expect(await within(result('Laughs')).findByText('Subscribed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('button', { name: /Laughs/ })).toBeInTheDocument()
  })

  it('shows what a search finds in place of the chart, and the chart last browsed again when the search is cleared', async () => {
    const data = directoryWithCharts()
    const { user } = await renderSignedIn(data)
    await openSearch(user)
    await user.click(chartButton('Comedy'))
    await chart('Top shows in Comedy')

    await search(user, 'rome')

    expect(await results()).toHaveLength(1)
    expect(screen.queryByRole('list', { name: 'Top shows in Comedy' })).not.toBeInTheDocument()
    expect(chartButton('Comedy')).toHaveAttribute('aria-pressed', 'false')

    await user.clear(screen.getByLabelText('Podcast name'))

    expect(await chart('Top shows in Comedy')).toHaveLength(2)
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
    expect(chartButton('Comedy')).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears the search when a chart is chosen', async () => {
    const { user } = await renderSignedIn(directoryWithCharts())
    await search(user, 'rome')
    await results()

    await user.click(chartButton('History'))

    expect(await chart('Top shows in History')).toHaveLength(1)
    expect(screen.getByLabelText('Podcast name')).toHaveValue('')
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument()
  })

  it('says a chart is loading, and shows only the one chosen last when an earlier one answers late', async () => {
    const data = directoryWithCharts()
    const { user } = await renderSignedIn(data)
    await openSearch(user)
    await chart('Top shows')
    data.holdCharts()

    await user.click(chartButton('Comedy'))
    expect(screen.getByRole('status')).toHaveTextContent('Loading top shows…')
    expect(screen.queryByRole('list', { name: 'Top shows' })).not.toBeInTheDocument()
    await user.click(chartButton('History'))
    await act(async () => data.releaseCharts({ newestFirst: true }))

    expect(await chart('Top shows in History')).toHaveLength(1)
    expect(screen.queryByRole('list', { name: 'Top shows in Comedy' })).not.toBeInTheDocument()
    expect(chartButton('History')).toHaveAttribute('aria-pressed', 'true')
  })

  it('says when a chart has no shows', async () => {
    const { user } = await renderSignedIn(directoryWithCharts())
    await openSearch(user)

    await user.click(chartButton('Sports'))

    expect(await screen.findByText('No top shows to list right now.')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('list', { name: /Top shows/ })).not.toBeInTheDocument()
  })

  it('says when the directory is unavailable, and loads the chart when it is chosen again', async () => {
    const data = directoryWithCharts()
    data.breakDirectory()
    const { user } = await renderSignedIn(data)

    await openSearch(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach the podcast directory. Try again later.')

    data.repairDirectory()
    await user.click(chartButton('Top shows'))

    expect(await chart('Top shows')).toHaveLength(4)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when the request fails, and search still works', async () => {
    const data = directoryWithCharts()
    data.failNextRequest()
    const { user } = await renderSignedIn(data)

    await openSearch(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load the top shows. Check your connection and try again.',
    )

    await search(user, 'rome')

    expect(await results()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

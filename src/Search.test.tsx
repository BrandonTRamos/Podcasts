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

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  if (!screen.queryByRole('heading', { name: 'Search' })) {
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByRole('heading', { name: 'Search' })
  }
  const input = screen.getByLabelText('Podcast name')
  await user.clear(input)
  await user.type(input, term)
  await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Search' }))
}

async function results() {
  return within(await screen.findByRole('list', { name: 'Search results' })).getAllByRole('listitem')
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
    data.failNextRequest()
    const { user } = await renderSignedIn(data)

    await search(user, 'rome')

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t search. Check your connection and try again.')
  })
})

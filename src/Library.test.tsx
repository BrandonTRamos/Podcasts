import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { fakeAuth, fakeDataApi } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const feedUrl = 'https://feeds.example.com/show.xml'
const show = {
  title: 'The Example Show',
  author: 'Example Media',
  artworkUrl: 'https://cdn.example.com/show/artwork.jpg',
}

/** Renders the app with the owner already signed in, on their library. */
async function renderSignedIn(data = fakeDataApi()) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data }} />)
  await screen.findByRole('heading', { name: 'Library' })
  return { data, user: userEvent.setup() }
}

async function subscribeTo(user: ReturnType<typeof userEvent.setup>, url: string) {
  await user.type(screen.getByLabelText('Feed URL'), url)
  await user.click(screen.getByRole('button', { name: 'Subscribe' }))
}

async function libraryItems() {
  return within(await screen.findByRole('list', { name: 'Podcasts' })).getAllByRole('listitem')
}

function episodeItems() {
  return within(screen.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
}

describe('subscribing by feed URL', () => {
  it('adds the podcast to the library with its title, author and artwork', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, feedUrl)
    expect(await screen.findByRole('heading', { name: 'The Example Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    const [item] = await libraryItems()
    expect(item).toHaveTextContent('The Example Show')
    expect(item).toHaveTextContent('Example Media')
    expect(item.querySelector('img')).toHaveAttribute('src', show.artworkUrl)
  })

  it('returns at once, and episodes appear as they are ingested without a reload', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, feedUrl)

    expect(await screen.findByRole('heading', { name: 'The Example Show' })).toBeInTheDocument()
    expect(screen.getByText('Fetching episodes…')).toBeInTheDocument()

    act(() =>
      data.ingest(data.podcastIdFor(feedUrl)!, [
        { title: 'Episode 1: The Beginning', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 },
      ]),
    )

    expect(await screen.findByText('Episode 1: The Beginning')).toBeInTheDocument()
    expect(screen.queryByText('Fetching episodes…')).not.toBeInTheDocument()
  })

  it('says so when the first ingest fails, rather than fetching forever', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)
    await subscribeTo(user, feedUrl)
    await screen.findByText('Fetching episodes…')

    act(() => data.failIngest(data.podcastIdFor(feedUrl)!, 'The feed could not be reached.'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t fetch episodes. The feed could not be reached.')
    expect(screen.queryByText('Fetching episodes…')).not.toBeInTheDocument()
  })

  it('says when the feed is already in the library, and adds no duplicate', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)
    await subscribeTo(user, feedUrl)
    await user.click(await screen.findByRole('button', { name: 'Back to library' }))

    await subscribeTo(user, feedUrl)

    expect(await screen.findByRole('status')).toHaveTextContent('You’re already subscribed to The Example Show.')
    expect(await libraryItems()).toHaveLength(1)
  })
})

describe('subscribing to a feed that does not work', () => {
  it.each([
    ['an ftp URL', 'ftp://feeds.example.com/show.xml', 'Enter a feed URL that starts with http:// or https://.'],
    ['text that is not a URL', 'my favourite show', 'Enter a feed URL that starts with http:// or https://.'],
    ['an unreachable feed', 'https://nowhere.example.com/feed.xml', 'Couldn’t reach that feed. Check the URL and try again.'],
    ['a web page', 'https://www.example.com/', 'That URL isn’t a podcast feed.'],
  ])('shows a clear error for %s and leaves the library empty', async (_case, url, message) => {
    const data = fakeDataApi()
    data.publishWebPage('https://www.example.com/')
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, url)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()
  })

  it('shows a clear error when the request fails', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    data.failNextRequest()
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, feedUrl)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t subscribe. Check your connection and try again.')
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Feed URL')).toHaveValue(feedUrl)
  })
})

describe('browsing a podcast', () => {
  it('lists its episodes newest first, with title, date and duration', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    await data.subscribeToFeed(feedUrl)
    data.ingest(data.podcastIdFor(feedUrl)!, [
      { title: 'Episode 1: The Beginning', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 },
      { title: 'Episode 3: The Finale', publishedAt: '2026-11-12T08:00:00.000Z', durationSeconds: 7200 },
      { title: 'Bonus: No Date', publishedAt: null, durationSeconds: null },
      { title: 'Episode 2: The Sequel', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 3723 },
    ])
    const { user } = await renderSignedIn(data)

    await user.click(within((await libraryItems())[0]).getByRole('button', { name: /The Example Show/ }))

    expect(await screen.findByRole('heading', { name: 'The Example Show' })).toBeInTheDocument()
    const items = episodeItems()
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Episode 3: The Finale',
      'Episode 2: The Sequel',
      'Episode 1: The Beginning',
      'Bonus: No Date',
    ])
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', '2026-11-12T08:00:00.000Z')
    expect(items[0]).toHaveTextContent('2 hr')
    expect(items[1]).toHaveTextContent('1 hr 2 min')
    expect(items[2]).toHaveTextContent('45 min')
    expect(items[3].querySelector('time')).toBeNull()
  })

  it('goes back to the library', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    await data.subscribeToFeed(feedUrl)
    data.ingest(data.podcastIdFor(feedUrl)!, [])
    const { user } = await renderSignedIn(data)

    await user.click(within((await libraryItems())[0]).getByRole('button', { name: /The Example Show/ }))
    expect(await screen.findByText('No episodes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(await libraryItems()).toHaveLength(1)
  })
})

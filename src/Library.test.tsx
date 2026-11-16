import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

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
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  await screen.findByRole('heading', { name: 'Library' })
  return { data, user: userEvent.setup() }
}

async function subscribeTo(user: ReturnType<typeof userEvent.setup>, url: string) {
  if (!screen.queryByLabelText('Feed URL')) await user.click(screen.getByRole('button', { name: 'Add podcast' }))
  await user.type(screen.getByLabelText('Feed URL'), url)
  await user.click(screen.getByRole('button', { name: 'Subscribe' }))
}

async function libraryItems() {
  return within(await screen.findByRole('list', { name: 'Podcasts' })).getAllByRole('listitem')
}

async function episodeItems() {
  return within(await screen.findByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
}

describe('subscribing by feed URL', () => {
  it('returns at once, then adds the podcast with its title, author and artwork once the feed checks out', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, feedUrl)

    expect(await screen.findByRole('status')).toHaveTextContent('Checking the feed…')
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()

    act(() => data.finishSubscribing())

    expect(await screen.findByRole('heading', { name: 'The Example Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    const [item] = await libraryItems()
    expect(item).toHaveTextContent('The Example Show')
    expect(item).toHaveTextContent('Example Media')
    expect(item.querySelector('img')).toHaveAttribute('src', show.artworkUrl)
  })

  it('shows episodes as they are ingested, without a reload', async () => {
    const data = fakeDataApi()
    data.publishFeed(feedUrl, show)
    const { user } = await renderSignedIn(data)
    await subscribeTo(user, feedUrl)
    act(() => data.finishSubscribing())
    expect(await screen.findByText('No episodes yet.')).toBeInTheDocument()

    act(() =>
      data.ingest(data.podcastIdFor(feedUrl)!, [
        { title: 'Episode 1: The Beginning', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 },
      ]),
    )

    expect(await screen.findByText('Episode 1: The Beginning')).toBeInTheDocument()
    expect(screen.queryByText('No episodes yet.')).not.toBeInTheDocument()
  })

  it('says when the feed is already in the library, and adds no duplicate', async () => {
    const data = fakeDataApi()
    data.seedPodcast(feedUrl, show)
    const { user } = await renderSignedIn(data)

    await subscribeTo(user, feedUrl)

    expect(await screen.findByRole('status')).toHaveTextContent('You’re already subscribed to The Example Show.')
    expect(await libraryItems()).toHaveLength(1)
  })
})

describe('subscribing to a feed that does not work', () => {
  it.each([
    ['an ftp URL', 'ftp://feeds.example.com/show.xml', 'Enter a feed URL that starts with http:// or https://.'],
    ['text that is not a URL', 'my favourite show', 'Enter a feed URL that starts with http:// or https://.'],
  ])('refuses %s straight away', async (_case, url, message) => {
    const { user } = await renderSignedIn()

    await subscribeTo(user, url)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()
  })

  it.each([
    ['an unreachable feed', 'https://nowhere.example.com/feed.xml', 'Couldn’t reach that feed. Check the URL and try again.'],
    ['a web page', 'https://www.example.com/', 'That URL isn’t a podcast feed.'],
    ['a feed the backend fails on', 'https://feeds.example.com/broken.xml', 'Couldn’t subscribe. Try again.'],
  ])('shows a clear error for %s once checked, and leaves the library empty', async (_case, url, message) => {
    const data = fakeDataApi()
    data.publishWebPage('https://www.example.com/')
    data.breakBackgroundFor('https://feeds.example.com/broken.xml')
    const { user } = await renderSignedIn(data)
    await subscribeTo(user, url)
    await screen.findByText('Checking the feed…')

    act(() => data.finishSubscribing())

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('Checking the feed…')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Feed URL')).toHaveValue(url)
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
    const podcastId = data.seedPodcast(feedUrl, show)
    data.ingest(podcastId, [
      { title: 'Episode 1: The Beginning', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 },
      { title: 'Episode 3: The Finale', publishedAt: '2026-11-12T08:00:00.000Z', durationSeconds: 7200 },
      { title: 'Bonus: No Date', publishedAt: null, durationSeconds: null },
      { title: 'Episode 2: The Sequel', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 3723 },
    ])
    const { user } = await renderSignedIn(data)

    await user.click(within((await libraryItems())[0]).getByRole('button', { name: /The Example Show/ }))

    expect(await screen.findByRole('heading', { name: 'The Example Show' })).toBeInTheDocument()
    const items = await episodeItems()
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
    data.seedPodcast(feedUrl, show)
    const { user } = await renderSignedIn(data)

    await user.click(within((await libraryItems())[0]).getByRole('button', { name: /The Example Show/ }))
    expect(await screen.findByText('No episodes yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(await libraryItems()).toHaveLength(1)
  })
})

describe('an episode’s other actions', () => {
  it('stay behind its More actions button until asked for, and go away once one is chosen or dismissed', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast(feedUrl, show)
    data.ingest(podcastId, [{ title: 'Episode 1', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 }])
    const { user } = await renderSignedIn(data)
    await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
    const [row] = await episodeItems()
    const more = within(row).getByRole('button', { name: 'More actions' })
    expect(within(row).queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()

    await user.click(more)

    for (const name of ['Mark played', 'Show notes', 'Play next', 'Add to queue', 'Download']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument()
    }
    await user.keyboard('{Escape}')
    expect(within(row).queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()

    await user.click(more)
    await user.click(within(row).getByRole('button', { name: 'Add to queue' }))

    expect(row).toHaveTextContent('Queued')
    expect(within(row).queryByRole('button', { name: 'Add to queue' })).not.toBeInTheDocument()
  })
})

describe('the top of the library', () => {
  it('counts the podcasts under the title, once there are any', async () => {
    const data = fakeDataApi()
    await renderSignedIn(data)
    expect(screen.queryByText(/\d+ podcasts?$/)).not.toBeInTheDocument()

    act(() => void data.seedPodcast(feedUrl, show))
    expect(await screen.findByText('1 podcast')).toBeInTheDocument()

    act(() => void data.seedPodcast('https://feeds.example.com/other.xml', { title: 'The Other Show' }))
    expect(await screen.findByText('2 podcasts')).toBeInTheDocument()
  })

  it('asks for a feed URL in a dialog, which Cancel and Escape close', async () => {
    const { user } = await renderSignedIn()
    expect(screen.queryByLabelText('Feed URL')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add podcast' }))

    const dialog = screen.getByRole('dialog', { name: 'Add podcast' })
    expect(within(dialog).getByLabelText('Feed URL')).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add podcast' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps importing, reloading and signing out behind More actions, and opens the file picker from there', async () => {
    const { user } = await renderSignedIn()
    for (const name of ['Import OPML file', 'Sign out']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click')

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    for (const name of ['Import OPML file', 'Sign out']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Import OPML file' }))

    expect(picker).toHaveBeenCalledTimes(1)
    expect(picker.mock.instances[0]).toBe(screen.getByLabelText('Import OPML file'))
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    picker.mockRestore()
  })
})

describe('new episodes in the library', () => {
  afterEach(() => vi.useRealTimers())

  const episode = (title: string, publishedAt: string | null) => ({ title, publishedAt, durationSeconds: 1800 })

  it('counts a podcast’s most recent episode while it is new, and no other', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-14T09:00:00.000Z'))
    const data = fakeDataApi()
    const busy = data.seedPodcast('https://feeds.example.com/busy.xml', { title: 'Busy Show' })
    const begun = data.seedPodcast('https://feeds.example.com/begun.xml', { title: 'Begun Show' })
    const quiet = data.seedPodcast('https://feeds.example.com/quiet.xml', { title: 'Quiet Show' })
    data.ingest(busy, [
      episode('Fresh', '2026-11-13T08:00:00.000Z'),
      episode('Out the day before', '2026-11-12T08:00:00.000Z'),
      episode('Old', '2026-11-01T08:00:00.000Z'),
      episode('Undated', null),
    ])
    const [startedId] = data.ingest(begun, [
      episode('Started', '2026-11-13T08:00:00.000Z'),
      episode('Out the day before', '2026-11-12T08:00:00.000Z'),
    ])
    data.seedEpisodeState({ episodeId: startedId, podcastId: begun, positionSeconds: 60, played: false })
    // Its latest came out four days ago.
    data.ingest(quiet, [episode('Last week’s', '2026-11-10T08:00:00.000Z')])
    await renderSignedIn(data)

    expect(await screen.findByRole('button', { name: /Busy Show, 1 new episode$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Begun Show' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quiet Show' })).toBeInTheDocument()
  })

  it('updates the count as a refresh finds a new episode', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-14T09:00:00.000Z'))
    const data = fakeDataApi()
    const show = data.seedPodcast(feedUrl, { title: 'The Example Show' })
    await renderSignedIn(data)
    expect(await screen.findByRole('button', { name: 'The Example Show' })).toBeInTheDocument()

    act(() => void data.ingest(show, [episode('Just out', '2026-11-14T08:00:00.000Z')]))

    expect(await screen.findByRole('button', { name: /The Example Show, 1 new episode$/ })).toBeInTheDocument()
  })
})

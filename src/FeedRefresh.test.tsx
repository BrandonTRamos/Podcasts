import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const showUrl = 'https://feeds.example.com/show.xml'
const otherUrl = 'https://feeds.other.example.com/other.xml'
const show = { title: 'The Example Show', artworkUrl: 'https://cdn.example.com/show/artwork.jpg' }
const other = { title: 'The Other Show' }

/** Renders the app with the owner already signed in, on their library. */
async function renderSignedIn(data: ReturnType<typeof fakeDataApi>, userOptions?: Parameters<typeof userEvent.setup>[0]) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  const user = userEvent.setup(userOptions)
  await openLibrary(user)
  return { audio, user }
}

async function openShow(user: ReturnType<typeof userEvent.setup>, title = show.title) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }))
  await screen.findByRole('heading', { name: title, level: 1 })
}

afterEach(() => {
  vi.useRealTimers()
})

function feedStatus() {
  return screen.getByRole('region', { name: 'Feed' })
}

describe('a podcast’s feed health', () => {
  it('shows when the feed last refreshed', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-14T09:00:00.000Z' })
    const { user } = await renderSignedIn(data)

    await openShow(user)

    expect(feedStatus()).toHaveTextContent('Last refreshed')
    expect(feedStatus().querySelector('time')).toHaveAttribute('dateTime', '2026-11-14T09:00:00.000Z')
    expect(within(feedStatus()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when the feed has not been refreshed yet', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, show)
    const { user } = await renderSignedIn(data)

    await openShow(user)

    expect(feedStatus()).toHaveTextContent('Not refreshed yet')
  })

  it.each([
    ['unreachable', 'The last refresh failed: couldn’t reach the feed.'],
    ['notAFeed', 'The last refresh failed: the URL no longer gives a podcast feed.'],
    ['invalidUrl', 'The last refresh failed: the feed URL isn’t valid.'],
    ['failed', 'The last refresh failed. It will be tried again within the hour.'],
  ] as const)('says when the last refresh failed (%s), and when the feed last refreshed', async (error, message) => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-13T09:00:00.000Z', lastFetchError: error })
    const { user } = await renderSignedIn(data)

    await openShow(user)

    expect(within(feedStatus()).getByRole('alert')).toHaveTextContent(message)
    expect(feedStatus().querySelector('time')).toHaveAttribute('dateTime', '2026-11-13T09:00:00.000Z')
  })

  it('keeps up as the hourly refresh records new results, without a reload', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-14T09:00:00.000Z' })
    const { user } = await renderSignedIn(data)
    await openShow(user)

    act(() => data.recordRefresh(podcastId, { lastFetchError: 'unreachable' }))
    expect(await within(feedStatus()).findByRole('alert')).toHaveTextContent('couldn’t reach the feed')

    act(() => data.recordRefresh(podcastId, { lastFetchedAt: '2026-11-14T11:00:00.000Z', lastFetchError: null }))
    expect(within(feedStatus()).queryByRole('alert')).not.toBeInTheDocument()
    expect(feedStatus().querySelector('time')).toHaveAttribute('dateTime', '2026-11-14T11:00:00.000Z')
  })

  it('shows new episodes as the hourly refresh finds them, without a reload', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast(showUrl, show)
    data.ingest(podcastId, [{ title: 'Episode 1', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 60 }])
    const { user } = await renderSignedIn(data)
    await openShow(user)

    act(() => {
      data.ingest(podcastId, [{ title: 'Episode 2', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 60 }])
    })

    const items = within(await screen.findByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual(['Episode 2', 'Episode 1'])
  })
})

describe('refreshing a podcast on demand', () => {
  it('asks the backend to refresh it, then shows what the refresh found', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-14T09:00:00.000Z' })
    data.seedPodcast(otherUrl, other)
    const { user } = await renderSignedIn(data)
    await openShow(user)

    await user.click(within(feedStatus()).getByRole('button', { name: 'Refresh' }))

    expect(data.refreshRequests()).toEqual([podcastId])
    expect(within(feedStatus()).getByRole('status')).toHaveTextContent('Checking for new episodes…')
    expect(within(feedStatus()).getByRole('button', { name: 'Refresh' })).toBeDisabled()

    act(() => {
      data.ingest(podcastId, [{ title: 'Just Published', publishedAt: '2026-11-14T09:30:00.000Z', durationSeconds: 60 }])
      data.recordRefresh(podcastId, { lastFetchedAt: '2026-11-14T09:31:00.000Z', lastFetchError: null })
    })

    expect(await screen.findByRole('button', { name: 'Just Published' })).toBeInTheDocument()
    expect(feedStatus().querySelector('time')).toHaveAttribute('dateTime', '2026-11-14T09:31:00.000Z')
    expect(within(feedStatus()).queryByRole('status')).not.toBeInTheDocument()
    expect(within(feedStatus()).getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('shows the failure when the refresh fails', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-14T09:00:00.000Z' })
    const { user } = await renderSignedIn(data)
    await openShow(user)
    await user.click(within(feedStatus()).getByRole('button', { name: 'Refresh' }))

    act(() => data.recordRefresh(podcastId, { lastFetchError: 'unreachable' }))

    expect(await within(feedStatus()).findByRole('alert')).toHaveTextContent('couldn’t reach the feed')
    expect(within(feedStatus()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('stops checking once the backend has had time to answer, as for a feed found unchanged', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, { ...show, lastFetchedAt: '2026-11-14T09:00:00.000Z' })
    const { user } = await renderSignedIn(data)
    await openShow(user)
    // From here the clock moves only when told, and the tap is handled, its
    // request answered and the check started, all within act, so the check's
    // timer starts now rather than some unknown time later.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => {
      fireEvent.click(within(feedStatus()).getByRole('button', { name: 'Refresh' }))
    })

    // An unchanged feed writes nothing, so no update comes; the check ends on its own.
    act(() => void vi.advanceTimersByTime(29_000))
    expect(within(feedStatus()).getByRole('status')).toHaveTextContent('Checking for new episodes…')
    act(() => void vi.advanceTimersByTime(1_000))

    expect(within(feedStatus()).queryByRole('status')).not.toBeInTheDocument()
    expect(within(feedStatus()).getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('says so when the request cannot be sent', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, show)
    const { user } = await renderSignedIn(data)
    await openShow(user)
    data.failNextRequest()

    await user.click(within(feedStatus()).getByRole('button', { name: 'Refresh' }))

    expect(await within(feedStatus()).findByRole('alert')).toHaveTextContent(
      'Couldn’t refresh. Check your connection and try again.',
    )
    expect(within(feedStatus()).getByRole('button', { name: 'Refresh' })).toBeEnabled()
    expect(data.refreshRequests()).toEqual([])
  })
})

describe('the latest episodes', () => {
  /** Two shows, with episodes published between them in turn. */
  function backendWithTwoShows() {
    const data = fakeDataApi()
    const showId = data.seedPodcast(showUrl, show)
    const otherId = data.seedPodcast(otherUrl, other)
    const [showOld, showNew] = data.ingest(showId, [
      { title: 'Show: oldest', publishedAt: '2026-11-01T08:00:00.000Z', durationSeconds: 1800 },
      { title: 'Show: newest', publishedAt: '2026-11-12T08:00:00.000Z', durationSeconds: 3600 },
      { title: 'Show: undated', publishedAt: null, durationSeconds: null },
    ])
    data.ingest(otherId, [{ title: 'Other: middle', publishedAt: '2026-11-05T08:00:00.000Z', durationSeconds: 2700 }])
    return { data, showId, otherId, showOld, showNew }
  }

  async function openLatest(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Latest' }))
    await screen.findByRole('heading', { name: 'Latest episodes', level: 1 })
  }

  async function latestItems() {
    return within(await screen.findByRole('list', { name: 'Latest episodes' })).getAllByRole('listitem')
  }

  const headings = (items: HTMLElement[]) => items.map((item) => within(item).getByRole('heading').textContent)

  it('lists the dated episodes of every subscription together, newest first, with their podcast', async () => {
    const { data } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)

    await openLatest(user)

    const items = await latestItems()
    expect(headings(items)).toEqual(['Show: newest', 'Other: middle', 'Show: oldest'])
    expect(items[0]).toHaveTextContent('The Example Show')
    expect(items[0]).toHaveTextContent('1 hr')
    expect(items[0].querySelector('time')).toHaveAttribute('dateTime', '2026-11-12T08:00:00.000Z')
    expect(items[1]).toHaveTextContent('The Other Show')
  })

  it('shows each episode’s podcast artwork beside it, or a blank tile when the podcast has none', async () => {
    const { data } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)

    await openLatest(user)

    const [showNewest, otherMiddle] = await latestItems()
    expect(showNewest.querySelector('img.artwork')).toHaveAttribute('src', show.artworkUrl)
    expect(otherMiddle.querySelector('img')).not.toBeInTheDocument()
    expect(otherMiddle.querySelector('.artwork')).toBeInTheDocument()
  })

  it('shows new episodes as they are found, without a reload', async () => {
    const { data, otherId } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openLatest(user)

    act(() => {
      data.ingest(otherId, [{ title: 'Other: just out', publishedAt: '2026-11-14T08:00:00.000Z', durationSeconds: 60 }])
    })

    await screen.findByRole('button', { name: 'Other: just out' })
    expect(headings(await latestItems())).toEqual(['Other: just out', 'Show: newest', 'Other: middle', 'Show: oldest'])
  })

  it('calls only a podcast’s most recent episode new, while it is under three days old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse('2026-11-13T09:00:00.000Z'))
    const { data, showId } = backendWithTwoShows()
    data.ingest(showId, [{ title: 'Show: the day before', publishedAt: '2026-11-11T08:00:00.000Z', durationSeconds: 1800 }])
    const { user } = await renderSignedIn(data)

    await openLatest(user)

    const [newest, dayBefore, otherMiddle] = await latestItems()
    expect(within(newest).getByText('New')).toBeInTheDocument()
    expect(within(dayBefore).queryByText('New')).not.toBeInTheDocument()
    // Its podcast's latest, but out eight days ago.
    expect(within(otherMiddle).queryByText('New')).not.toBeInTheDocument()
  })

  it('shows how far through each episode is, and resumes one where it was left', async () => {
    const { data, showId, showOld, showNew } = backendWithTwoShows()
    data.seedEpisodeState({ episodeId: showOld, podcastId: showId, positionSeconds: 0, played: true })
    data.seedEpisodeState({ episodeId: showNew, podcastId: showId, positionSeconds: 600, played: false })
    const { audio, user } = await renderSignedIn(data)
    await openLatest(user)

    const [newest, , oldest] = await latestItems()
    expect(oldest).toHaveTextContent('Played')
    expect(newest).toHaveTextContent('50 min left')

    await user.click(within(newest).getByRole('button', { name: 'Show: newest' }))

    expect(audio.currentTime).toBe(600)
    expect(audio.paused).toBe(false)
  })

  it('queues an episode from the list', async () => {
    const { data } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openLatest(user)

    await chooseAction(user, (await latestItems())[1], 'Add to queue')

    expect(within((await latestItems())[1]).getByText('Queued')).toBeInTheDocument()
  })

  it('says when there are no episodes yet, and goes back to the library', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, show)
    const { user } = await renderSignedIn(data)
    await openLatest(user)

    expect(await screen.findByText('No episodes yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Library' }))
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  describe('quick filters', () => {
    const filter = (name: string | RegExp) =>
      within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name })

    it('shows all of them at first, with how many there are', async () => {
      const { data } = backendWithTwoShows()
      const { user } = await renderSignedIn(data)
      await openLatest(user)

      await latestItems()
      expect(filter('All (3)')).toHaveAttribute('aria-pressed', 'true')
      expect(filter('Unplayed')).toHaveAttribute('aria-pressed', 'false')
    })

    it('narrows the list to those unplayed, then back to all', async () => {
      const { data, showId, showOld, showNew } = backendWithTwoShows()
      data.seedEpisodeState({ episodeId: showOld, podcastId: showId, positionSeconds: 0, played: true })
      data.seedEpisodeState({ episodeId: showNew, podcastId: showId, positionSeconds: 600, played: false })
      const { user } = await renderSignedIn(data)
      await openLatest(user)
      await latestItems()

      await user.click(filter('Unplayed'))

      expect(filter('Unplayed')).toHaveAttribute('aria-pressed', 'true')
      expect(headings(await latestItems())).toEqual(['Show: newest', 'Other: middle'])

      await user.click(filter(/^All/))
      expect(headings(await latestItems())).toEqual(['Show: newest', 'Other: middle', 'Show: oldest'])
    })

    it('narrows the list to the favorites’ episodes, or says there are none', async () => {
      const data = fakeDataApi()
      const showId = data.seedPodcast(showUrl, { ...show, favoriteOrder: 1 })
      const otherId = data.seedPodcast(otherUrl, other)
      data.ingest(showId, [{ title: 'Show: one', publishedAt: '2026-11-01T08:00:00.000Z', durationSeconds: 1800 }])
      data.ingest(otherId, [{ title: 'Other: one', publishedAt: '2026-11-05T08:00:00.000Z', durationSeconds: 1800 }])
      const { user } = await renderSignedIn(data)
      await openLatest(user)
      await latestItems()

      await user.click(filter('Favorites'))

      expect(headings(await latestItems())).toEqual(['Show: one'])
    })

    it('says when no episode passes the filter', async () => {
      const { data } = backendWithTwoShows()
      const { user } = await renderSignedIn(data)
      await openLatest(user)
      await latestItems()

      await user.click(filter('Favorites'))

      expect(await screen.findByText('No episodes from your favorites.')).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'Latest episodes' })).not.toBeInTheDocument()
    })

    it('narrows the list to those under 30 minutes', async () => {
      const { data, otherId } = backendWithTwoShows()
      data.ingest(otherId, [{ title: 'Other: quick', publishedAt: '2026-11-06T08:00:00.000Z', durationSeconds: 19 * 60 }])
      const { user } = await renderSignedIn(data)
      await openLatest(user)
      await latestItems()

      await user.click(filter('< 30 min'))

      expect(headings(await latestItems())).toEqual(['Other: quick'])
    })
  })

  it('says when the list cannot be loaded', async () => {
    const data = fakeDataApi()
    data.seedPodcast(showUrl, show)
    // Never delivered, so the device has no copy of it to fall back on.
    data.observeLatestEpisodes = (observer) => {
      queueMicrotask(() => observer.error())
      return () => {}
    }
    const { user } = await renderSignedIn(data)

    await openLatest(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the latest episodes.')
  })
})

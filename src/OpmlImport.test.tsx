import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FEED_DEADLINE_MS } from './opmlImport'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { openLibrary } from './test/ui'

// Importing an OPML file: bringing every subscription over from another podcast app.

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

async function renderSignedIn(data: ReturnType<typeof fakeDataApi>) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  return { user }
}

/** An OPML export as podcast apps write one, listing these feeds (nested in a folder, as some apps do). */
function opml(feeds: { title: string; feedUrl: string }[]) {
  const outlines = feeds
    .map(({ title, feedUrl }) => `<outline type="rss" text="${title}" title="${title}" xmlUrl="${feedUrl}" />`)
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<opml version="2.0">
  <head><title>My subscriptions</title></head>
  <body><outline text="Podcasts">${outlines}</outline></body>
</opml>`
}

async function importFile(user: ReturnType<typeof userEvent.setup>, contents: string, name = 'subscriptions.opml') {
  await user.upload(screen.getByLabelText('Import OPML file'), new File([contents], name, { type: 'text/x-opml' }))
}

function libraryTitles() {
  const list = screen.queryByRole('list', { name: 'Podcasts' })
  return list ? within(list).getAllByRole('listitem').map((item) => within(item).getByText(/Show/).textContent) : []
}

/** Lets the backend finish every pending subscribe, again and again, until the import's summary shows. */
async function finishImport(data: ReturnType<typeof fakeDataApi>) {
  await waitFor(() => {
    act(() => data.finishSubscribing())
    expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent('Import finished')
  })
}


const feed = (n: number) => ({ title: `Show ${n}`, feedUrl: `https://feeds.example.com/${n}.xml` })

describe('importing an OPML file', () => {
  it('subscribes to every feed in it', async () => {
    const data = fakeDataApi()
    const feeds = [feed(1), feed(2), feed(3)]
    feeds.forEach(({ title, feedUrl }) => data.publishFeed(feedUrl, { title }))
    const { user } = await renderSignedIn(data)

    await importFile(user, opml(feeds))
    await finishImport(data)

    expect(libraryTitles()).toEqual(['Show 1', 'Show 2', 'Show 3'])
    expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent(
      'Import finished: 3 added, 0 already in your library, 0 failed.',
    )
  })

  it('skips feeds already in the library, and feeds listed twice', async () => {
    const data = fakeDataApi()
    data.seedPodcast(feed(1).feedUrl, { title: 'Show 1' })
    data.publishFeed(feed(2).feedUrl, { title: 'Show 2' })
    const { user } = await renderSignedIn(data)

    await importFile(user, opml([feed(1), feed(2), feed(2)]))
    await finishImport(data)

    expect(libraryTitles()).toEqual(['Show 1', 'Show 2'])
    expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent(
      'Import finished: 1 added, 1 already in your library, 0 failed.',
    )
  })

  it('ends with a summary naming the feeds it could not add', async () => {
    const data = fakeDataApi()
    data.publishFeed(feed(1).feedUrl, { title: 'Show 1' })
    data.publishWebPage(feed(3).feedUrl)
    const { user } = await renderSignedIn(data)

    await importFile(
      user,
      opml([feed(1), { title: 'Gone Show', feedUrl: feed(2).feedUrl }, { title: 'Page Show', feedUrl: feed(3).feedUrl }, { title: 'FTP Show', feedUrl: 'ftp://example.com/feed' }]),
    )
    await finishImport(data)

    const summary = screen.getByRole('status', { name: 'OPML import' })
    expect(summary).toHaveTextContent('Import finished: 1 added, 0 already in your library, 3 failed.')
    expect(within(summary).getByRole('list', { name: 'Feeds not added' })).toHaveTextContent(/Gone Show.*Page Show.*FTP Show/)
    expect(libraryTitles()).toEqual(['Show 1'])
  })

  it('counts a feed as failed when the network drops while subscribing to it', async () => {
    const data = fakeDataApi()
    data.publishFeed(feed(1).feedUrl, { title: 'Show 1' })
    const { user } = await renderSignedIn(data)
    data.failNextRequest()

    await importFile(user, opml([feed(1)]))

    expect(await screen.findByRole('status', { name: 'OPML import' })).toHaveTextContent(
      'Import finished: 0 added, 0 already in your library, 1 failed.',
    )
  })

  it('still finishes when a feed’s outcome never arrives, counting that feed as failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const data = fakeDataApi()
      data.publishFeed(feed(1).feedUrl, { title: 'Show 1' })
      const auth = fakeAuth(owner)
      await auth.signIn(owner.email, owner.password)
      render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await openLibrary(user)

      await importFile(user, opml([feed(1)]))
      await screen.findByRole('status', { name: 'OPML import' })
      // The live update saying how the check ended is missed, as when iOS suspends the app.
      data.sleep()
      act(() => data.finishSubscribing())
      data.wake()
      await act(() => vi.advanceTimersByTimeAsync(FEED_DEADLINE_MS))

      expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent(
        'Import finished: 0 added, 0 already in your library, 1 failed.',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['a web page', '<!doctype html><html><body><p>Hello</p></body></html>'],
    ['an RSS feed', '<?xml version="1.0"?><rss version="2.0"><channel><title>A Show</title></channel></rss>'],
    ['not XML at all', '{"subscriptions": []}'],
    ['cut off part-way', opml([feed(1)]).slice(0, 120)],
  ])('says clearly when the file is not valid OPML (%s), and subscribes to nothing', async (_kind, contents) => {
    const data = fakeDataApi()
    const { user } = await renderSignedIn(data)

    await importFile(user, contents, 'export.xml')

    expect(await screen.findByRole('alert')).toHaveTextContent('That file isn’t a valid OPML file.')
    expect(libraryTitles()).toEqual([])
  })

  it('refuses a file over 5 MB without reading it', async () => {
    const data = fakeDataApi()
    data.publishFeed(feed(1).feedUrl, { title: 'Show 1' })
    const { user } = await renderSignedIn(data)
    const contents = opml([feed(1)])
    const file = new File([contents, ' '.repeat(5 * 1024 * 1024)], 'huge.opml', { type: 'text/x-opml' })
    const read = vi.spyOn(file, 'text')

    await user.upload(screen.getByLabelText('Import OPML file'), file)

    expect(await screen.findByRole('alert')).toHaveTextContent('That file is too big for an OPML file (over 5 MB).')
    expect(read).not.toHaveBeenCalled()
    act(() => data.finishSubscribing())
    expect(libraryTitles()).toEqual([])
  })

  it('says so when the OPML file lists no feeds', async () => {
    const { user } = await renderSignedIn(fakeDataApi())

    await importFile(user, opml([]))

    expect(await screen.findByRole('alert')).toHaveTextContent('That OPML file lists no podcast feeds.')
  })

  it('handles a large file a few feeds at a time, showing podcasts as they are added and leaving the app usable', async () => {
    const data = fakeDataApi()
    const feeds = Array.from({ length: 60 }, (_, i) => feed(i + 1))
    feeds.forEach(({ title, feedUrl }) => data.publishFeed(feedUrl, { title }))
    const { user } = await renderSignedIn(data)

    await importFile(user, opml(feeds))
    const progress = await screen.findByRole('status', { name: 'OPML import' })
    expect(progress).toHaveTextContent('Importing podcasts: 0 of 60 done')

    act(() => data.finishSubscribing())
    await waitFor(() => expect(libraryTitles().length).toBeGreaterThan(0))
    const firstBatch = libraryTitles().length
    expect(firstBatch).toBeLessThan(60)
    expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent(`Importing podcasts: ${firstBatch} of 60 done`)

    // The app carries on as normal while the import runs, and the import carries on behind it.
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    expect(await screen.findByRole('heading', { name: 'Queue' })).toBeInTheDocument()
    act(() => data.finishSubscribing())
    await user.click(screen.getByRole('button', { name: 'Library' }))

    await finishImport(data)
    expect(libraryTitles()).toHaveLength(60)
    expect(screen.getByRole('status', { name: 'OPML import' })).toHaveTextContent(
      'Import finished: 60 added, 0 already in your library, 0 failed.',
    )
  })
})

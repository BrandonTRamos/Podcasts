import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show' }

/** In the library: the feed's newest. */
const sequel = { title: 'Episode 12: The Roman Sequel', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 3600 }
const cafe = { title: 'Episode 11: Café Society', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 }
const guest = {
  title: 'Episode 10: An Interview',
  publishedAt: '2026-10-27T08:00:00.000Z',
  durationSeconds: 1800,
  showNotes: '<p>With a historian of <b>Rome</b>.</p>',
}
/** Further back in the feed than the library keeps. */
const fall = { title: 'Episode 2: The Fall of Rome', publishedAt: '2019-02-01T08:00:00.000Z', durationSeconds: 4000 }
const founding = { title: 'Episode 1: Romulus', publishedAt: '2019-01-01T08:00:00.000Z', durationSeconds: 1500, showNotes: 'How Rome began.' }

/**
 * A library holding the show, its newest three episodes stored and two older
 * ones only in its feed, open on the show.
 */
async function renderShow({ data = fakeDataApi(), sequelPlayed = false } = {}) {
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [sequelId, cafeId, guestId] = data.ingest(podcastId, [sequel, cafe, guest])
  if (sequelPlayed) data.seedEpisodeState({ episodeId: sequelId, podcastId, positionSeconds: 3600, played: true })
  const [fallId, foundingId] = data.publishOlderEpisodes(podcastId, [fall, founding])
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, data, user, podcastId, sequelId, cafeId, guestId, fallId, foundingId }
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search episodes' })
const titlesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole('heading')
    .map((heading) => heading.textContent)
/** The titles in the podcast's own list, top to bottom. */
const listed = () => titlesIn(screen.getByRole('list', { name: 'Episodes' }))
const older = () => screen.getByRole('region', { name: 'Older episodes' })
/** The titles the search of the feed added under the list, once it has answered. */
const moreFromFeed = async () => titlesIn(await screen.findByRole('list', { name: 'More from the feed' }))
const searchOlder = () => within(older()).getByRole('button', { name: 'Search older episodes' })

function rowIn(list: HTMLElement, title: string) {
  const item = within(list)
    .getAllByRole('listitem')
    .find((li) => within(li).queryByRole('heading', { name: title }))
  if (!item) throw new Error(`No episode "${title}" in the list`)
  return item
}

describe('searching a podcast’s episodes', () => {
  it('filters the list to the titles with every word, as it is typed, without asking the feed', async () => {
    const { data, user } = await renderShow()

    await user.type(searchBox(), 'rom')
    expect(listed()).toEqual([sequel.title])

    await user.clear(searchBox())
    await user.type(searchBox(), 'society CAFE')
    expect(listed()).toEqual([cafe.title])

    await user.clear(searchBox())
    expect(listed()).toEqual([sequel.title, cafe.title, guest.title])
    expect(screen.queryByRole('region', { name: 'Older episodes' })).not.toBeInTheDocument()
    expect(data.episodeSearches()).toEqual([])
  })

  it('says so when no title matches, and still offers to search older episodes', async () => {
    const { user } = await renderShow()

    await user.type(searchBox(), 'carthage')

    expect(screen.getByText('No episode titles match “carthage”.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Episodes' })).not.toBeInTheDocument()
    expect(searchOlder()).toBeInTheDocument()
  })

  it('searches among the unplayed only when asked to', async () => {
    const { user } = await renderShow({ sequelPlayed: true })
    await user.click(screen.getByRole('checkbox', { name: 'Unplayed only' }))

    await user.type(searchBox(), 'episode 1')
    expect(listed()).toEqual([cafe.title, guest.title])

    await user.clear(searchBox())
    await user.type(searchBox(), 'roman')
    expect(screen.getByText('No unplayed episode titles match “roman”.')).toBeInTheDocument()
  })

  it('is still searching for the same words on coming back from an episode, and for nothing on opening the podcast again', async () => {
    const { user } = await renderShow()
    await user.type(searchBox(), 'cafe')

    await chooseAction(user, rowIn(screen.getByRole('list', { name: 'Episodes' }), cafe.title), 'Show notes')
    await screen.findByRole('heading', { level: 1, name: cafe.title })
    await user.click(screen.getByRole('button', { name: /Back to/ }))

    expect(searchBox()).toHaveValue('cafe')
    expect(listed()).toEqual([cafe.title])

    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
    await screen.findByRole('list', { name: 'Episodes' })

    expect(searchBox()).toHaveValue('')
    expect(listed()).toEqual([sequel.title, cafe.title, guest.title])
  })
})

describe('searching a podcast’s older episodes', () => {
  it('finds episodes the library doesn’t keep, and those whose show notes match, under the list', async () => {
    const { data, user, podcastId } = await renderShow()
    await user.type(searchBox(), 'rome')
    // No stored title has the word "Rome": the sequel's "Roman" begins differently.
    expect(screen.getByText('No episode titles match “rome”.')).toBeInTheDocument()

    await user.click(searchOlder())

    // Newest first. The interview is in the library, found by its show notes.
    expect(await moreFromFeed()).toEqual([guest.title, fall.title, founding.title])
    expect(data.episodeSearches()).toEqual([{ podcastId, term: 'rome' }])
    const list = screen.getByRole('list', { name: 'More from the feed' })
    expect(within(rowIn(list, guest.title)).getByRole('button', { name: 'More actions' })).toBeInTheDocument()
    expect(within(rowIn(list, fall.title)).getByRole('button', { name: `Add ${fall.title}` })).toBeInTheDocument()
    expect(rowIn(list, fall.title)).toHaveTextContent('Feb 1, 2019 · 1 hr 7 min')
    expect(screen.queryByRole('button', { name: 'Search older episodes' })).not.toBeInTheDocument()
  })

  it('searches the feed on the keyboard’s search key too, and doesn’t repeat the episodes already listed', async () => {
    const { user } = await renderShow()

    await user.type(searchBox(), 'rom{Enter}')

    expect(await moreFromFeed()).toEqual([guest.title, fall.title, founding.title])
    expect(listed()).toEqual([sequel.title])
  })

  it('adds an older episode to the podcast’s episodes, to play like any other', async () => {
    const { audio, data, user, fallId } = await renderShow()
    await user.type(searchBox(), 'fall{Enter}')
    const list = await screen.findByRole('list', { name: 'More from the feed' })

    await user.click(within(list).getByRole('button', { name: `Add ${fall.title}` }))

    // It stays where it was found, now with an episode's actions.
    await waitFor(() => expect(within(rowIn(list, fall.title)).getByRole('button', { name: 'More actions' })).toBeInTheDocument())
    expect(within(list).queryByRole('button', { name: `Add ${fall.title}` })).not.toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: fall.title }))
    expect(audio.src).toBe(`https://media.example.com/${fallId}.mp3`)

    await chooseAction(user, rowIn(list, fall.title), 'Add to queue')
    await waitFor(() => expect(data.savedState(fallId)?.queueOrder).not.toBeNull())

    // With the search cleared it is among the podcast's episodes, in date order.
    await user.clear(searchBox())
    expect(listed()).toEqual([sequel.title, cafe.title, guest.title, fall.title])
  })

  it('says so when the feed has nothing more', async () => {
    const { user } = await renderShow()

    await user.type(searchBox(), 'sequel{Enter}')

    expect(await within(older()).findByText('Nothing more in the feed matches “sequel”.')).toBeInTheDocument()
    expect(listed()).toEqual([sequel.title])
  })

  it('says when there are more matches than it shows', async () => {
    const data = fakeDataApi()
    const { user, podcastId } = await renderShow({ data })
    data.publishOlderEpisodes(
      podcastId,
      Array.from({ length: 60 }, (_, index) => ({
        title: `Archive ${index + 1}`,
        publishedAt: new Date(Date.UTC(2015, 0, index + 1)).toISOString(),
        durationSeconds: null,
      })),
    )

    await user.type(searchBox(), 'archive{Enter}')

    expect(await moreFromFeed()).toHaveLength(50)
    expect(within(older()).getByText(/newest 50 matches/)).toBeInTheDocument()
  })

  it('shows a search of the feed only for the words it was for', async () => {
    const { data, user } = await renderShow()
    data.holdEpisodeSearches()
    await user.type(searchBox(), 'romulus{Enter}')
    expect(await within(older()).findByText('Searching the feed…')).toBeInTheDocument()

    // The words change before it answers: its answer is for other words.
    await user.clear(searchBox())
    await user.type(searchBox(), 'fall')
    data.releaseEpisodeSearches()

    await waitFor(() => expect(data.episodeSearches()).toHaveLength(1))
    expect(searchOlder()).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'More from the feed' })).not.toBeInTheDocument()

    await user.click(searchOlder())
    expect(await moreFromFeed()).toEqual([fall.title])
  })

  it('says so when the podcast’s feed can’t be reached, and can try again', async () => {
    const { data, user, podcastId } = await renderShow()
    data.breakFeedOf(podcastId)

    await user.type(searchBox(), 'rome{Enter}')

    expect(await within(older()).findByRole('alert')).toHaveTextContent('Couldn’t reach the podcast’s feed. Try again later.')

    data.repairFeedOf(podcastId)
    await user.click(searchOlder())

    expect(await moreFromFeed()).toEqual([guest.title, fall.title, founding.title])
    expect(within(older()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when the search can’t be sent, and can try again', async () => {
    const { data, user } = await renderShow()
    data.failNextRequest()

    await user.type(searchBox(), 'rome{Enter}')

    expect(await within(older()).findByRole('alert')).toHaveTextContent('Couldn’t search. Check your connection and try again.')

    await user.click(searchOlder())

    expect(await moreFromFeed()).toEqual([guest.title, fall.title, founding.title])
  })

  it.each([
    ['the feed has dropped the episode', 'The feed no longer lists this episode.'],
    ['the feed can’t be reached', 'Couldn’t reach the podcast’s feed. Try again later.'],
    ['the request can’t be sent', 'Couldn’t add it. Check your connection and try again.'],
  ])('says so when an episode can’t be added because %s, and leaves it to try again', async (_case, message) => {
    const { data, user, podcastId, fallId } = await renderShow()
    await user.type(searchBox(), 'fall{Enter}')
    const list = await screen.findByRole('list', { name: 'More from the feed' })
    if (message.startsWith('The feed no longer')) data.withdrawOlderEpisode(fallId)
    else if (message.startsWith('Couldn’t reach')) data.breakFeedOf(podcastId)
    else data.failNextRequest()

    await user.click(within(list).getByRole('button', { name: `Add ${fall.title}` }))

    expect(await within(rowIn(list, fall.title)).findByRole('alert')).toHaveTextContent(message)
    expect(within(list).getByRole('button', { name: `Add ${fall.title}` })).toBeEnabled()
  })
})

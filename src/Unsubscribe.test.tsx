import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openLibrary } from './test/ui'

// Unsubscribing: a show leaves the library, with its episodes and the listener's place in them.

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show' }
const other = { title: 'Another Show' }
const first = { title: 'Episode 1: The Beginning', publishedAt: '2026-11-03T08:00:00.000Z', durationSeconds: 2700 }
const second = { title: 'Episode 2: The Sequel', publishedAt: '2026-11-10T08:00:00.000Z', durationSeconds: 3723 }
const elsewhere = {
  title: 'Elsewhere 1: Hello',
  publishedAt: '2026-11-05T08:00:00.000Z',
  durationSeconds: 1800,
  enclosureUrl: 'https://media.example.com/other/1.mp3',
}

/** A library of two shows, the first with two episodes, one part-played and queued, the other with one queued. */
function backendWithTwoShows() {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const otherId = data.seedPodcast('https://feeds.example.com/other.xml', other)
  const [firstId, secondId] = data.ingest(podcastId, [first, second])
  const [elsewhereId] = data.ingest(otherId, [elsewhere])
  data.seedEpisodeState({ episodeId: firstId, podcastId, positionSeconds: 600, played: false, queueOrder: 1 })
  data.seedEpisodeState({ episodeId: elsewhereId, podcastId: otherId, positionSeconds: 0, played: false, queueOrder: 2 })
  return { data, podcastId, otherId, firstId, secondId, elsewhereId }
}

async function renderSignedIn(data: ReturnType<typeof fakeDataApi>) {
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  return { audio, user }
}

async function openShow(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }))
  await screen.findByRole('list', { name: 'Episodes' })
}

async function play(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(within(screen.getByRole('list', { name: 'Episodes' })).getByRole('button', { name: title }))
}

/** Asks to unsubscribe from the open show and confirms. */
async function unsubscribe(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
  const dialog = screen.getByRole('alertdialog', { name: `Unsubscribe from ${show.title}?` })
  await user.click(within(dialog).getByRole('button', { name: 'Unsubscribe' }))
}

function libraryTitles() {
  const list = screen.queryByRole('list', { name: 'Podcasts' })
  return list ? within(list).getAllByRole('listitem').map((item) => item.textContent) : []
}

describe('unsubscribing from a podcast', () => {
  it('asks first, and changes nothing if the listener cancels', async () => {
    const { data, podcastId } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openShow(user, show.title)

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }))
    const dialog = screen.getByRole('alertdialog', { name: `Unsubscribe from ${show.title}?` })
    expect(dialog).toHaveTextContent('Its episodes and your place in them will be removed')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(data.podcastIdFor('https://feeds.example.com/show.xml')).toBe(podcastId)
  })

  it('removes the podcast, its episodes and their listening state, and returns to the library', async () => {
    const { data, firstId, otherId, elsewhereId } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openShow(user, show.title)

    await unsubscribe(user)

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(libraryTitles()).toEqual([other.title])
    expect(data.podcastIdFor('https://feeds.example.com/show.xml')).toBeUndefined()
    expect(data.savedState(firstId)).toBeUndefined()
    expect(data.savedState(elsewhereId)).toMatchObject({ podcastId: otherId, queueOrder: 2 })

    await user.click(screen.getByRole('button', { name: 'Latest' }))
    const latest = await screen.findByRole('list', { name: 'Latest episodes' })
    expect(within(latest).getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      elsewhere.title,
    ])
  })

  it('takes its episodes off the queue, leaving the rest queued', async () => {
    const { data } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openShow(user, show.title)

    await unsubscribe(user)
    await user.click(await screen.findByRole('button', { name: 'Queue' }))

    const queue = await screen.findByRole('list', { name: 'Queued episodes' })
    expect(within(queue).getAllByRole('listitem').map((item) => within(item).getByRole('heading').textContent)).toEqual([
      elsewhere.title,
    ])
  })

  it('stops an episode of it that is playing, without saving its place again', async () => {
    const { data, firstId } = backendWithTwoShows()
    const { audio, user } = await renderSignedIn(data)
    await openShow(user, show.title)
    await play(user, first.title)
    audio.loadMetadata(2700)
    audio.progressTo(900)
    expect(audio.paused).toBe(false)

    await unsubscribe(user)

    await screen.findByRole('heading', { name: 'Library' })
    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
    expect(screen.queryByRole('region', { name: 'Mini player' })).not.toBeInTheDocument()
    expect(data.savedState(firstId)).toBeUndefined()
  })

  it('does not move on to a queued episode of it when the playing one ends', async () => {
    const { data } = backendWithTwoShows()
    const { audio, user } = await renderSignedIn(data)
    await openShow(user, other.title)
    await play(user, elsewhere.title)
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await openShow(user, show.title)
    await chooseAction(
      user,
      within(screen.getByRole('list', { name: 'Episodes' }))
        .getAllByRole('listitem')
        .find((item) => within(item).queryByRole('heading', { name: second.title }))!,
      'Play next',
    )

    await unsubscribe(user)
    await screen.findByRole('heading', { name: 'Library' })
    audio.loadMetadata(1800)
    audio.playToEnd()

    expect(audio.src).toBe(elsewhere.enclosureUrl)
    expect(screen.getByRole('region', { name: 'Mini player' })).toHaveTextContent(elsewhere.title)
  })

  it('leaves an episode of another podcast playing', async () => {
    const { data } = backendWithTwoShows()
    const { audio, user } = await renderSignedIn(data)
    await openShow(user, other.title)
    await play(user, elsewhere.title)
    await user.click(screen.getByRole('button', { name: 'Back to library' }))
    await openShow(user, show.title)

    await unsubscribe(user)

    await screen.findByRole('heading', { name: 'Library' })
    expect(audio.paused).toBe(false)
    expect(screen.getByRole('region', { name: 'Mini player' })).toHaveTextContent(elsewhere.title)
  })

  it('says so when it fails, and keeps the podcast', async () => {
    const { data, podcastId } = backendWithTwoShows()
    const { user } = await renderSignedIn(data)
    await openShow(user, show.title)
    data.failNextRequest()

    await unsubscribe(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t unsubscribe. Check your connection and try again.')
    expect(screen.getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(data.podcastIdFor('https://feeds.example.com/show.xml')).toBe(podcastId)
  })
})

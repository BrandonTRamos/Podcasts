import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseAction, openLibrary, openShowNotes } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

const episode = (title: string, day: number) => ({
  title,
  publishedAt: `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`,
  durationSeconds: 3600,
})

/**
 * Two shows. Of the Daily Brief's episodes, Monday is half heard, Tuesday
 * played and Wednesday never started; Reel Talk's Premiere was heard last.
 */
function backendWithListening() {
  const data = fakeDataApi()
  const daily = data.seedPodcast('https://feeds.example.com/daily.xml', { title: 'The Daily Brief' })
  const reel = data.seedPodcast('https://feeds.example.com/reel.xml', { title: 'Reel Talk' })
  const [monday, tuesday, wednesday] = data.ingest(daily, [episode('Monday', 2), episode('Tuesday', 3), episode('Wednesday', 4)])
  const [premiere] = data.ingest(reel, [episode('Premiere', 1)])
  data.seedEpisodeState({ episodeId: monday, podcastId: daily, positionSeconds: 1800, played: false })
  data.seedEpisodeState({ episodeId: tuesday, podcastId: daily, positionSeconds: 3600, played: true })
  data.seedEpisodeState({ episodeId: premiere, podcastId: reel, positionSeconds: 600, played: false })
  return { data, daily, reel, monday, tuesday, wednesday, premiere }
}

/** Opens TinCan with the owner signed in, on their library. */
async function launch(data: ReturnType<typeof fakeDataApi>) {
  const device = new FakeDevice()
  const auth = fakeAuth(owner, { device })
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  return { user, audio }
}

type User = ReturnType<typeof userEvent.setup>

const inProgressTab = () => screen.getByRole('tab', { name: 'In Progress' })
const podcastsTab = () => screen.getByRole('tab', { name: 'Podcasts' })

async function openInProgress(user: User) {
  await user.click(inProgressTab())
  return screen.findByRole('list', { name: 'In progress' })
}

/** The episode titles listed in progress, top to bottom. */
const titlesInProgress = () =>
  within(screen.getByRole('list', { name: 'In progress' }))
    .getAllByRole('listitem')
    .map((item) => within(item).getByRole('heading').textContent)

const rowInProgress = (title: string) =>
  within(screen.getByRole('list', { name: 'In progress' })).getByRole('heading', { name: title }).closest('li')!

describe('the library’s In Progress tab', () => {
  it('sits beside Podcasts at the top of the library, which opens on Podcasts', async () => {
    const { data } = backendWithListening()
    await launch(data)

    expect(podcastsTab()).toHaveAttribute('aria-selected', 'true')
    expect(inProgressTab()).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByRole('list', { name: 'Podcasts' })).toBeInTheDocument()
  })

  it('lists every episode started but not finished, from every show, the one heard last first', async () => {
    const { data } = backendWithListening()
    const { user } = await launch(data)

    await openInProgress(user)

    expect(inProgressTab()).toHaveAttribute('aria-selected', 'true')
    expect(titlesInProgress()).toEqual(['Premiere', 'Monday'])
    expect(within(rowInProgress('Premiere')).getByText('Reel Talk')).toBeInTheDocument()
    expect(within(rowInProgress('Monday')).getByText('30 min left')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Podcasts' })).not.toBeInTheDocument()
  })

  it('resumes an episode where it was left', async () => {
    const { data, monday } = backendWithListening()
    const { user, audio } = await launch(data)
    await openInProgress(user)

    await user.click(within(rowInProgress('Monday')).getByRole('button', { name: 'Monday' }))

    expect(audio.src).toBe(`https://media.example.com/${monday}.mp3`)
    expect(audio.currentTime).toBe(1800)
  })

  it('lets an episode go as soon as it is marked played', async () => {
    const { data, monday } = backendWithListening()
    const { user } = await launch(data)
    await openInProgress(user)

    await chooseAction(user, rowInProgress('Monday'), 'Mark played')

    expect(titlesInProgress()).toEqual(['Premiere'])
    expect(data.savedState(monday)).toMatchObject({ played: true })
  })

  it('takes in an episode once it is paused part way through', async () => {
    const { data } = backendWithListening()
    const { user, audio } = await launch(data)
    await openInProgress(user)
    await user.click(podcastsTab())
    await user.click(await screen.findByRole('button', { name: /The Daily Brief/ }))
    await user.click(await screen.findByRole('button', { name: 'Wednesday' }))
    act(() => audio.progressTo(900))
    await user.click(within(screen.getByRole('region', { name: 'Mini player' })).getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Back to library' }))

    await openInProgress(user)

    expect(titlesInProgress()).toEqual(['Wednesday', 'Premiere', 'Monday'])
  })

  it('says when nothing is in progress', async () => {
    const data = fakeDataApi()
    data.seedPodcast('https://feeds.example.com/daily.xml', { title: 'The Daily Brief' })
    const { user } = await launch(data)

    await user.click(inProgressTab())

    expect(await screen.findByText(/Nothing in progress/)).toBeInTheDocument()
  })

  it('comes back to In Progress from an episode’s show notes', async () => {
    const { data } = backendWithListening()
    const { user } = await launch(data)
    await openInProgress(user)

    await openShowNotes(user, rowInProgress('Monday'))
    await user.click(await screen.findByRole('button', { name: 'Back to In Progress' }))

    expect(await screen.findByRole('list', { name: 'In progress' })).toBeInTheDocument()
    expect(inProgressTab()).toHaveAttribute('aria-selected', 'true')
  })
})

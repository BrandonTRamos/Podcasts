import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { chapterIndexAt, nextChapterStart, parseChapters, previousChapterStart } from './chapters'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', author: 'Example Media' }
const episode = {
  title: 'Episode 12: Open Podcasts',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 3600,
  enclosureUrl: 'https://media.example.com/show/ep12.mp3',
}

const chapterNotes =
  '<p>This week, open podcasts.</p><p>Chapters:</p>' +
  '<ul><li>00:00 Intro</li><li>(05:30) - Why RSS still wins</li><li>12:00 Local AI</li><li>2:05:00 Past the end</li></ul>'

/** Signs in to a library holding one episode with these show notes, plays it, and opens now playing. */
async function playWithNotes(showNotes: string | null) {
  const data = fakeDataApi()
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  data.ingest(podcastId, [{ ...episode, showNotes }])
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await user.click(await screen.findByRole('button', { name: episode.title }))
  const miniPlayer = screen.getByRole('region', { name: 'Mini player' })
  await user.click(within(miniPlayer).getByRole('button', { name: new RegExp(episode.title) }))
  act(() => audio.loadMetadata(3600))
  return { audio, user }
}

describe('chapters in now playing', () => {
  it('shows the chapter playing, and steps between chapters', async () => {
    const { audio, user } = await playWithNotes(chapterNotes)

    expect(await screen.findByText('Intro')).toBeInTheDocument()
    expect(screen.getByText('Ch 1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next chapter' }))
    expect(audio.currentTime).toBe(330)
    expect(screen.getByText('Why RSS still wins')).toBeInTheDocument()
    expect(screen.getByText('Ch 2 / 3')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next chapter' }))
    expect(audio.currentTime).toBe(720)
    // The chapter past the file's end is left out, so this is the last.
    expect(screen.getByText('Ch 3 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next chapter' })).toBeDisabled()

    // A minute in, back returns to this chapter's start; right at it, to the one before.
    act(() => audio.progressTo(780))
    await user.click(screen.getByRole('button', { name: 'Previous chapter' }))
    expect(audio.currentTime).toBe(720)
    await user.click(screen.getByRole('button', { name: 'Previous chapter' }))
    expect(audio.currentTime).toBe(330)
  })

  it('marks where each chapter starts on the seek bar', async () => {
    await playWithNotes(chapterNotes)
    await screen.findByText('Intro')

    const marks = screen.getByRole('slider', { name: 'Seek' }).style.getPropertyValue('--chapter-marks')
    expect(marks.match(/linear-gradient/g)).toHaveLength(2)
    expect(marks).toContain(`* ${330 / 3600})`)
    expect(marks).toContain(`* ${720 / 3600})`)
  })

  it('shows no chapters when the notes list none', async () => {
    await playWithNotes('<p>Recorded at 10:30 in the morning.</p>')
    await screen.findByRole('slider', { name: 'Seek' })

    expect(screen.queryByRole('button', { name: 'Next chapter' })).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' }).style.getPropertyValue('--chapter-marks')).toBe('')
  })
})

describe('finding chapters in show notes', () => {
  it('reads lines that start with a timestamp, in the forms feeds write them', () => {
    expect(
      parseChapters('00:00 Intro\n- (1:30) Bullet\n[1:02:03] - Bracketed\n3. 1:10:00 | Numbered\n1:20:00\n'),
    ).toEqual([
      { start: 0, title: 'Intro' },
      { start: 90, title: 'Bullet' },
      { start: 3723, title: 'Bracketed' },
      { start: 4200, title: 'Numbered' },
      { start: 4800, title: 'Chapter 5' },
    ])
  })

  it('reads lines that end with a timestamp when none start with one', () => {
    expect(parseChapters('<p>Intro (00:00)<br>Interview – 14:22<br>Wrap up [58:01]</p>')).toEqual([
      { start: 0, title: 'Intro' },
      { start: 862, title: 'Interview' },
      { start: 3481, title: 'Wrap up' },
    ])
  })

  it('reads table rows and decodes entities', () => {
    expect(parseChapters('<table><tr><td>00:00</td><td>Q&amp;A</td></tr><tr><td>05:30</td><td>Links</td></tr></table>')).toEqual([
      { start: 0, title: 'Q&A' },
      { start: 330, title: 'Links' },
    ])
  })

  it('finds none in a single timestamp, prose, or times out of order', () => {
    expect(parseChapters(null)).toEqual([])
    expect(parseChapters('05:00 The only one')).toEqual([])
    expect(parseChapters('We met at 10:30 and left at 11:45.')).toEqual([])
    expect(parseChapters('10:00 Later\n05:00 Earlier')).toEqual([])
  })

  it('finds where to step to from a position', () => {
    const chapters = [
      { start: 60, title: 'One' },
      { start: 300, title: 'Two' },
    ]
    expect(chapterIndexAt(chapters, 30)).toBe(-1)
    expect(chapterIndexAt(chapters, 60)).toBe(0)
    expect(chapterIndexAt(chapters, 400)).toBe(1)
    expect(nextChapterStart(chapters, 30)).toBe(60)
    expect(nextChapterStart(chapters, 400)).toBeNull()
    expect(previousChapterStart(chapters, 30)).toBeNull()
    expect(previousChapterStart(chapters, 302)).toBe(60)
    expect(previousChapterStart(chapters, 400)).toBe(300)
  })
})

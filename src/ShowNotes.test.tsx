import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeMediaSession } from './test/fakes'
import hostileShowNotes from './test/fixtures/hostile-show-notes.html?raw'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }
const show = { title: 'The Example Show', author: 'Example Media' }
const episode = {
  title: 'Episode 12: Links',
  publishedAt: '2026-11-03T08:00:00.000Z',
  durationSeconds: 3723,
  enclosureUrl: 'https://media.example.com/show/ep12.mp3',
}

/**
 * Signs in to a library holding one show with one episode, given these show
 * notes and listened to this far, and opens the show.
 */
async function renderShow(
  showNotes: string | null,
  { data = fakeDataApi(), positionSeconds }: { data?: FakeDataApi; positionSeconds?: number } = {},
) {
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [episodeId] = data.ingest(podcastId, [{ ...episode, showNotes }])
  if (positionSeconds !== undefined) data.seedEpisodeState({ episodeId, podcastId, positionSeconds, played: false })
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession() }} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, data, user, podcastId, episodeId }
}

/** Opens the episode's screen from the show's list. */
async function openEpisode(user: ReturnType<typeof userEvent.setup>) {
  const [item] = within(screen.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
  await user.click(within(item).getByRole('button', { name: 'Show notes' }))
  await screen.findByRole('heading', { level: 1, name: episode.title })
}

async function showNotes() {
  return await screen.findByRole('region', { name: 'Show notes' })
}

describe('an episode’s screen', () => {
  it('shows its title, podcast, date, duration and show notes', async () => {
    const { user } = await renderShow('<p>We talk about <strong>links</strong>.</p><p>Second paragraph.</p>')

    await openEpisode(user)

    expect(screen.getByText('The Example Show')).toBeInTheDocument()
    expect(screen.getByText('1 hr 2 min')).toBeInTheDocument()
    expect(screen.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(episode.publishedAt))))
      .toHaveAttribute('dateTime', episode.publishedAt)
    const notes = await showNotes()
    expect(within(notes).getByText('links').tagName).toBe('STRONG')
    expect(notes.querySelectorAll('p')).toHaveLength(2)
    expect(notes.querySelectorAll('p')[0]).toHaveTextContent('We talk about links.')
    expect(notes.querySelectorAll('p')[1]).toHaveTextContent('Second paragraph.')
  })

  it('plays the episode, resuming where the listener left off', async () => {
    const { audio, user } = await renderShow('<p>Notes.</p>', { positionSeconds: 600 })
    await openEpisode(user)

    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Play' }))

    expect(audio.src).toBe(episode.enclosureUrl)
    expect(audio.currentTime).toBe(600)
    expect(audio.paused).toBe(false)
    expect(screen.getByRole('region', { name: 'Mini player' })).toHaveTextContent(episode.title)
  })

  it('goes back to the show it was opened from', async () => {
    const { user } = await renderShow('<p>Notes.</p>')
    await openEpisode(user)

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'The Example Show' })).toBeInTheDocument()
  })

  it('says so when the episode has no show notes', async () => {
    const { user } = await renderShow(null)

    await openEpisode(user)

    expect(await showNotes()).toHaveTextContent('This episode has no show notes.')
  })

  it('says so when the show notes can’t be loaded', async () => {
    const data = fakeDataApi()
    const { user } = await renderShow('<p>Notes.</p>', { data })
    data.failNextRequest()

    await openEpisode(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the show notes.')
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })
})

describe('plain-text show notes', () => {
  it('keep their line breaks and paragraphs, with web addresses as links', async () => {
    const { user } = await renderShow(
      'In this episode:\n- the beginning\n- the end\n\nSponsor: https://example.com/sponsor. Background (https://example.com/wiki/Rome_(city)).\r\n\r\nThanks <3 &amp; see you',
    )

    await openEpisode(user)

    const notes = await showNotes()
    const paragraphs = notes.querySelectorAll('p')
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('In this episode:- the beginning- the end')
    expect(paragraphs[2]).toHaveTextContent('Thanks <3 & see you')
    expect(within(paragraphs[1] as HTMLElement).getByRole('link', { name: 'https://example.com/sponsor' })).toHaveAttribute(
      'href',
      'https://example.com/sponsor',
    )
    expect(within(paragraphs[1] as HTMLElement).getByRole('link', { name: 'https://example.com/wiki/Rome_(city)' })).toBeInTheDocument()
    expect(paragraphs[1]).toHaveTextContent('Rome_(city)).')
  })
})

describe('links in show notes', () => {
  it('open outside the app, with no way back into it', async () => {
    const { user } = await renderShow(
      '<p>Read <a href="https://example.com/article" target="_self" rel="opener">the article</a> or <a href="mailto:host@example.com">write in</a>.</p>',
    )

    await openEpisode(user)

    const notes = await showNotes()
    const article = within(notes).getByRole('link', { name: 'the article' })
    expect(article).toHaveAttribute('href', 'https://example.com/article')
    expect(article).toHaveAttribute('target', '_blank')
    expect(article.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(within(notes).getByRole('link', { name: 'write in' })).toHaveAttribute('href', 'mailto:host@example.com')
  })
})

describe('hostile show notes', () => {
  it('lose every script, event handler, frame and other active content, keeping the text around them', async () => {
    const { user } = await renderShow(hostileShowNotes)

    await openEpisode(user)
    const notes = await showNotes()

    // The harmless parts survive.
    expect(notes).toHaveTextContent('Thanks for listening to episode 12.')
    expect(notes).toHaveTextContent('See you next week.')
    expect(notes).toHaveTextContent('Chapter list')
    expect(within(notes).getByText('Click anywhere')).toBeInTheDocument()

    // No active or embedding element, and nothing that styles or restructures the page.
    const forbidden =
      'script, style, link, meta, base, iframe, frame, frameset, object, embed, applet, form, input, button, textarea, select, ' +
      'svg, math, template, noscript, img, video, audio, source, canvas'
    expect(notes.querySelectorAll(forbidden)).toHaveLength(0)

    // No attribute but a link's own href, target and rel.
    for (const element of Array.from(notes.querySelectorAll('*'))) {
      const allowed = element.tagName === 'A' ? ['href', 'target', 'rel'] : []
      for (const { name } of Array.from(element.attributes)) {
        expect(allowed, `<${element.tagName.toLowerCase()} ${name}>`).toContain(name)
      }
    }

    // The only link left is the web one, and it opens outside the app.
    const links = within(notes).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://example.com/sponsor'])
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0].getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    // Links to anywhere else keep their text.
    expect(notes).toHaveTextContent('javascript link')
    expect(notes).toHaveTextContent('relative link')

    // Nothing of the removed content leaks through as text, and none of it ran.
    expect(notes.textContent).not.toMatch(/pwned|alert|noscript text|display: none|Sign in|svg link/)
    expect((window as { pwned?: unknown }).pwned).toBeUndefined()
    expect(document.querySelectorAll('script, iframe, object, embed')).toHaveLength(0)
    expect(document.head.querySelector('base, meta[http-equiv], link[rel=stylesheet]')).toBeNull()
  })

  it('show only text if they are nothing but hostile markup', async () => {
    const { user } = await renderShow('<script>window.pwned = true</script><iframe src="https://evil.example.com/"></iframe>')

    await openEpisode(user)

    expect(await showNotes()).toHaveTextContent('This episode has no show notes.')
  })
})

describe('the episode screen’s place in the app', () => {
  it('opens from the latest episodes too, and goes back there', async () => {
    const data = fakeDataApi()
    const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
    data.ingest(podcastId, [{ ...episode, showNotes: 'Plain notes.' }])
    const auth = fakeAuth(owner)
    await auth.signIn(owner.email, owner.password)
    render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession() }} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Latest' }))
    const list = await screen.findByRole('list', { name: 'Latest episodes' })

    await user.click(within(list).getByRole('button', { name: 'Show notes' }))

    expect(await showNotes()).toHaveTextContent('Plain notes.')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Latest episodes' })).toBeInTheDocument()
  })
})

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, type FakeDataApi, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import hostileShowNotes from './test/fixtures/hostile-show-notes.html?raw'
import { chooseAction, openLibrary, openShowNotes } from './test/ui'

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
  { data = fakeDataApi(), positionSeconds, device = new FakeDevice() }: {
    data?: FakeDataApi
    positionSeconds?: number
    device?: FakeDevice
  } = {},
) {
  const podcastId = data.seedPodcast('https://feeds.example.com/show.xml', show)
  const [episodeId] = data.ingest(podcastId, [{ ...episode, showNotes }])
  if (positionSeconds !== undefined) data.seedEpisodeState({ episodeId, podcastId, positionSeconds, played: false })
  const auth = fakeAuth(owner)
  await auth.signIn(owner.email, owner.password)
  const audio = new FakeAudio()
  render(<App services={{ auth, data, audio, mediaSession: new FakeMediaSession(), device }} />)
  const user = userEvent.setup()
  await openLibrary(user)
  await user.click(await screen.findByRole('button', { name: /The Example Show/ }))
  await screen.findByRole('list', { name: 'Episodes' })
  return { audio, data, user, podcastId, episodeId, device }
}

/** Opens the episode's screen from the show's list. */
async function openEpisode(user: ReturnType<typeof userEvent.setup>) {
  const [item] = within(screen.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')
  await openShowNotes(user, item)
  await screen.findByRole('heading', { level: 1, name: episode.title })
}

async function showNotes() {
  return await screen.findByRole('region', { name: 'Show notes' })
}

describe('an episode’s screen', () => {
  it('shows its title, podcast, date, duration and show notes', async () => {
    const { user } = await renderShow(
      '<h1>Topics</h1><p>We talk about <strong>links</strong>.</p><p>Second paragraph.</p>' +
        '<table><tr><td>00:00</td><td>Intro</td></tr><tr><td>05:30</td><td>Links</td></tr></table>',
    )

    await openEpisode(user)

    // Its podcast, as the episode names it: the back button names it too.
    expect(screen.getByText('The Example Show', { ignore: 'button, button *' })).toBeInTheDocument()
    expect(screen.getByText('1 hr 2 min')).toBeInTheDocument()
    expect(screen.getByText(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(episode.publishedAt))))
      .toHaveAttribute('dateTime', episode.publishedAt)
    const notes = await showNotes()
    expect(within(notes).getByText('links').tagName).toBe('STRONG')
    expect(notes.querySelectorAll('p')).toHaveLength(2)
    expect(notes.querySelectorAll('p')[0]).toHaveTextContent('We talk about links.')
    expect(notes.querySelectorAll('p')[1]).toHaveTextContent('Second paragraph.')
    expect(within(notes).getByRole('heading', { level: 2, name: 'Topics' })).toBeInTheDocument()
    expect(notes).toHaveTextContent('00:00 Intro 05:30 Links')
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

    await user.click(screen.getByRole('button', { name: 'Back to The Example Show' }))

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

  it('are listed by themselves under Links, each once, with where they lead', async () => {
    const { user } = await renderShow(
      '<p>Read <a href="https://www.example.com/article">the article</a>, <a href="https://www.example.com/article">again</a>, ' +
        'or <a href="mailto:host@example.com">write in</a>. Sponsor: https://example.com/sponsor. 1:22 Intro</p>',
    )
    await openEpisode(user)
    await showNotes()
    const sections = screen.getByRole('group', { name: 'Show notes sections' })
    expect(within(sections).getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(sections).getByRole('button', { name: 'Links' }))

    expect(within(sections).getByRole('button', { name: 'Links' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('region', { name: 'Show notes' })).not.toBeInTheDocument()
    const rows = within(screen.getByRole('region', { name: 'Links' })).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'the articleexample.com',
      'write inhost@example.com',
      'https://example.com/sponsor',
    ])
    const article = within(rows[0]).getByRole('link', { name: 'the article' })
    expect(article).toHaveAttribute('href', 'https://www.example.com/article')
    expect(article).toHaveAttribute('target', '_blank')
    expect(article.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))

    await user.click(within(sections).getByRole('button', { name: 'Notes' }))

    expect(await showNotes()).toHaveTextContent('Sponsor: https://example.com/sponsor.')
  })

  it('leave Links with nothing to choose when the notes have none', async () => {
    const { user } = await renderShow('<p>No links here, and <a href="/library">a relative one</a> is no link.</p>')
    await openEpisode(user)
    await showNotes()

    expect(await screen.findByRole('button', { name: 'Links' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('have no place to be listed when the episode has no show notes', async () => {
    const { user } = await renderShow(null)
    await openEpisode(user)

    expect(await showNotes()).toHaveTextContent('This episode has no show notes.')
    expect(screen.queryByRole('group', { name: 'Show notes sections' })).not.toBeInTheDocument()
  })
})

describe('timestamps in show notes', () => {
  it('starts at a plain-text timestamp instead of the saved position, then seeks without reloading', async () => {
    const { audio, user } = await renderShow(
      '(0:00) Intro\n(1:22) Robert Pattinson is James Bond\n(35:55) Ebenezer\n' +
        '(1:00:08) Fjord\n(1:45:53) Interview\n75:30 Credits',
      { positionSeconds: 600 },
    )
    await openEpisode(user)
    const notes = await showNotes()

    for (const [timestamp, seconds] of [
      ['1:22', 82], ['35:55', 2155], ['1:00:08', 3608], ['1:45:53', 6353], ['75:30', 4530], ['0:00', 0],
    ] as const) {
      await user.click(within(notes).getByRole('button', { name: `Seek to ${timestamp}` }))
      expect(audio.src).toBe(episode.enclosureUrl)
      expect(audio.currentTime).toBe(seconds)
      expect(audio.paused).toBe(false)
      expect(audio.loads).toBe(1)
    }
    expect(notes).toHaveTextContent('(1:22) Robert Pattinson is James Bond')
    expect(screen.getByRole('heading', { level: 1, name: episode.title })).toBeInTheDocument()
  })

  it('seeks HTML timestamps in paragraphs, formatting, tables and existing timestamp links', async () => {
    const { audio, user } = await renderShow(
      '<p>(<strong>01:22</strong>) Intro</p><table><tr><td>1:00:08</td><td>Fjord</td></tr></table>' +
        '<p><a href="https://example.com/episode?t=2155"><em>35:55</em></a> Film</p>',
    )
    await openEpisode(user)
    const notes = await showNotes()

    await user.click(within(notes).getByRole('button', { name: 'Seek to 01:22' }))
    expect(audio.currentTime).toBe(82)
    await user.click(within(notes).getByRole('button', { name: 'Seek to 1:00:08' }))
    expect(audio.currentTime).toBe(3608)
    await user.click(within(notes).getByRole('button', { name: 'Seek to 35:55' }))
    expect(audio.currentTime).toBe(2155)
    expect(notes).toHaveTextContent('1:00:08 Fjord')
    expect(within(notes).getByRole('button', { name: 'Seek to 01:22' }).closest('strong')).not.toBeNull()
    expect(within(notes).queryByRole('link')).not.toBeInTheDocument()
    expect(notes.querySelector('a button, button a')).toBeNull()
  })

  it('leaves web addresses and descriptive external links containing timestamps intact', async () => {
    const { user } = await renderShow(
      '<p>1:22 Intro https://example.com/1:22?t=1:00:08.</p>' +
        '<a href="https://example.com/article">Read about 35:55</a>',
    )
    await openEpisode(user)
    const notes = await showNotes()

    expect(within(notes).getAllByRole('button')).toHaveLength(1)
    expect(within(notes).getByRole('link', { name: 'https://example.com/1:22?t=1:00:08' }))
      .toHaveAttribute('href', 'https://example.com/1:22?t=1:00:08')
    expect(within(notes).getByRole('link', { name: 'Read about 35:55' })).toHaveAttribute('target', '_blank')
    expect(notes.querySelector('a button')).toBeNull()
  })

  it('keeps malformed timestamps and numbers inside words as text', async () => {
    const text = '1:2 1:60 1:60:00 1:23:99 abc1:22 1:22xyz 1:22.5 1.1:22 1:22:33:44 999999999999999999999:00'
    const { user } = await renderShow(text)
    await openEpisode(user)
    const notes = await showNotes()

    expect(within(notes).queryByRole('button')).not.toBeInTheDocument()
    expect(notes).toHaveTextContent(text)
  })

  it('keeps a paused episode paused, and supports seeking with the keyboard', async () => {
    const { audio, user } = await renderShow('0:00 Intro\n1:22 Topic')
    await openEpisode(user)
    await user.click(within(await showNotes()).getByRole('button', { name: 'Seek to 1:22' }))
    act(() => audio.loadMetadata(3723))
    await user.click(within(screen.getByRole('region', { name: 'Mini player' })).getByRole('button', { name: 'Pause' }))

    const start = within(await showNotes()).getByRole('button', { name: 'Seek to 0:00' })
    act(() => start.focus())
    await user.keyboard('{Enter}')

    expect(audio.currentTime).toBe(0)
    expect(audio.paused).toBe(true)
    expect(audio.loads).toBe(1)
  })

  it('applies the latest timestamp after metadata arrives if the browser ignores early seeks', async () => {
    const { audio, user } = await renderShow('1:22 Intro\n35:55 Film\n0:00 Start')
    audio.ignoreEarlySeeks()
    await openEpisode(user)
    const notes = await showNotes()
    await user.click(within(notes).getByRole('button', { name: 'Seek to 1:22' }))
    await user.click(within(notes).getByRole('button', { name: 'Seek to 35:55' }))
    expect(audio.currentTime).toBe(0)

    act(() => audio.loadMetadata(3723))

    expect(audio.currentTime).toBe(2155)
    expect(audio.paused).toBe(false)
    expect(audio.loads).toBe(1)
  })

  it('can return to the start while an earlier timestamp is still waiting for metadata', async () => {
    const { audio, user } = await renderShow('1:22 Intro\n0:00 Start')
    audio.ignoreEarlySeeks()
    await openEpisode(user)
    const notes = await showNotes()
    await user.click(within(notes).getByRole('button', { name: 'Seek to 1:22' }))
    await user.click(within(notes).getByRole('button', { name: 'Seek to 0:00' }))

    act(() => audio.loadMetadata(3723))

    expect(audio.currentTime).toBe(0)
  })

  it('plays the notes’ episode when a different episode is loaded, saving the old position and leaving the queue', async () => {
    const other = { ...episode, title: 'Earlier episode', publishedAt: '2026-11-01T08:00:00.000Z', enclosureUrl: 'https://media.example.com/other.mp3' }
    const { audio, user, data, podcastId } = await renderShow('1:22 Topic')
    let otherId = ''
    act(() => { [otherId] = data.ingest(podcastId, [other]) })
    await chooseAction(user, within(screen.getByRole('list', { name: 'Episodes' })).getAllByRole('listitem')[0], 'Add to queue')
    await user.click(screen.getByRole('button', { name: other.title }))
    act(() => audio.progressTo(300))
    await openEpisode(user)

    await user.click(within(await showNotes()).getByRole('button', { name: 'Seek to 1:22' }))

    expect(audio.src).toBe(episode.enclosureUrl)
    expect(audio.currentTime).toBe(82)
    expect(audio.paused).toBe(false)
    expect(data.savedState(otherId)).toMatchObject({ positionSeconds: 300 })
    await user.click(screen.getByRole('button', { name: 'Queue' }))
    expect(screen.getByText('Nothing queued.')).toBeInTheDocument()
  })

  it('disables timestamp seeking offline when the episode has no download', async () => {
    const { audio, user, device } = await renderShow('1:22 Topic')
    await openEpisode(user)
    const notes = await showNotes()
    act(() => device.goOffline())

    const timestamp = within(notes).getByRole('button', { name: 'Seek to 1:22' })
    expect(timestamp).toBeDisabled()
    await user.click(timestamp)
    expect(audio.src).toBe('')
  })

  it('seeks the downloaded copy while offline', async () => {
    const device = new FakeDevice()
    device.network.host(episode.enclosureUrl, new Uint8Array(1000))
    const { audio, user } = await renderShow('1:22 Topic', { device })
    await chooseAction(user, screen.getByRole('list', { name: 'Episodes' }), 'Download')
    await screen.findByText('Downloaded')
    await openEpisode(user)
    act(() => device.goOffline())

    await user.click(within(await showNotes()).getByRole('button', { name: 'Seek to 1:22' }))

    expect(audio.src).toMatch(/^blob:/)
    expect(audio.currentTime).toBe(82)
    expect(audio.paused).toBe(false)
  })

  it('only creates seek buttons from surviving text, dropping feed-supplied handlers and controls', async () => {
    const { audio, user } = await renderShow(
      '<script>1:22</script><button onclick="alert(1)">2:22</button>' +
        '<p onclick="alert(1)">3:22 Topic</p><a href="javascript:alert(1)" onclick="alert(1)">4:22</a>',
    )
    await openEpisode(user)
    const notes = await showNotes()

    expect(within(notes).getAllByRole('button')).toHaveLength(2)
    expect(notes.textContent).not.toMatch(/1:22|2:22/)
    expect(notes.querySelector('[onclick], [href], script')).toBeNull()
    await user.click(within(notes).getByRole('button', { name: 'Seek to 4:22' }))
    expect(audio.currentTime).toBe(262)
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

    // Nothing of the removed content leaks through as text, or anywhere else in the page.
    expect(notes.textContent).not.toMatch(/pwned|alert|noscript text|display: none|Sign in|svg link/)
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
    render(<App services={{ auth, data, audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Latest' }))
    const list = await screen.findByRole('list', { name: 'Latest episodes' })

    await openShowNotes(user, list)

    expect(await showNotes()).toHaveTextContent('Plain notes.')
    await user.click(screen.getByRole('button', { name: 'Back to Latest episodes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Latest episodes' })).toBeInTheDocument()
  })

  it('opens from the queue, and goes back there', async () => {
    const { user } = await renderShow('Plain notes.')
    await chooseAction(user, screen.getByRole('list', { name: 'Episodes' }), 'Add to queue')
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    await openShowNotes(user, await screen.findByRole('list', { name: 'Queued episodes' }))

    expect(await showNotes()).toHaveTextContent('Plain notes.')
    expect(screen.getByRole('button', { name: 'Queue' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('button', { name: 'Back to Queue' }))
    expect(await screen.findByRole('list', { name: 'Queued episodes' })).toHaveTextContent(episode.title)
  })

  it('opens from now playing, and goes back there', async () => {
    const { audio, user } = await renderShow('Plain notes.')
    await user.click(screen.getByRole('button', { name: episode.title }))
    await user.click(within(screen.getByRole('region', { name: 'Mini player' })).getByRole('button', { name: new RegExp(episode.title) }))

    await user.click(screen.getByRole('button', { name: 'Show notes' }))

    expect(await showNotes()).toHaveTextContent('Plain notes.')
    expect(screen.getByRole('heading', { level: 1, name: episode.title })).toBeInTheDocument()
    expect(audio.paused).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Back to Now Playing' }))
    expect(screen.getByRole('button', { name: 'Close now playing' })).toBeInTheDocument()
    // Closing it shows the screen it was opened over, as before.
    await user.click(screen.getByRole('button', { name: 'Close now playing' }))
    expect(screen.getByRole('list', { name: 'Episodes' })).toBeInTheDocument()
  })
})

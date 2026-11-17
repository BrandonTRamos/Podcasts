import { createElement, Fragment, type ReactNode, useState } from 'react'

/**
 * An episode's show notes, safe to display. Feeds write them as HTML or as
 * plain text, and either way they are untrusted.
 *
 * HTML is parsed into an inert document (`DOMParser` runs no scripts and
 * loads nothing) and rebuilt as React elements from an allowlist: a few
 * text-formatting elements with no attributes at all, and links. Nothing is
 * ever set as `innerHTML`, so no markup is parsed a second time. Active and
 * embedded content (scripts, styles, frames, objects, forms, media, SVG and
 * MathML) goes with everything inside it; any other element gives up its tag
 * and attributes and keeps its text.
 *
 * Links keep only an absolute http, https or mailto address and open in a new
 * browsing context with no opener and no referrer, so the page they open
 * can't reach back into the app.
 *
 * Plain text keeps its paragraphs and line breaks, and its web addresses
 * become links. Timestamps become app-owned seek buttons in either format.
 *
 * They sit on a card. Notes with text have two pills above it: Notes, and
 * Links, which lists the links found in them by themselves. Notes with no
 * links have nothing behind Links, so it can't be chosen.
 */
export function ShowNotes({ notes, onSeek, seekDisabled = false }: {
  notes: ShowNotesState
  onSeek: (seconds: number) => void
  seekDisabled?: boolean
}) {
  const [chosen, setChosen] = useState<'notes' | 'links'>('notes')
  const rendered = notes.status === 'loaded' && notes.notes !== null
    ? sanitise(notes.notes, { onSeek, disabled: seekDisabled })
    : null
  const links = rendered?.links ?? []
  const showing = links.length > 0 ? chosen : 'notes'
  return (
    <div className="show-notes-area">
      {rendered?.hasText && (
        <div className="show-notes-sections" role="group" aria-label="Show notes sections">
          <button type="button" aria-pressed={showing === 'notes'} onClick={() => setChosen('notes')}>
            Notes
          </button>
          <button
            type="button"
            aria-pressed={showing === 'links'}
            disabled={links.length === 0}
            onClick={() => setChosen('links')}
          >
            Links
          </button>
        </div>
      )}
      <div className="show-notes-card">
        {showing === 'links' ? (
          <NoteLinks links={links} />
        ) : (
          <section
            aria-label="Show notes"
            className={rendered?.keepLineBreaks ? 'show-notes show-notes-line-breaks' : 'show-notes'}
          >
            {notes.status === 'loading' && <p>Loading show notes…</p>}
            {notes.status === 'failed' && <p role="alert">Couldn’t load the show notes.</p>}
            {notes.status === 'loaded' &&
              (rendered?.hasText ? rendered.content : <p className="show-notes-empty">This episode has no show notes.</p>)}
          </section>
        )}
      </div>
    </div>
  )
}

/** A link found in the notes: where it leads, and what the notes call it (the address itself, when they only wrote that). */
interface NoteLink {
  href: string
  label: string
}

/** The notes' links by themselves, each once, in the order the notes have them. */
function NoteLinks({ links }: { links: NoteLink[] }) {
  return (
    <section aria-label="Links" className="show-notes-links">
      <ul>
        {links.map(({ href, label }) => (
          <li key={href}>
            <ExternalLink href={href}>{label}</ExternalLink>
            {!isAddress(label, href) && <span>{shortAddress(href)}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Whether a link's label is just its address, written out. */
function isAddress(label: string, href: string): boolean {
  return safeHref(label) === href || label === shortAddress(href)
}

/** Where a link leads, in brief: a web address's site, or who an email goes to. */
function shortAddress(href: string): string {
  const url = new URL(href)
  return url.protocol === 'mailto:' ? url.pathname : url.host.replace(/^www\./, '')
}

function addLink(links: NoteLink[], link: NoteLink) {
  if (!links.some((each) => each.href === link.href)) links.push(link)
}

/** Show notes as they arrive: null once loaded means the episode has none. */
export type ShowNotesState = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; notes: string | null }

interface TimestampControls {
  onSeek: (seconds: number) => void
  disabled: boolean
}

function sanitise(notes: string, timestamps: TimestampControls): Rendered {
  const links: NoteLink[] = []
  const rendered = looksLikeHtml(notes) ? fromHtml(notes, timestamps, links) : fromPlainText(notes, timestamps, links)
  return { ...rendered, links }
}

interface Rendered {
  content: ReactNode
  /** The links in it, each once, in order. */
  links: NoteLink[]
  /** Whether any of it is text worth showing. */
  hasText: boolean
  /** HTML with no paragraphs or breaks of its own, whose line breaks are all it has to separate lines. */
  keepLineBreaks: boolean
}

/** A tag, as the feed would write it: plain text with a stray "<" or "<3" in it isn't HTML. */
function looksLikeHtml(notes: string): boolean {
  return /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(notes)
}

/** Removed, with everything inside them. */
const DROPPED = new Set([
  'script', 'style', 'link', 'meta', 'base', 'title', 'head', 'template', 'noscript', 'noembed', 'noframes',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'param', 'portal', 'fencedframe',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'output', 'label',
  'img', 'picture', 'source', 'track', 'video', 'audio', 'canvas', 'map', 'area', 'svg', 'math', 'dialog', 'slot',
])

/** Kept as themselves, with no attributes. */
const KEPT = new Set([
  'p', 'br', 'hr', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'code', 'pre', 'kbd', 'samp', 'q', 'cite', 'abbr', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
])

/** Blocks shown as plain divisions, so their content still starts on a line of its own. */
const AS_DIV = new Set([
  'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'address', 'figure', 'figcaption',
  'center', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
])

/** Under the episode's own heading, the notes' headings start a level down. */
const HEADINGS: Record<string, string> = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6' }

/** Elements that separate lines by themselves, so the markup's own line breaks are just layout. */
const STRUCTURAL = new Set(['p', 'br', 'div', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'hr', ...Object.keys(HEADINGS), ...AS_DIV])

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

function fromHtml(html: string, timestamps: TimestampControls, links: NoteLink[]): Omit<Rendered, 'links'> {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  const result = { hasText: false, structured: false }

  function children(parent: Node, insideLink: boolean): ReactNode[] {
    return Array.from(parent.childNodes, (child, i) => <Fragment key={i}>{convert(child, insideLink)}</Fragment>)
  }

  function convert(node: Node, insideLink: boolean): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text.trim()) result.hasText = true
      return insideLink ? text : linkify(text, timestamps, links)
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const element = node as Element
    // SVG and MathML, wherever they appear, are foreign content: none of it is kept.
    if (element.namespaceURI !== HTML_NAMESPACE) return null
    const name = element.localName
    if (DROPPED.has(name)) return null
    if (STRUCTURAL.has(name)) result.structured = true
    if (name === 'a') {
      // Publishers sometimes make a timestamp a web link already. Seek here
      // instead, without putting a button inside an external link.
      const label = element.textContent?.trim() ?? ''
      const seconds = timestampSeconds(label)
      if (!insideLink && seconds !== null) {
        return <TimestampButton seconds={seconds} label={label} controls={timestamps}>{children(element, true)}</TimestampButton>
      }
      const href = insideLink ? null : safeHref(element.getAttribute('href'))
      if (href === null) return children(element, insideLink)
      addLink(links, { href, label: label || href })
      return <ExternalLink href={href}>{children(element, true)}</ExternalLink>
    }
    const tag = KEPT.has(name) ? name : AS_DIV.has(name) ? 'div' : HEADINGS[name]
    const content = children(element, insideLink)
    // A table's cells, laid out as text: "00:00 Intro", not "00:00Intro".
    if (name === 'td' || name === 'th') return [...content, ' ']
    if (!tag) return content
    return name === 'br' || name === 'hr' ? createElement(tag) : createElement(tag, null, content)
  }

  const content = children(body, false)
  return { content, hasText: result.hasText, keepLineBreaks: !result.structured }
}

function fromPlainText(notes: string, timestamps: TimestampControls, links: NoteLink[]): Omit<Rendered, 'links'> {
  const paragraphs = decodeEntities(notes)
    .replace(/\r\n?/g, '\n')
    .split(/\n[^\S\n]*\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  return {
    content: paragraphs.map((paragraph, i) => (
      <p key={i}>
        {paragraph.split('\n').map((line, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {linkify(line, timestamps, links)}
          </Fragment>
        ))}
      </p>
    )),
    hasText: paragraphs.length > 0,
    keepLineBreaks: false,
  }
}

/** Text with character references ("&amp;", "&#8217;") read as the characters they stand for, and no markup. */
function decodeEntities(text: string): string {
  if (!/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);?/i.test(text)) return text
  return new DOMParser().parseFromString(text.replace(/</g, '&lt;'), 'text/html').body.textContent ?? text
}

/** Web addresses in running text. Punctuation that ends a sentence isn't part of one. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/gi

const TRAILING_PUNCTUATION = /[.,;:!?'"\]]+$/

/** Drops sentence punctuation from the end of an address, and a closing bracket it didn't open. */
function trimTrailingPunctuation(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCTUATION, '')
  while (trimmed.endsWith(')') && trimmed.split('(').length < trimmed.split(')').length) {
    trimmed = trimmed.slice(0, -1).replace(TRAILING_PUNCTUATION, '')
  }
  return trimmed
}

function linkify(text: string, timestamps: TimestampControls, links: NoteLink[]): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = trimTrailingPunctuation(match[0])
    const href = safeHref(url)
    if (href === null) continue
    addLink(links, { href, label: url })
    parts.push(
      <Fragment key={match.index}>
        {timestampify(text.slice(last, match.index), timestamps)}
        <ExternalLink href={href}>{url}</ExternalLink>
      </Fragment>,
    )
    last = match.index + url.length
  }
  if (parts.length === 0) return timestampify(text, timestamps)
  parts.push(<Fragment key="tail">{timestampify(text.slice(last), timestamps)}</Fragment>)
  return parts
}

/** Whole m:ss or h:mm:ss values, including minutes beyond 59 in the two-part form. */
function timestampSeconds(text: string): number | null {
  if (!/^(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)$/.test(text)) return null
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  return Number.isSafeInteger(seconds) ? seconds : null
}

/** Don't turn a fragment of a malformed time, word, or decimal into a seek. */
const TIMESTAMP_IN_TEXT = /(?<![\w:.])(?:\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d)(?![\w:]|\.\d)/g

function timestampify(text: string, controls: TimestampControls): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TIMESTAMP_IN_TEXT)) {
    const seconds = timestampSeconds(match[0])
    if (seconds === null) continue
    parts.push(
      text.slice(last, match.index),
      <TimestampButton key={match.index} seconds={seconds} label={match[0]} controls={controls}>{match[0]}</TimestampButton>,
    )
    last = match.index + match[0].length
  }
  if (parts.length === 0) return text
  parts.push(text.slice(last))
  return parts
}

function TimestampButton({ seconds, label, controls, children }: {
  seconds: number
  label: string
  controls: TimestampControls
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="show-notes-timestamp"
      aria-label={`Seek to ${label}`}
      disabled={controls.disabled}
      onClick={() => controls.onSeek(seconds)}
    >
      {children}
    </button>
  )
}

/** An absolute http, https or mailto address, or null for anything else: scripts, data, or a relative address into the app. */
function safeHref(raw: string | null): string | null {
  if (raw === null) return null
  let url: URL
  try {
    // No base, so a relative address, which would point into the app, doesn't parse.
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol === 'mailto:') return url.href
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.host) return url.href
  return null
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

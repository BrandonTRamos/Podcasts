import { XMLParser } from 'fast-xml-parser'

export interface ParsedPodcast {
  title: string
  author: string | null
  artworkUrl: string | null
}

export interface ParsedEpisode {
  /** The item's GUID, or its enclosure URL when the feed gives none. */
  guid: string
  title: string
  publishedAt: string | null
  durationSeconds: number | null
  enclosureUrl: string
  enclosureType: string | null
  showNotes: string | null
}

export interface ParsedFeed {
  podcast: ParsedPodcast
  /** In feed order. Items without audio are left out, as are repeats of a GUID. */
  episodes: ParsedEpisode[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item',
})

/** RSS XML in, normalised podcast and episode records out. Null if the document is not an RSS feed. */
export function parseFeed(xml: string): ParsedFeed | null {
  let document: unknown
  try {
    document = parser.parse(xml)
  } catch {
    return null
  }
  const channel = child(child(document, 'rss'), 'channel')
  if (!isObject(channel)) return null

  return {
    podcast: {
      title: text(channel.title) ?? 'Untitled podcast',
      author: text(channel['itunes:author']) ?? text(channel.managingEditor),
      artworkUrl: attribute(channel['itunes:image'], 'href') ?? text(child(channel.image, 'url')),
    },
    episodes: parseItems(channel.item),
  }
}

function parseItems(items: unknown): ParsedEpisode[] {
  const seen = new Set<string>()
  const episodes: ParsedEpisode[] = []
  for (const item of Array.isArray(items) ? items : []) {
    if (!isObject(item)) continue
    const enclosureUrl = attribute(item.enclosure, 'url')
    if (!enclosureUrl) continue
    const guid = text(item.guid) ?? enclosureUrl
    if (seen.has(guid)) continue
    seen.add(guid)
    episodes.push({
      guid,
      title: text(item.title) ?? text(item['itunes:title']) ?? 'Untitled episode',
      publishedAt: parseDate(text(item.pubDate) ?? text(item['dc:date'])),
      durationSeconds: parseDuration(text(item['itunes:duration'])),
      enclosureUrl,
      enclosureType: attribute(item.enclosure, 'type'),
      showNotes: text(item['content:encoded']) ?? text(item.description) ?? text(item['itunes:summary']),
    })
  }
  return episodes
}

/**
 * RFC 822 dates as feeds actually write them. Tries the date as given, then
 * without the weekday (often wrong or misspelled), then without a time-zone
 * name JavaScript doesn't know (read as UTC). Null when nothing parses.
 */
export function parseDate(value: string | null): string | null {
  // V8's Date.parse turns almost any text into some date, so first insist on
  // the shape of an RFC 822 ("6 Nov 2026") or ISO 8601 ("2026-11-06") date.
  if (!value || !/\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4}|^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const withoutWeekday = value.replace(/^[A-Za-z]+\.?,?\s+(?=\d)/, '')
  const withoutZoneName = withoutWeekday.replace(/\s+[A-Za-z]{2,5}$/, ' +0000')
  for (const candidate of [value, withoutWeekday, withoutZoneName]) {
    const time = Date.parse(candidate)
    if (!Number.isNaN(time)) return new Date(time).toISOString()
  }
  return null
}

/** `itunes:duration` as seconds: `HH:MM:SS`, `MM:SS` or plain seconds. Null when missing or unreadable. */
export function parseDuration(value: string | null): number | null {
  if (!value || !/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(value)) return null
  const seconds = value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  return Math.round(seconds)
}

type XmlObject = Record<string, unknown>

function isObject(value: unknown): value is XmlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function child(value: unknown, name: string): unknown {
  const node = first(value)
  return isObject(node) ? node[name] : undefined
}

/** An element's text content, trimmed; null when absent or empty. */
function text(value: unknown): string | null {
  const node = first(value)
  const raw = isObject(node) ? node['#text'] : node
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const trimmed = String(raw).trim()
  return trimmed === '' ? null : trimmed
}

function attribute(value: unknown, name: string): string | null {
  return text(child(value, `@_${name}`))
}

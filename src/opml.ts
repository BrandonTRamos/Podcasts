/** A podcast feed listed in an OPML file. */
export interface OpmlFeed {
  /** As the file gives it, trimmed. */
  feedUrl: string
  /** The name the other app showed for it, if the file gives one. */
  title: string | null
}

/**
 * The podcast feeds an OPML file lists (outlines with an `xmlUrl`, at any
 * depth, as apps that group shows into folders nest them), each once, in the
 * file's order. Null when the file isn't well-formed XML with an `<opml>` root.
 */
export function parseOpml(text: string): OpmlFeed[] | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  if (doc.documentElement.localName.toLowerCase() !== 'opml') return null

  const feeds: OpmlFeed[] = []
  const seen = new Set<string>()
  for (const outline of Array.from(doc.getElementsByTagName('outline'))) {
    const feedUrl = (outline.getAttribute('xmlUrl') ?? outline.getAttribute('xmlurl'))?.trim()
    if (!feedUrl) continue
    const key = sameFeedKey(feedUrl)
    if (seen.has(key)) continue
    seen.add(key)
    const title = outline.getAttribute('title')?.trim() || outline.getAttribute('text')?.trim() || null
    feeds.push({ feedUrl, title })
  }
  return feeds
}

/** The same for two ways of writing one URL (case of the host, say). */
function sameFeedKey(feedUrl: string): string {
  try {
    const url = new URL(feedUrl)
    url.hash = ''
    return url.href
  } catch {
    return feedUrl
  }
}

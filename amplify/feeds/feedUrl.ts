/**
 * Parses a feed URL as typed or pasted. Returns its normalised form (so the same
 * feed written two ways is recognised as one), or null unless it is http or https.
 */
export function normaliseFeedUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.hash = ''
  return url.href
}

// Plain, JSON-escaped (https:\/\/) and percent-encoded (https%3A%2F%2F) forms.
const URL_PATTERN = /https?(?::(?:\\?\/){2}|%3A%2F%2F)[^\s"'<>]*/gi

/**
 * Wraps a handler so that an unexpected failure (from the data store, say) is
 * logged and rethrown with every URL in its message replaced. Lambda logs what
 * a handler throws, and a feed URL must never reach the logs.
 */
export function withUrlsRedactedFromErrors<Event, Result>(
  name: string,
  handler: (event: Event) => Promise<Result>,
): (event: Event) => Promise<Result> {
  return async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      const kind = error instanceof Error ? error.name : 'Error'
      const message = (error instanceof Error ? error.message : String(error)).replace(URL_PATTERN, '[url]')
      console.error(`${name} failed: ${kind}: ${message}`)
      throw new Error(`${name} failed: ${message}`)
    }
  }
}

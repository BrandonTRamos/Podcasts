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

/** Whether the text is an http or https URL: the only kind fetched server-side. */
export function isHttpUrl(input: string): boolean {
  return normaliseFeedUrl(input) !== null
}

// Plain, JSON-escaped (https:\/\/) and percent-encoded (https%3A%2F%2F) forms.
const URL_PATTERN = /https?(?::(?:\\?\/){2}|%3A%2F%2F)[^\s"'<>]*/gi

/** The text with every URL in it replaced, in any of the forms above. */
export function redactUrls(text: string): string {
  return text.replace(URL_PATTERN, '[url]')
}

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
      const message = redactUrls(error instanceof Error ? error.message : String(error))
      console.error(`${name} failed: ${kind}: ${message}`)
      throw new Error(`${name} failed: ${message}`)
    }
  }
}

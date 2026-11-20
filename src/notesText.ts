/** Reading show notes' text, shared by showing them and finding chapters in them. */

/** A tag, as the feed would write it: plain text with a stray "<" or "<3" in it isn't HTML. */
export function looksLikeHtml(notes: string): boolean {
  return /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(notes)
}

/** Text with character references ("&amp;", "&#8217;") read as the characters they stand for, and no markup. */
export function decodeEntities(text: string): string {
  if (!/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);?/i.test(text)) return text
  return new DOMParser().parseFromString(text.replace(/</g, '&lt;'), 'text/html').body.textContent ?? text
}

/** A timestamp as a pattern: m:ss or h:mm:ss, including minutes beyond 59 in the two-part form. */
export const TIMESTAMP = String.raw`\d+:[0-5]\d:[0-5]\d|\d+:[0-5]\d`

/** Whole m:ss or h:mm:ss values, as seconds; null for anything else. */
export function timestampSeconds(text: string): number | null {
  if (!new RegExp(`^(?:${TIMESTAMP})$`).test(text)) return null
  const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  return Number.isSafeInteger(seconds) ? seconds : null
}

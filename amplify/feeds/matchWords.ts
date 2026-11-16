/**
 * How a search for episodes matches text: every word of the search must begin
 * a word of the text, in any order, so "rom emp" finds "The Roman Empire" and
 * "7" finds episode 7 and 70 but not 17. Case, accents and apostrophes are
 * ignored, so "cafe" finds "Café" and "obrien" finds "O’Brien". Shared by the
 * backend, which searches a whole feed, and the client, which filters the
 * episodes it has; kept free of imports so the client bundle takes nothing
 * else with it.
 */

/** Anything but a letter or a digit comes between words. */
const BETWEEN_WORDS = '[^\\p{L}\\p{N}]'

/** A test of whether a text matches the search, or null when the search has no words. */
export function wordMatcher(term: string): ((text: string) => boolean) | null {
  const words = fold(term).split(new RegExp(`${BETWEEN_WORDS}+`, 'u')).filter(Boolean)
  if (words.length === 0) return null
  // Letters and digits only, so nothing in a word needs escaping.
  const patterns = words.map((word) => new RegExp(`(?:^|${BETWEEN_WORDS})${word}`, 'u'))
  return (text) => {
    const folded = fold(text)
    return patterns.every((pattern) => pattern.test(folded))
  }
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['‘’]/g, '')
    .toLowerCase()
}

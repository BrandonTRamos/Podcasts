import type { Category, Podcast } from './services'

/** The name of the group that holds every podcast in no category, or in one since deleted. */
export const OTHER = 'Other'

/** One group of the library as shown: a category, or Other (`category` null). */
export interface LibrarySection {
  category: Category | null
  /** In the listener's order (see `inListOrder`). */
  podcasts: Podcast[]
}

/**
 * The library in its groups: each category by name, then Other. Every
 * category shows, even with no podcasts yet; Other shows only when it holds some.
 */
export function librarySections(podcasts: Podcast[], categories: Category[]): LibrarySection[] {
  const sorted = inListOrder(podcasts)
  const known = new Set(categories.map((category) => category.id))
  const sections: LibrarySection[] = byName(categories).map((category) => ({
    category,
    podcasts: sorted.filter((podcast) => podcast.categoryId === category.id),
  }))
  const other = sorted.filter((podcast) => podcast.categoryId === null || !known.has(podcast.categoryId))
  if (other.length > 0) sections.push({ category: null, podcasts: other })
  return sections
}

/** The order a list of podcasts shows in: those the listener placed, lowest first, then the rest by title. */
export function inListOrder(podcasts: Podcast[]): Podcast[] {
  return [...podcasts].sort((a, b) => {
    if (a.libraryOrder !== null && b.libraryOrder !== null && a.libraryOrder !== b.libraryOrder) {
      return a.libraryOrder - b.libraryOrder
    }
    if ((a.libraryOrder === null) !== (b.libraryOrder === null)) return a.libraryOrder === null ? 1 : -1
    return a.title.localeCompare(b.title)
  })
}

/** A podcast's new place in the library. */
export interface Placement {
  podcastId: string
  libraryOrder: number
}

/**
 * The places to write so that `podcastId` shows at `index` of a list now
 * showing `list` (in order, the podcast itself left out, or absent if it is
 * coming from another list). Usually one, the podcast's own, between its new
 * neighbours. When a podcast before it has no place yet, those up to it are
 * numbered afresh, as are all when the neighbours' places are too close to
 * split.
 */
export function placementsFor(list: Podcast[], podcastId: string, index: number): Placement[] {
  const others = list.filter((podcast) => podcast.id !== podcastId)
  const at = Math.max(0, Math.min(index, others.length))
  const before = others.slice(0, at)
  const after = others[at]
  if (before.every((podcast) => podcast.libraryOrder !== null)) {
    const low = before.at(-1)?.libraryOrder ?? null
    const high = after?.libraryOrder ?? null
    const order = low === null ? (high === null ? 1 : high - 1) : high === null ? low + 1 : (low + high) / 2
    if (order !== low && order !== high) return [{ podcastId, libraryOrder: order }]
  }
  // Numbered afresh, from 1: those before it, it, then those after it that have a place.
  const renumbered = [...before.map((podcast) => podcast.id), podcastId, ...others.slice(at).filter((p) => p.libraryOrder !== null).map((p) => p.id)]
  const current = new Map(others.map((podcast) => [podcast.id, podcast.libraryOrder]))
  return renumbered
    .map((id, i) => ({ podcastId: id, libraryOrder: i + 1 }))
    .filter(({ podcastId: id, libraryOrder }) => id === podcastId || current.get(id) !== libraryOrder)
}

export function byName(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Why a category can't take the name, or null if it can. Names are compared
 * trimmed and regardless of case; `renaming` is the category being renamed,
 * which may keep its own name.
 */
export function categoryNameProblem(name: string, categories: Category[], renaming?: string): string | null {
  const wanted = name.trim().toLocaleLowerCase()
  if (!wanted) return 'Enter a name for the category.'
  if (wanted === OTHER.toLocaleLowerCase()) return `${OTHER} is kept for podcasts in no category.`
  const taken = categories.find((category) => category.id !== renaming && category.name.trim().toLocaleLowerCase() === wanted)
  return taken ? `You already have a category called ${taken.name}.` : null
}

import type { Category, Podcast } from './services'

/** The name of the group that holds every podcast in no category, or in one since deleted. */
export const OTHER = 'Other'

/** One group of the library as shown: a category, or Other (`category` null). */
export interface LibrarySection {
  category: Category | null
  /** By title. */
  podcasts: Podcast[]
}

/**
 * The library in its groups: each category by name, then Other. Every
 * category shows, even with no podcasts yet; Other shows only when it holds some.
 */
export function librarySections(podcasts: Podcast[], categories: Category[]): LibrarySection[] {
  const sorted = byTitle(podcasts)
  const known = new Set(categories.map((category) => category.id))
  const sections: LibrarySection[] = byName(categories).map((category) => ({
    category,
    podcasts: sorted.filter((podcast) => podcast.categoryId === category.id),
  }))
  const other = sorted.filter((podcast) => podcast.categoryId === null || !known.has(podcast.categoryId))
  if (other.length > 0) sections.push({ category: null, podcasts: other })
  return sections
}

export function byTitle(podcasts: Podcast[]): Podcast[] {
  return [...podcasts].sort((a, b) => a.title.localeCompare(b.title))
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

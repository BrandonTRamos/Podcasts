import { type ChangeEvent, useState } from 'react'
import { CategoryDialog } from './CategoryDialog'
import { byName, OTHER } from './categories'
import type { Category, DataApi, Podcast } from './services'

/** The choice that makes a new category, to put the podcast in. */
const NEW_CATEGORY = 'new'
/** The choice for no category: Other. */
const NO_CATEGORY = ''

/**
 * Which category the podcast is in, to change: one of the listener's, Other,
 * or a new one made there and then. It shows the choice while it is saved.
 */
export function CategoryPicker({
  podcast,
  categories,
  data,
}: {
  podcast: Podcast
  categories: Category[]
  data: Pick<DataApi, 'setPodcastCategory' | 'createCategory'>
}) {
  // The choice being saved, shown until the library brings the podcast changed from how it was when chosen.
  const [saving, setSaving] = useState<{ categoryId: string; from: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const current = categories.some((category) => category.id === podcast.categoryId) ? podcast.categoryId! : NO_CATEGORY
  const shown = saving !== null && saving.from === current ? saving.categoryId : current

  async function choose(categoryId: string) {
    setSaving({ categoryId, from: current })
    setFailed(false)
    try {
      await data.setPodcastCategory(podcast.id, categoryId === NO_CATEGORY ? null : categoryId)
    } catch {
      setSaving(null)
      setFailed(true)
    }
  }

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    if (event.target.value === NEW_CATEGORY) setCreating(true)
    else void choose(event.target.value)
  }

  return (
    <div className="category-picker">
      <label>
        <span className="visually-hidden">Category</span>
        <select value={shown} onChange={handleChange}>
          {byName(categories).map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
          <option value={NO_CATEGORY}>{OTHER}</option>
          <option value={NEW_CATEGORY}>New category…</option>
        </select>
      </label>
      {failed && <p role="alert">Couldn’t change the category. Check your connection and try again.</p>}
      {creating && (
        <CategoryDialog
          title="New category"
          action="Create"
          categories={categories}
          onSave={async (name) => {
            const created = await data.createCategory(name)
            await choose(created.id)
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  )
}

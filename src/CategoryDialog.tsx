import { type FormEvent, useEffect, useState } from 'react'
import { categoryNameProblem } from './categories'
import type { Category } from './services'

/**
 * Asks for a category's name, over the screen, to make a new category or
 * rename one. It stays while the name is saved, and closes once it is.
 * Cancel, Escape and a tap outside it close it.
 */
export function CategoryDialog({
  title,
  action,
  initialName = '',
  categories,
  renaming,
  onSave,
  onClose,
}: {
  title: string
  /** The save button's label. */
  action: string
  initialName?: string
  /** Every category, so a name already taken is refused. */
  categories: Category[]
  /** The category being renamed, which may keep its name. */
  renaming?: string
  /** Saves the trimmed name. Rejects if that failed. */
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [step, setStep] = useState<{ status: 'editing' | 'saving' } | { status: 'refused'; message: string }>({
    status: 'editing',
  })

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = categoryNameProblem(name, categories, renaming)
    if (problem) return setStep({ status: 'refused', message: problem })
    setStep({ status: 'saving' })
    try {
      await onSave(name.trim())
      onClose()
    } catch {
      setStep({ status: 'refused', message: 'Couldn’t save the category. Check your connection and try again.' })
    }
  }

  return (
    <div className="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
        <h2 id="category-dialog-title">{title}</h2>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <label>
            Name
            <input
              type="text"
              autoComplete="off"
              autoFocus
              placeholder="News, Movies…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {step.status === 'refused' && <p role="alert">{step.message}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={step.status === 'saving'}>
              {action}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

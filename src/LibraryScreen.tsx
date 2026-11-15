import { type ChangeEvent, type FormEvent, type RefObject, useEffect, useRef, useState } from 'react'
import { CategoryDialog } from './CategoryDialog'
import { byTitle, type LibrarySection, librarySections, OTHER } from './categories'
import { ChevronDownIcon, PlusIcon } from './Icons'
import { MoreActions } from './MoreActions'
import type { ImportOutcome, ImportState } from './opmlImport'
import type { Category, DataApi, Podcast } from './services'
import type { LoadState } from './SignedInApp'
import { failureMessage, type SubscribeFailure, useSubscribe } from './subscribing'

/** What the library's sections are open: each category's ID, and `OTHER_SECTION` for Other. */
export type OpenSections = ReadonlySet<string>

export const OTHER_SECTION = 'other'

export function LibraryScreen({
  podcasts,
  categories,
  openSections,
  onToggleSection,
  data,
  onOpenPodcast,
  onReload,
  onSignOut,
  opmlImport,
  onImportOpml,
}: {
  podcasts: LoadState<Podcast>
  categories: LoadState<Category>
  /** Every section starts closed. */
  openSections: OpenSections
  onToggleSection: (section: string) => void
  data: DataApi
  opmlImport: ImportState
  onImportOpml: (file: File) => void
  onOpenPodcast: (podcastId: string) => void
  /** Loads the app afresh, which shows a version deployed since it opened. */
  onReload: () => void
  onSignOut: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ action: 'create' } | { action: 'rename'; category: Category } | null>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  // Without its categories the library shows as one list, as it is when there are none.
  const categoryList = categories.status === 'loaded' ? categories.items : []
  const opmlFile = useRef<HTMLInputElement>(null)
  const count = podcasts.status === 'loaded' ? podcasts.items.length : 0
  const importing = opmlImport.status === 'reading' || opmlImport.status === 'importing'
  return (
    <main className="library">
      <header>
        <div className="library-title">
          <h1>Library</h1>
          {count > 0 && <p className="library-count">{count === 1 ? '1 podcast' : `${count} podcasts`}</p>}
        </div>
        <button type="button" className="icon-button" onClick={() => setAdding(true)} aria-label="Add podcast">
          <PlusIcon size={22} />
        </button>
        <MoreActions>
          <button type="button" onClick={() => setEditing({ action: 'create' })} disabled={categories.status !== 'loaded'}>
            New category
          </button>
          <button type="button" onClick={() => opmlFile.current?.click()} disabled={importing}>
            Import OPML file
          </button>
          <button type="button" onClick={onReload}>
            Reload app
          </button>
          <button type="button" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </MoreActions>
      </header>
      {adding && (
        <AddPodcastDialog
          data={data}
          titleOf={(podcastId) =>
            podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === podcastId)?.title : undefined
          }
          onSubscribed={onOpenPodcast}
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <CategoryDialog
          title={editing.action === 'create' ? 'New category' : `Rename ${editing.category.name}`}
          action={editing.action === 'create' ? 'Create' : 'Rename'}
          initialName={editing.action === 'rename' ? editing.category.name : ''}
          categories={categoryList}
          renaming={editing.action === 'rename' ? editing.category.id : undefined}
          onSave={async (name) => {
            if (editing.action === 'rename') return data.renameCategory(editing.category.id, name)
            const created = await data.createCategory(name)
            // Open, as there is nothing else to see of it.
            if (!openSections.has(created.id)) onToggleSection(created.id)
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <DeleteCategory
          category={deleting}
          onDelete={() => data.deleteCategory(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
      <OpmlImport state={opmlImport} onImport={onImportOpml} input={opmlFile} busy={importing} />
      {(podcasts.status === 'loading' || categories.status === 'loading') && <p>Loading…</p>}
      {podcasts.status === 'failed' && <p role="alert">Couldn’t load your library.</p>}
      {podcasts.status === 'loaded' && categories.status !== 'loading' && (
        <>
          {podcasts.items.length === 0 && <p>No podcasts yet.</p>}
          {categoryList.length === 0 ? (
            podcasts.items.length > 0 && (
              <PodcastList label="Podcasts" podcasts={byTitle(podcasts.items)} onOpen={onOpenPodcast} />
            )
          ) : (
            librarySections(podcasts.items, categoryList).map((section) => {
              const key = section.category?.id ?? OTHER_SECTION
              return (
                <CategorySection
                  key={key}
                  section={section}
                  open={openSections.has(key)}
                  onToggle={() => onToggleSection(key)}
                  onOpenPodcast={onOpenPodcast}
                  onRename={(category) => setEditing({ action: 'rename', category })}
                  onDelete={setDeleting}
                />
              )
            })
          )}
        </>
      )}
    </main>
  )
}

/** A category's podcasts, or Other's, under a heading that opens and closes it. */
function CategorySection({
  section: { category, podcasts },
  open,
  onToggle,
  onOpenPodcast,
  onRename,
  onDelete,
}: {
  section: LibrarySection
  open: boolean
  onToggle: () => void
  onOpenPodcast: (podcastId: string) => void
  onRename: (category: Category) => void
  onDelete: (category: Category) => void
}) {
  const name = category?.name ?? OTHER
  return (
    <section className="category" aria-label={name}>
      <div className="category-heading">
        <h2>
          <button
            type="button"
            className="category-toggle"
            aria-expanded={open}
            aria-label={`${name}, ${podcasts.length === 1 ? '1 podcast' : `${podcasts.length} podcasts`}`}
            onClick={onToggle}
          >
            <ChevronDownIcon size={20} />
            <span className="category-name">{name}</span>
            <span className="category-count">{podcasts.length}</span>
          </button>
        </h2>
        {category && (
          <MoreActions label={`${name} actions`}>
            <button type="button" onClick={() => onRename(category)}>
              Rename
            </button>
            <button type="button" onClick={() => onDelete(category)}>
              Delete
            </button>
          </MoreActions>
        )}
      </div>
      {open &&
        (podcasts.length === 0 ? (
          <p className="category-empty">No podcasts here yet. Open a podcast to choose its category.</p>
        ) : (
          <PodcastList label={name} podcasts={podcasts} onOpen={onOpenPodcast} />
        ))}
    </section>
  )
}

function PodcastList({ label, podcasts, onOpen }: { label: string; podcasts: Podcast[]; onOpen: (podcastId: string) => void }) {
  return (
    <ul className="podcasts" aria-label={label}>
      {podcasts.map((podcast) => (
        <li key={podcast.id}>
          <button type="button" className="plain" onClick={() => onOpen(podcast.id)}>
            <Artwork url={podcast.artworkUrl} />
            <span className="podcast-title">{podcast.title}</span>
            {podcast.author && <span className="podcast-author">{podcast.author}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Asks before deleting a category, saying its podcasts stay, in Other. */
function DeleteCategory({
  category,
  onDelete,
  onClose,
}: {
  category: Category
  /** Rejects if deleting failed. */
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [step, setStep] = useState<'confirming' | 'sending' | 'failed'>('confirming')

  async function handleConfirm() {
    setStep('sending')
    try {
      await onDelete()
      onClose()
    } catch {
      setStep('failed')
    }
  }

  return (
    <section
      className="confirm-sheet"
      role="alertdialog"
      aria-labelledby="delete-category-title"
      aria-describedby="delete-category-detail"
    >
      <h2 id="delete-category-title">Delete {category.name}?</h2>
      <p id="delete-category-detail">Its podcasts stay in your library, in {OTHER}.</p>
      <button type="button" className="primary" onClick={() => void handleConfirm()} disabled={step === 'sending'}>
        Delete
      </button>
      <button type="button" onClick={onClose} disabled={step === 'sending'}>
        Cancel
      </button>
      {step === 'failed' && <p role="alert">Couldn’t delete the category. Check your connection and try again.</p>}
    </section>
  )
}

export function Artwork({ url, size = 'small' }: { url: string | null; size?: 'mini' | 'small' | 'large' | 'hero' }) {
  const className = `artwork artwork-${size}`
  return url ? <img className={className} src={url} alt="" /> : <span className={className} aria-hidden="true" />
}

const errorMessages: Record<SubscribeFailure, string> = {
  invalidUrl: 'Enter a feed URL that starts with http:// or https://.',
  unreachable: 'Couldn’t reach that feed. Check the URL and try again.',
  notAFeed: 'That URL isn’t a podcast feed.',
  failed: 'Couldn’t subscribe. Try again.',
  offline: 'Couldn’t subscribe. Check your connection and try again.',
  lost: 'Couldn’t check on the subscription. Reload to see if it was added.',
}

/**
 * Asks for a feed URL to subscribe to, over the library. It stays while the
 * feed is checked, saying how that goes, and gives way to the podcast once
 * it is added. Cancel, Escape and a tap outside it close it.
 */
function AddPodcastDialog({
  data,
  titleOf,
  onSubscribed,
  onClose,
}: {
  data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>
  titleOf: (podcastId: string) => string | undefined
  onSubscribed: (podcastId: string) => void
  onClose: () => void
}) {
  const [feedUrl, setFeedUrl] = useState('')
  const { state, busy, subscribe } = useSubscribe(data)
  const error = failureMessage(state, errorMessages)

  useEffect(() => {
    if (state?.status === 'subscribed') onSubscribed(state.podcastId)
  }, [state, onSubscribed])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void subscribe(feedUrl)
  }

  return (
    <div className="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-podcast-title">
        <h2 id="add-podcast-title">Add podcast</h2>
        <form className="add-podcast" onSubmit={handleSubmit} noValidate>
          <label>
            Feed URL
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              autoFocus
              placeholder="https://"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
            />
          </label>
          {state?.status === 'pending' && <p role="status">Checking the feed…</p>}
          {state?.status === 'alreadySubscribed' && (
            <p role="status">
              {titleOf(state.podcastId)
                ? `You’re already subscribed to ${titleOf(state.podcastId)}.`
                : 'You’re already subscribed to that podcast.'}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Subscribe
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

/**
 * Brings in every subscription from another podcast app, from the OPML file
 * it exports. The file picker is opened from the library's "More actions";
 * this holds its input, out of sight, and says how the import goes.
 */
function OpmlImport({
  state,
  onImport,
  input,
  busy,
}: {
  state: ImportState
  onImport: (file: File) => void
  input: RefObject<HTMLInputElement | null>
  busy: boolean
}) {

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared, so choosing the same file again imports it again.
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <section className="opml-import">
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        aria-label="Import OPML file"
        tabIndex={-1}
        accept=".opml,.xml,text/x-opml,text/xml,application/xml"
        onChange={handleChange}
        disabled={busy}
      />
      {state.status === 'tooLarge' && <p role="alert">That file is too big for an OPML file (over 5 MB).</p>}
      {state.status === 'invalid' && <p role="alert">That file isn’t a valid OPML file.</p>}
      {state.status === 'empty' && <p role="alert">That OPML file lists no podcast feeds.</p>}
      {(state.status === 'importing' || state.status === 'finished') && <ImportSummary state={state} />}
    </section>
  )
}

function ImportSummary({ state }: { state: Extract<ImportState, { status: 'importing' | 'finished' }> }) {
  const count = (outcome: ImportOutcome) => state.results.filter((result) => result.outcome === outcome).length
  const done = state.results.filter((result) => result.outcome !== null).length
  const notAdded = state.results.filter((result) => result.outcome === 'failed').map((result) => result.feed)
  return (
    <div role="status" aria-label="OPML import">
      {state.status === 'importing' ? (
        <p>
          Importing podcasts: {done} of {state.results.length} done…
        </p>
      ) : (
        <>
          <p>
            Import finished: {count('added')} added, {count('skipped')} already in your library, {count('failed')} failed.
          </p>
          {notAdded.length > 0 && (
            <>
              <p>Couldn’t add these. Check their feed URLs in the other app and subscribe to them by URL:</p>
              <ul aria-label="Feeds not added">
                {notAdded.map((feed) => (
                  <li key={feed.feedUrl}>{feed.title ?? feedHost(feed.feedUrl)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Names a feed with no title by its host alone: the rest of a feed URL can hold a private feed's access token. */
function feedHost(feedUrl: string): string {
  try {
    return new URL(feedUrl).host || 'A feed with no name'
  } catch {
    return 'A feed with no name'
  }
}

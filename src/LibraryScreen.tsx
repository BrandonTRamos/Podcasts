import { type ChangeEvent, type FormEvent, Fragment, type RefObject, useEffect, useRef, useState } from 'react'
import { CategoryDialog } from './CategoryDialog'
import { inListOrder, type LibrarySection, librarySections, OTHER, type Placement, placementsFor } from './categories'
import { ChevronDownIcon, PlusIcon } from './Icons'
import { type LibraryDrag, LIFTED_INSET, useLibraryDrag } from './libraryDrag'
import type { ListeningStore } from './listening'
import { MoreActions } from './MoreActions'
import { useNewEpisodeCounts } from './newEpisodes'
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
  listening,
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
  /** Whose episodes are played, to tell which podcasts have new ones. */
  listening: ListeningStore
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
  const { moved, moveFailed, move } = useMoves(podcasts, data)
  const sections = shownSections(moved, categoryList)
  const newCounts = useNewEpisodeCounts(data, listening)

  const main = useRef<HTMLElement>(null)
  const { drag, bind, ghost } = useLibraryDrag({
    container: main,
    podcastOf(podcastId) {
      for (const section of sections) {
        const podcast = section.podcasts.find((p) => p.id === podcastId)
        if (podcast) return { podcast, section: section.key }
      }
    },
    isOpen: (section) => openSections.has(section),
    onOpenSection: (section) => {
      if (!openSections.has(section)) onToggleSection(section)
    },
    onDrop(podcast, _from, target) {
      const section = sections.find((s) => s.key === target.section)
      if (!section) return
      const others = section.podcasts.filter((p) => p.id !== podcast.id)
      move(
        placementsFor(others, podcast.id, target.index).map((placement) => ({
          ...placement,
          categoryId: section.category?.id ?? null,
        })),
      )
    },
  })

  return (
    <main ref={main} className={drag ? 'library dragging' : 'library'}>
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
      {moveFailed && <p role="alert">Couldn’t move the podcast. Check your connection and try again.</p>}
      {(podcasts.status === 'loading' || categories.status === 'loading') && <p>Loading…</p>}
      {podcasts.status === 'failed' && <p role="alert">Couldn’t load your library.</p>}
      {podcasts.status === 'loaded' && categories.status !== 'loading' && (
        <>
          {podcasts.items.length === 0 && <p>No podcasts yet.</p>}
          {categoryList.length === 0
            ? podcasts.items.length > 0 && (
                <PodcastList
                  label="Podcasts"
                  section={sections[0]}
                  newCounts={newCounts}
                  drag={drag}
                  bind={bind}
                  onOpen={onOpenPodcast}
                />
              )
            : sections.map((section) => (
                <CategorySection
                  key={section.key}
                  section={section}
                  open={openSections.has(section.key)}
                  newCounts={newCounts}
                  drag={drag}
                  bind={bind}
                  onToggle={() => onToggleSection(section.key)}
                  onOpenPodcast={onOpenPodcast}
                  onRename={(category) => setEditing({ action: 'rename', category })}
                  onDelete={setDeleting}
                />
              ))}
        </>
      )}
      {drag && <DraggedPodcast drag={drag} card={ghost} newCount={newCounts.get(drag.podcast.id) ?? 0} />}
    </main>
  )
}

/** A section of the library as shown, keyed by its category's ID, or `OTHER_SECTION`. */
interface ShownSection extends LibrarySection {
  key: string
}

/** The library's sections, or with no categories, one holding every podcast. */
function shownSections(podcasts: LoadState<Podcast>, categories: Category[]): ShownSection[] {
  if (podcasts.status !== 'loaded') return []
  if (categories.length === 0) return [{ key: OTHER_SECTION, category: null, podcasts: inListOrder(podcasts.items) }]
  return librarySections(podcasts.items, categories).map((section) => ({
    ...section,
    key: section.category?.id ?? OTHER_SECTION,
  }))
}

/** A podcast's place as a move left it, until the library shows it there. */
interface Move extends Placement {
  categoryId: string | null
}

/**
 * Moves podcasts, showing them moved at once. Each stays shown where it was
 * put while it is saved and a few seconds after, time for the library to bring
 * it there. A move that fails puts it back, and says so.
 */
function useMoves(podcasts: LoadState<Podcast>, data: Pick<DataApi, 'placePodcast'>) {
  const [moves, setMoves] = useState<ReadonlyMap<string, Move>>(new Map())
  const [moveFailed, setMoveFailed] = useState(false)

  const moved: LoadState<Podcast> =
    podcasts.status === 'loaded' && moves.size > 0
      ? {
          ...podcasts,
          items: podcasts.items.map((podcast) => {
            const move = moves.get(podcast.id)
            return move ? { ...podcast, categoryId: move.categoryId, libraryOrder: move.libraryOrder } : podcast
          }),
        }
      : podcasts

  function forget(made: Move[]) {
    setMoves((pending) => {
      const left = new Map(pending)
      for (const move of made) if (left.get(move.podcastId) === move) left.delete(move.podcastId)
      return left
    })
  }

  async function move(made: Move[]) {
    setMoveFailed(false)
    setMoves((pending) => new Map([...pending, ...made.map((m) => [m.podcastId, m] as const)]))
    try {
      await Promise.all(made.map((m) => data.placePodcast(m.podcastId, m.categoryId, m.libraryOrder)))
      // By then the library has it as saved, or changed again elsewhere, which it should show.
      window.setTimeout(() => forget(made), 5000)
    } catch {
      forget(made)
      setMoveFailed(true)
    }
  }

  return { moved, moveFailed, move: (made: Move[]) => void move(made) }
}

type BindRow = ReturnType<typeof useLibraryDrag>['bind']

/** How many new episodes each podcast has; those with none are absent. */
type NewCounts = ReadonlyMap<string, number>

/** A category's podcasts, or Other's, under a heading that opens and closes it. */
function CategorySection({
  section,
  open,
  newCounts,
  drag,
  bind,
  onToggle,
  onOpenPodcast,
  onRename,
  onDelete,
}: {
  section: ShownSection
  open: boolean
  newCounts: NewCounts
  drag: LibraryDrag | null
  bind: BindRow
  onToggle: () => void
  onOpenPodcast: (podcastId: string) => void
  onRename: (category: Category) => void
  onDelete: (category: Category) => void
}) {
  const { category, podcasts, key } = section
  const name = category?.name ?? OTHER
  const targeted = drag?.target.section === key
  return (
    <section className="category" aria-label={name}>
      <div
        className={targeted && !open ? 'category-heading drop-into' : 'category-heading'}
        data-drop="heading"
        data-section={key}
        data-flip={`heading:${key}`}
      >
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
        (podcasts.length === 0 && !targeted ? (
          <p className="category-empty" data-drop="heading" data-section={key} data-flip={`empty:${key}`}>
            No podcasts here yet. Open a podcast to choose its category, or hold one to drag it here.
          </p>
        ) : (
          <PodcastList
            label={name}
            section={section}
            newCounts={newCounts}
            drag={drag}
            bind={bind}
            onOpen={onOpenPodcast}
          />
        ))}
    </section>
  )
}

/**
 * A section's podcasts. While one is dragged, it leaves its place (kept, out
 * of sight, for the touch that holds it) and a gap shows where it would land.
 */
function PodcastList({
  label,
  section: { key, podcasts },
  newCounts,
  drag,
  bind,
  onOpen,
}: {
  label: string
  section: ShownSection
  newCounts: NewCounts
  drag: LibraryDrag | null
  bind: BindRow
  onOpen: (podcastId: string) => void
}) {
  const gapAt = drag?.target.section === key ? drag.target.index : null
  const gap = (
    <li
      key="drop-gap"
      className="drop-gap"
      data-drop="gap"
      data-section={key}
      data-flip="gap"
      style={{ height: drag?.height }}
      aria-hidden="true"
    />
  )
  const others = podcasts.filter((podcast) => podcast.id !== drag?.podcast.id)
  const indexOf = new Map(others.map((podcast, index) => [podcast.id, index]))
  return (
    <ul className="podcasts" aria-label={label}>
      {podcasts.map((podcast) => {
        const held = drag?.podcast.id === podcast.id
        const at = indexOf.get(podcast.id) ?? null
        return (
          <Fragment key={podcast.id}>
            {at !== null && at === gapAt && gap}
            <li
              className={held ? 'drag-source' : undefined}
              data-drop={held ? undefined : 'row'}
              data-section={key}
              data-index={at ?? undefined}
              data-flip={podcast.id}
              {...bind(podcast.id)}
            >
              <PodcastRow podcast={podcast} newCount={newCounts.get(podcast.id) ?? 0} onOpen={onOpen} />
            </li>
          </Fragment>
        )
      })}
      {gapAt !== null && gapAt >= others.length && gap}
    </ul>
  )
}

/** A podcast in the library, with how many new episodes it has on its artwork's corner. */
function PodcastRow({
  podcast,
  newCount,
  onOpen,
}: {
  podcast: Podcast
  newCount: number
  onOpen?: (podcastId: string) => void
}) {
  return (
    <button type="button" className="plain" onClick={onOpen && (() => onOpen(podcast.id))} tabIndex={onOpen ? undefined : -1}>
      <span className="podcast-artwork">
        <Artwork url={podcast.artworkUrl} />
        {newCount > 0 && (
          <span className="new-count" aria-hidden="true">
            {newCount}
          </span>
        )}
      </span>
      <span className="podcast-title">{podcast.title}</span>
      {podcast.author && <span className="podcast-author">{podcast.author}</span>}
      {newCount > 0 && (
        <span className="visually-hidden">{newCount === 1 ? ', 1 new episode' : `, ${newCount} new episodes`}</span>
      )}
    </button>
  )
}

/**
 * The podcast being dragged, lifted, under the finger. It is placed by the
 * drag, outside rendering, through `card`.
 */
function DraggedPodcast({
  drag,
  card,
  newCount,
}: {
  drag: LibraryDrag
  card: RefObject<HTMLDivElement | null>
  newCount: number
}) {
  return (
    <div ref={card} className="dragged-podcast" aria-hidden="true" style={{ width: drag.width + 2 * LIFTED_INSET }}>
      <div className="podcasts dragged-card">
        <PodcastRow podcast={drag.podcast} newCount={newCount} />
      </div>
    </div>
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

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import type { ImportOutcome, ImportState } from './opmlImport'
import type { DataApi, Podcast } from './services'
import type { LoadState } from './SignedInApp'
import { failureMessage, type SubscribeFailure, useSubscribe } from './subscribing'

export function LibraryScreen({
  podcasts,
  data,
  onOpenPodcast,
  onOpenQueue,
  onOpenLatest,
  onOpenSearch,
  onSignOut,
  opmlImport,
  onImportOpml,
}: {
  podcasts: LoadState<Podcast>
  data: DataApi
  opmlImport: ImportState
  onImportOpml: (file: File) => void
  onOpenPodcast: (podcastId: string) => void
  onOpenQueue: () => void
  onOpenLatest: () => void
  onOpenSearch: () => void
  onSignOut: () => Promise<void>
}) {
  return (
    <main className="library">
      <header>
        <h1>Library</h1>
        <button type="button" onClick={onOpenSearch}>
          Search
        </button>
        <button type="button" onClick={onOpenLatest}>
          Latest
        </button>
        <button type="button" onClick={onOpenQueue}>
          Queue
        </button>
        <button type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </header>
      <AddPodcastForm
        data={data}
        titleOf={(podcastId) =>
          podcasts.status === 'loaded' ? podcasts.items.find((p) => p.id === podcastId)?.title : undefined
        }
        onSubscribed={onOpenPodcast}
      />
      <OpmlImport state={opmlImport} onImport={onImportOpml} />
      {podcasts.status === 'loading' && <p>Loading…</p>}
      {podcasts.status === 'failed' && <p role="alert">Couldn’t load your library.</p>}
      {podcasts.status === 'loaded' &&
        (podcasts.items.length === 0 ? (
          <p>No podcasts yet.</p>
        ) : (
          <ul className="podcasts" aria-label="Podcasts">
            {[...podcasts.items]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((podcast) => (
                <li key={podcast.id}>
                  <button type="button" onClick={() => onOpenPodcast(podcast.id)}>
                    <Artwork url={podcast.artworkUrl} />
                    <span className="podcast-title">{podcast.title}</span>
                    {podcast.author && <span className="podcast-author">{podcast.author}</span>}
                  </button>
                </li>
              ))}
          </ul>
        ))}
    </main>
  )
}

export function Artwork({ url, size = 'small' }: { url: string | null; size?: 'small' | 'large' | 'hero' }) {
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

function AddPodcastForm({
  data,
  titleOf,
  onSubscribed,
}: {
  data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>
  titleOf: (podcastId: string) => string | undefined
  onSubscribed: (podcastId: string) => void
}) {
  const [feedUrl, setFeedUrl] = useState('')
  const { state, busy, subscribe } = useSubscribe(data)
  const error = failureMessage(state, errorMessages)

  useEffect(() => {
    if (state?.status === 'subscribed') onSubscribed(state.podcastId)
  }, [state, onSubscribed])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void subscribe(feedUrl)
  }

  return (
    <form className="add-podcast" onSubmit={handleSubmit} noValidate>
      <label>
        Feed URL
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        Subscribe
      </button>
      {state?.status === 'pending' && <p role="status">Checking the feed…</p>}
      {state?.status === 'alreadySubscribed' && (
        <p role="status">
          {titleOf(state.podcastId)
            ? `You’re already subscribed to ${titleOf(state.podcastId)}.`
            : 'You’re already subscribed to that podcast.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

/** Brings in every subscription from another podcast app, from the OPML file it exports. */
function OpmlImport({ state, onImport }: { state: ImportState; onImport: (file: File) => void }) {
  const busy = state.status === 'reading' || state.status === 'importing'

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared, so choosing the same file again imports it again.
    event.target.value = ''
    if (file) onImport(file)
  }

  return (
    <section className="opml-import">
      <label>
        Import OPML file
        <input
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml,application/xml"
          onChange={handleChange}
          disabled={busy}
        />
      </label>
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

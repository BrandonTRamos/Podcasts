import { useState } from 'react'
import { type EpisodeActions, EpisodeMeta, EpisodeRow } from './EpisodeRow'
import type { FeedSearchLoad } from './feedSearch'
import type { DataApi, Episode, EpisodeState, KeepEpisodeOutcome } from './services'

/**
 * Under a podcast's episodes while they are searched: a button that searches
 * the whole feed for the same words, show notes included, and what that finds
 * beyond the episodes listed above. The library keeps only a feed's newest
 * episodes, so most of these are older ones it doesn't have: each can be
 * added, and is then an episode like any other, in the podcast's Recently
 * Added. The button submits the search form, so the keyboard's search key does
 * the same.
 */
export function OlderEpisodes({
  data,
  term,
  formId,
  load,
  more,
  inLibrary,
  stateOf,
  isNew,
  onKept,
  onSetAdded,
  ...actions
}: {
  data: Pick<DataApi, 'keepEpisode'>
  /** The words searched for, as the listener typed them. */
  term: string
  /** The search form, which the button submits. */
  formId: string
  /** The search of the feed for this term; null when there has been none. */
  load: FeedSearchLoad | null
  /** What a finished search found that is not listed above, newest first. */
  more: Episode[] | null
  /** The episode as the library has it, if it does. */
  inLibrary: (episodeId: string) => Episode | undefined
  stateOf: (episodeId: string) => EpisodeState | undefined
  /** Whether to call an episode the library has new. */
  isNew: (episodeId: string) => boolean
  /** Called with an episode once it has been added to the library. */
  onKept: (episode: Episode) => void
  /** Adds an episode the library has to the podcast's Recently Added, or takes it out. */
  onSetAdded: (episode: Episode, added: boolean) => void
} & EpisodeActions) {
  const feedUnavailable = load?.status === 'done' && load.search.outcome === 'feedUnavailable'
  const cut = load?.status === 'done' && load.search.outcome === 'found' && load.search.more
  const canSearch = load === null || load.status === 'offline' || feedUnavailable

  return (
    <section className="older-episodes" aria-label="Older episodes">
      {canSearch && (
        <button type="submit" form={formId} className="outline">
          Search older episodes
        </button>
      )}
      {load === null && <p className="older-episodes-hint">Looks through the podcast’s whole feed, show notes included.</p>}
      {load?.status === 'loading' && <p role="status">Searching the feed…</p>}
      {load?.status === 'offline' && <p role="alert">Couldn’t search. Check your connection and try again.</p>}
      {feedUnavailable && <p role="alert">Couldn’t reach the podcast’s feed. Try again later.</p>}
      {more?.length === 0 && <p role="status">Nothing more in the feed matches “{term}”.</p>}
      {more && more.length > 0 && (
        <>
          <h3>More from the feed</h3>
          <ol className="episodes" aria-label="More from the feed">
            {more.map((found) => {
              const episode = inLibrary(found.id)
              return episode ? (
                <EpisodeRow
                  key={found.id}
                  episode={episode}
                  state={stateOf(found.id)}
                  isNew={isNew(found.id)}
                  onSetAdded={onSetAdded}
                  {...actions}
                />
              ) : (
                <FeedEpisodeRow key={found.id} episode={found} data={data} onKept={onKept} />
              )
            })}
          </ol>
        </>
      )}
      {cut && <p className="older-episodes-hint">These are the newest 50 matches. Add a word to narrow them down.</p>}
    </section>
  )
}

const keepFailures: Record<Exclude<KeepEpisodeOutcome, 'kept'> | 'offline', string> = {
  notFound: 'The feed no longer lists this episode.',
  feedUnavailable: 'Couldn’t reach the podcast’s feed. Try again later.',
  offline: 'Couldn’t add it. Check your connection and try again.',
}

/** An episode the feed lists and the library doesn't have, with a button that adds it. */
function FeedEpisodeRow({
  episode,
  data,
  onKept,
}: {
  episode: Episode
  data: Pick<DataApi, 'keepEpisode'>
  onKept: (episode: Episode) => void
}) {
  const [step, setStep] = useState<'idle' | 'adding' | keyof typeof keepFailures>('idle')

  async function add() {
    setStep('adding')
    let outcome: KeepEpisodeOutcome | 'offline'
    try {
      outcome = await data.keepEpisode(episode.podcastId, episode.id)
    } catch {
      outcome = 'offline'
    }
    // Once added it is listed as the library's episodes are, in place of this row.
    if (outcome === 'kept') onKept(episode)
    else setStep(outcome)
  }

  return (
    <li className="episode-row">
      <div className="episode-row-main">
        <EpisodeMeta episode={episode} />
        <h2>{episode.title}</h2>
        {step === 'adding' && <p role="status">Adding…</p>}
        {step !== 'idle' && step !== 'adding' && <p role="alert">{keepFailures[step]}</p>}
      </div>
      <button
        type="button"
        className="outline"
        aria-label={`Add ${episode.title}`}
        onClick={() => void add()}
        disabled={step === 'adding'}
      >
        Add
      </button>
    </li>
  )
}

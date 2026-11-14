import { useEffect, useState } from 'react'
import { EpisodeMeta } from './EpisodeRow'
import { type ListeningStore, useEpisodeStates } from './listening'
import type { DataApi, Episode } from './services'
import { ShowNotes, type ShowNotesState } from './ShowNotes'

/** One episode: its title, podcast, date and duration, a button to play it, and its show notes. */
export function EpisodeScreen({
  data,
  episode,
  podcastTitle,
  listening,
  backLabel,
  onBack,
  onPlay,
}: {
  data: Pick<DataApi, 'getShowNotes'>
  episode: Episode
  podcastTitle: string | undefined
  listening: ListeningStore
  /** Where going back leads, as the back button shows it. */
  backLabel: string
  onBack: () => void
  onPlay: (episode: Episode) => void
}) {
  const [notes, setNotes] = useState<ShowNotesState>({ status: 'loading' })
  // Wait for the listening state, so playing from here still resumes.
  const statesStatus = useEpisodeStates(listening, episode.podcastId)

  useEffect(() => {
    let cancelled = false
    data.getShowNotes(episode.id).then(
      (loaded) => cancelled || setNotes({ status: 'loaded', notes: loaded }),
      () => cancelled || setNotes({ status: 'failed' }),
    )
    return () => {
      cancelled = true
    }
  }, [data, episode.id])

  return (
    <main className="episode">
      <nav>
        <button type="button" onClick={onBack} aria-label="Back">
          ‹ {backLabel}
        </button>
      </nav>
      <header>
        <h1>{episode.title}</h1>
        <EpisodeMeta episode={episode} podcastTitle={podcastTitle} />
        <button type="button" className="episode-play" onClick={() => onPlay(episode)} disabled={statesStatus === 'loading'}>
          Play
        </button>
      </header>
      <ShowNotes notes={notes} />
    </main>
  )
}

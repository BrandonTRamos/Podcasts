import { useEffect, useState } from 'react'
import { DownloadControl } from './DownloadControl'
import type { DownloadState } from './downloads'
import { EpisodeMeta, UnavailableOffline } from './EpisodeRow'
import { ChevronLeftIcon, PlayIcon } from './Icons'
import { type ListeningStore, useEpisodeStates } from './listening'
import type { DataApi, Episode } from './services'
import { ShowNotes, type ShowNotesState } from './ShowNotes'

/** One episode: its title, podcast, date and duration, buttons to play and download it, and its show notes. */
export function EpisodeScreen({
  data,
  episode,
  podcastTitle,
  listening,
  backLabel,
  onBack,
  onPlay,
  onSeek,
  download,
  onDownload,
  unavailable,
}: {
  data: Pick<DataApi, 'getShowNotes'>
  episode: Episode
  podcastTitle: string | undefined
  listening: ListeningStore
  /** Where going back leads, as the back button shows it. */
  backLabel: string
  onBack: () => void
  onPlay: (episode: Episode) => void
  onSeek: (episode: Episode, seconds: number) => void
  download: DownloadState
  onDownload: (episode: Episode) => void
  /** It can't play now: the device is offline and it is not downloaded. */
  unavailable: boolean
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
        <button type="button" className="back" onClick={onBack} aria-label={`Back to ${backLabel}`}>
          <ChevronLeftIcon size={18} />
          <span>{backLabel}</span>
        </button>
      </nav>
      <header className="tray">
        <h1>{episode.title}</h1>
        <EpisodeMeta episode={episode} podcastTitle={podcastTitle} />
        <button
          type="button"
          className="primary episode-play"
          onClick={() => onPlay(episode)}
          disabled={statesStatus === 'loading' || unavailable}
        >
          <PlayIcon size={18} />
          Play
        </button>
        {unavailable && <UnavailableOffline />}
        <DownloadControl download={download} onDownload={() => onDownload(episode)} />
      </header>
      {statesStatus === 'failed' && <p role="alert">Couldn’t load what you’ve played.</p>}
      <ShowNotes
        notes={notes}
        onSeek={(seconds) => onSeek(episode, seconds)}
        seekDisabled={statesStatus === 'loading' || unavailable}
      />
    </main>
  )
}

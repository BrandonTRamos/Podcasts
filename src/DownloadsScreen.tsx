import { DownloadPreparing, DownloadProgress } from './DownloadControl'
import { type StoredDownload, storedBytes } from './downloads'
import { formatSize } from './format'
import type { Episode } from './services'

/**
 * What is stored on this device, and how much room it takes: downloads
 * running or interrupted, which can be cancelled; finished ones, which can be
 * played or deleted; and those the device has cleared since, which can be
 * downloaded again or dismissed.
 */
export function DownloadsScreen({
  downloads,
  podcastTitleOf,
  onBack,
  onPlay,
  onDownload,
  onRemove,
}: {
  downloads: StoredDownload[]
  podcastTitleOf: (podcastId: string) => string | undefined
  onBack: () => void
  onPlay: (episode: Episode) => void
  /** Downloads it, again or from where it stopped. */
  onDownload: (episode: Episode) => void
  /** Deletes what is stored of it, cancelling its download if running, and forgets it. */
  onRemove: (episodeId: string) => void
}) {
  const inProgress = downloads.filter(({ state }) => state.status === 'downloading' || state.status === 'interrupted')
  const downloaded = downloads.filter(({ state }) => state.status === 'downloaded')
  const lost = downloads.filter(({ state }) => state.status === 'lost')
  const used = downloads.reduce((sum, { state }) => sum + storedBytes(state), 0)

  return (
    <main className="downloads">
      <nav>
        <button type="button" onClick={onBack} aria-label="Back to library">
          ‹ Library
        </button>
      </nav>
      <h1>Downloads</h1>
      {downloads.length === 0 ? (
        <p>Nothing is downloaded to this device.</p>
      ) : (
        <p className="downloads-used">{formatSize(used)} used on this device</p>
      )}

      {inProgress.length > 0 && (
        <section>
          <h2>Downloading</h2>
          <ul className="downloads-list" aria-label="Downloads in progress">
            {inProgress.map((download) => {
              const { episodeId, episode, state } = download
              if (state.status !== 'downloading' && state.status !== 'interrupted') return null
              return (
                <li key={episodeId}>
                  <DownloadHeading episode={episode} podcastTitleOf={podcastTitleOf} />
                  <div className="episode-download">
                    {state.status === 'downloading' && state.preparing ? (
                      <DownloadPreparing />
                    ) : (
                      <DownloadProgress bytes={state.bytes} total={state.total} />
                    )}
                    {state.status === 'interrupted' && (
                      <>
                        <span>Download interrupted</span>
                        {episode && (
                          <button type="button" onClick={() => onDownload(episode)}>
                            Resume download
                          </button>
                        )}
                      </>
                    )}
                    <button type="button" onClick={() => onRemove(episodeId)}>
                      Cancel download
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {downloaded.length > 0 && (
        <section>
          <h2>Downloaded</h2>
          <ul className="downloads-list" aria-label="Downloaded episodes">
            {downloaded.map((download) => (
              <li key={download.episodeId}>
                <DownloadHeading episode={download.episode} podcastTitleOf={podcastTitleOf} onPlay={onPlay} />
                <div className="episode-download">
                  <span>{formatSize(storedBytes(download.state))}</span>
                  <button type="button" onClick={() => onRemove(download.episodeId)}>
                    Delete download
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lost.length > 0 && (
        <section>
          <h2>Lost</h2>
          <p>These were downloaded, but this device has since cleared them, most likely to free space.</p>
          <ul className="downloads-list" aria-label="Lost downloads">
            {lost.map((download) => {
              const { episodeId, episode } = download
              return (
                <li key={episodeId}>
                  <DownloadHeading episode={episode} podcastTitleOf={podcastTitleOf} />
                  <div className="episode-download">
                    {episode && (
                      <button type="button" onClick={() => onDownload(episode)}>
                        Download again
                      </button>
                    )}
                    <button type="button" onClick={() => onRemove(episodeId)}>
                      Dismiss
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}

/** A download's episode title and podcast, as far as they are known; the title plays it when given `onPlay`. */
function DownloadHeading({
  episode,
  podcastTitleOf,
  onPlay,
}: {
  episode: Episode | null
  podcastTitleOf: (podcastId: string) => string | undefined
  onPlay?: (episode: Episode) => void
}) {
  const podcastTitle = episode && podcastTitleOf(episode.podcastId)
  return (
    <>
      <h2>
        {episode && onPlay ? (
          <button type="button" onClick={() => onPlay(episode)}>
            {episode.title}
          </button>
        ) : (
          (episode?.title ?? 'Unknown episode')
        )}
      </h2>
      {podcastTitle && (
        <p className="episode-meta">
          <span>{podcastTitle}</span>
        </p>
      )}
    </>
  )
}

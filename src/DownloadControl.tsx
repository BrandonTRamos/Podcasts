import { type DownloadFailure, type DownloadState, percentOf } from './downloads'
import { formatMegabytes } from './format'

const failureMessages: Record<DownloadFailure, string> = {
  unavailable: 'This episode couldn’t be downloaded: its publisher’s host didn’t send the file.',
  noSpace: 'Not enough space on this device to download this episode.',
  other: 'This episode couldn’t be downloaded.',
}

/**
 * An episode's download: a button to start it, its progress while it runs, a
 * button to resume it once interrupted, and a badge once it is stored.
 */
export function DownloadControl({ download, onDownload }: { download: DownloadState; onDownload: () => void }) {
  switch (download.status) {
    case 'none':
      return (
        <div className="episode-download">
          <button type="button" onClick={onDownload}>
            Download
          </button>
        </div>
      )
    case 'downloading':
      return (
        <div className="episode-download">
          <DownloadProgress bytes={download.bytes} total={download.total} />
        </div>
      )
    case 'interrupted':
      return (
        <div className="episode-download">
          <DownloadProgress bytes={download.bytes} total={download.total} />
          <span>Download interrupted</span>
          <button type="button" onClick={onDownload}>
            Resume download
          </button>
        </div>
      )
    case 'downloaded':
      return (
        <div className="episode-download">
          <DownloadedBadge />
        </div>
      )
    case 'blocked':
      return (
        <div className="episode-download">
          <p role="alert">This episode can’t be downloaded yet: its publisher doesn’t allow direct downloads.</p>
        </div>
      )
    case 'failed':
      return (
        <div className="episode-download">
          <p role="alert">{failureMessages[download.reason]}</p>
          <button type="button" onClick={onDownload}>
            Try again
          </button>
        </div>
      )
  }
}

function DownloadProgress({ bytes, total }: { bytes: number; total: number | null }) {
  if (!total) {
    return (
      <span className="download-progress">
        <progress aria-label="Download progress" />
        <span>{formatMegabytes(bytes)}</span>
      </span>
    )
  }
  return (
    <span className="download-progress">
      <progress aria-label="Download progress" max={total} value={Math.min(bytes, total)} />
      <span>{percentOf(bytes, total)}%</span>
    </span>
  )
}

/** Marks an episode whose whole file is stored on this device. */
export function DownloadedBadge() {
  return <span className="episode-downloaded">Downloaded</span>
}

import { type DownloadFailure, type DownloadState, percentOf } from './downloads'
import { formatSize } from './format'

const failureMessages: Record<DownloadFailure, string> = {
  unavailable: 'This episode couldn’t be downloaded: its publisher’s host didn’t send the file.',
  noSpace: 'Not enough space on this device to download this episode.',
  other: 'This episode couldn’t be downloaded.',
}

/**
 * An episode's download: a button to start it, its progress while it runs, a
 * button to resume it once interrupted, a badge once it is stored, and word
 * when its stored file has gone.
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
    case 'lost':
      return (
        <div className="episode-download">
          <DownloadLost />
          <button type="button" onClick={onDownload}>
            Download again
          </button>
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

/** How much of a download is stored: a bar and percent of a known size, or the bytes so far of an unknown one. */
export function DownloadProgress({ bytes, total }: { bytes: number; total: number | null }) {
  if (!total) {
    return (
      <span className="download-progress">
        <progress aria-label="Download progress" />
        <span>{formatSize(bytes)}</span>
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

/** Says a downloaded episode's file has gone from the device since: most likely the OS cleared it to free space. */
export function DownloadLost() {
  return <p className="episode-download-lost">This episode’s download is no longer on this device.</p>
}

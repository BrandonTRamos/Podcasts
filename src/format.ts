/** "45 min", "1 hr 2 min", "2 hr"; under a minute, "30 sec". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)} sec`
  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

/** A playback clock: "0:05", "12:30", "1:02:03". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.floor(Math.max(totalSeconds, 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** A publish date in the listener's locale and time zone. */
export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** A moment in the listener's locale and time zone, to the minute. */
export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso))
}

/** A file size to one decimal place of a megabyte: "12.3 MB". */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** A size on disk to one decimal place of the largest unit it reaches: "980.0 KB", "12.3 MB", "1.2 GB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return formatMegabytes(bytes)
  return `${(bytes / 1_000).toFixed(1)} KB`
}

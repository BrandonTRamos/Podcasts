import { keptPlace } from './keptPlace'
import type { DeviceStorage, PlaybackLog } from './services'

/** How many lines the log keeps: a few hours of listening. */
export const LOG_LINES = 300

/** Where a log keeps its text between launches. */
export interface TextStore {
  read(): string | null
  /** May throw, when there is no room or no storage. */
  write(text: string): void
}

/** A text kept in memory alone: gone when the app closes. */
export function memoryText(): TextStore {
  let kept: string | null = null
  return { read: () => kept, write: (text) => void (kept = text) }
}

/**
 * A text in `localStorage` under its own key, apart from the device's
 * records, which are swept of keys their owners don't know.
 */
export function localStorageText(key: string): TextStore {
  return {
    read() {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write: (text) => localStorage.setItem(key, text),
  }
}

/** A line's stamp: month, day and time (UTC) to the millisecond. */
const stamp = (date: Date) => date.toISOString().slice(5, 23)

/**
 * A playback log of at most `LOG_LINES` lines, each stamped with the month,
 * day and time (UTC) to the millisecond. Every line is written to the store as
 * it is recorded, as iOS can suspend or kill the app at any moment.
 */
export function createPlaybackLog(store: TextStore, now: () => Date = () => new Date()): PlaybackLog {
  let lines: string[] | null = null

  function kept() {
    if (lines) return lines
    lines = []
    try {
      const stored: unknown = JSON.parse(store.read() ?? '[]')
      if (Array.isArray(stored)) lines = stored.filter((line) => typeof line === 'string').slice(-LOG_LINES)
    } catch {
      // Unreadable: start again.
    }
    return lines
  }

  return {
    record(line) {
      const all = kept()
      all.push(`${stamp(now())} ${line}`)
      if (all.length > LOG_LINES) all.splice(0, all.length - LOG_LINES)
      try {
        store.write(JSON.stringify(all))
      } catch {
        // No room or no storage: the log then lasts until the app closes.
      }
    },
    lines: () => [...kept()],
  }
}

/** The element's events worth a line. `timeupdate` and `progress` fire many times a second or so. */
const AUDIO_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'canplay',
  'play',
  'playing',
  'waiting',
  'stalled',
  'suspend',
  'pause',
  'seeked',
  'ended',
  'emptied',
  'abort',
  'error',
] as const

/** TypeScript's DOM types lack the Audio Session API. */
type AudioSession = EventTarget & { state?: string }

/**
 * Records what the audio element, the page and Safari's audio session do, for
 * the life of the app. Each line carries the element's state then:
 *
 * - `t`: its position in seconds
 * - `paused` or `unpaused`: what the element says, whatever is heard
 * - `ready`: `readyState`, from 0 (nothing loaded) to 4 (enough to play on)
 * - `net`: `networkState`: 1 idle, 2 loading, 3 no source
 * - `visible` or `hidden`: the page; hidden covers a locked phone
 * - `session`: Safari's audio session: active, interrupted or inactive
 * - `offline`: when the browser says so
 *
 * `moving` is the first time the position advances after a `play`: without it,
 * the element said it was playing and went nowhere.
 */
export function recordPlayback(log: PlaybackLog, audio: HTMLMediaElement): void {
  const session = (navigator as { audioSession?: AudioSession }).audioSession

  const state = () =>
    [
      `t=${audio.currentTime.toFixed(1)}`,
      audio.paused ? 'paused' : 'unpaused',
      `ready=${audio.readyState}`,
      `net=${audio.networkState}`,
      document.visibilityState,
      session?.state ? `session=${session.state}` : '',
      navigator.onLine ? '' : 'offline',
    ]
      .filter(Boolean)
      .join(' ')

  const record = (what: string) => log.record(`${what} ${state()}`)

  /** The position when last looked at, while waiting for it to advance after a `play`; null once it has. */
  let waitingToMoveFrom: number | null = null

  for (const type of AUDIO_EVENTS) {
    audio.addEventListener(type, () => {
      if (type === 'play') waitingToMoveFrom = audio.currentTime
      if (type === 'loadstart') record(`audio loadstart ${audio.currentSrc.startsWith('blob:') ? 'copy' : 'stream'}`)
      else if (type === 'error') record(`audio error code=${audio.error?.code ?? '?'}`)
      else record(`audio ${type}`)
    })
  }
  audio.addEventListener('timeupdate', () => {
    if (waitingToMoveFrom === null) return
    const from = waitingToMoveFrom
    waitingToMoveFrom = audio.currentTime
    // A seek moves the position too, by any amount, either way.
    if (audio.paused || audio.seeking || audio.currentTime <= from || audio.currentTime - from > 5) return
    waitingToMoveFrom = null
    record('audio moving')
  })

  document.addEventListener('visibilitychange', () => record('page'))
  window.addEventListener('pageshow', (event) => record(event.persisted ? 'page restored' : 'page shown'))
  window.addEventListener('pagehide', () => record('page going'))
  session?.addEventListener('statechange', () => record('session changed'))

  const installed = window.matchMedia?.('(display-mode: standalone)').matches ? 'installed' : 'in browser'
  record(`launch ${installed} ${navigator.userAgent}`)
}

/**
 * Records, at launch, how the run before it ended, worked out from what that
 * run left on the device: the last line it logged, and the place it kept
 * while playing (read, not taken: the launch still picks up from it). Either
 * the page was told it was going; or it was playing and ended without a word,
 * last known playing when and where it last kept its place, or else when and
 * where its last line had it unpaused; or it ended paused or with nothing
 * loaded. Records nothing at a first launch. Call it before this launch
 * records anything.
 */
export function recordLastRun(log: PlaybackLog, storage: DeviceStorage): void {
  const last = log.lines().at(-1)
  if (last === undefined) return
  const at = last.indexOf(' ')
  const words = last.slice(at + 1).split(' ')
  const place = keptPlace(storage)
  if (words[0] === 'page' && words[1] === 'going') log.record('last run closed with the page told')
  else if (place)
    log.record(
      `last run ended without a word: last known playing at ${stamp(new Date(place.at))}, episode ${place.episodeId} t=${place.positionSeconds.toFixed(1)}`,
    )
  else if (words.includes('unpaused'))
    log.record(
      `last run ended without a word: last known playing at ${last.slice(0, at)}, ${words.find((word) => word.startsWith('t=')) ?? 't=?'}`,
    )
  else log.record('last run ended paused or with nothing loaded')
}

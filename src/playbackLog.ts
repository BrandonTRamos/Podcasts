import type { PlaybackLog } from './services'

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

/**
 * Events that mean nothing by themselves when they repeat: a line for one that
 * directly follows another for the same episode is folded into it.
 */
const FOLDED_EVENTS = ['audio stalled']

/** TypeScript's DOM types lack the Audio Session API. */
export type AudioSession = EventTarget & { state?: string }

/** Safari's audio session, where the browser has one. */
export const browserAudioSession = (): AudioSession | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as { audioSession?: AudioSession }).audioSession

/**
 * A playback log of at most `LOG_LINES` lines, each stamped with the month,
 * day and time (UTC) to the millisecond. Every line is written to the store as
 * it is recorded, as iOS can suspend or kill the app at any moment.
 *
 * Each line ends with the episode loaded, as the player engine last told it
 * (`ep=<id>`, or `ep=none`), and, where the browser has an audio session, its
 * state as the line is written (`session=<state>`, or `session=unknown`).
 *
 * A line for one of `FOLDED_EVENTS` that directly follows another for the
 * same event and episode is not added: the line before gains a count and the
 * time of the latest (`x3 latest=<time>`).
 */
export function createPlaybackLog(
  store: TextStore,
  now: () => Date = () => new Date(),
  audioSession: () => Pick<AudioSession, 'state'> | undefined = browserAudioSession,
): PlaybackLog {
  let lines: string[] | null = null
  let episodeId: string | null = null
  /** The last line recorded, while it is for one of `FOLDED_EVENTS`: what it said, and how many it stands for. */
  let repeating: { event: string; episodeId: string | null; line: string; count: number } | null = null

  /** What each line ends with: the episode, and the audio session's state where there is one. */
  function context() {
    const session = audioSession()
    const ep = `ep=${episodeId ?? 'none'}`
    return session ? `${ep} session=${session.state || 'unknown'}` : ep
  }

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
      const stamp = now().toISOString().slice(5, 23)
      const event = FOLDED_EVENTS.find((folded) => line === folded || line.startsWith(`${folded} `))
      if (event && repeating && repeating.event === event && repeating.episodeId === episodeId) {
        repeating.count++
        all[all.length - 1] = `${repeating.line} x${repeating.count} latest=${stamp}`
      } else {
        all.push(`${stamp} ${line} ${context()}`)
        repeating = event ? { event, episodeId, line: all[all.length - 1], count: 1 } : null
        if (all.length > LOG_LINES) all.splice(0, all.length - LOG_LINES)
      }
      try {
        store.write(JSON.stringify(all))
      } catch {
        // No room or no storage: the log then lasts until the app closes.
      }
    },
    loaded(id) {
      episodeId = id
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

/**
 * Records what the audio element, the page and Safari's audio session do, for
 * the life of the app. Each line carries the element's state then:
 *
 * - `t`: its position in seconds
 * - `paused` or `unpaused`: what the element says, whatever is heard
 * - `ready`: `readyState`, from 0 (nothing loaded) to 4 (enough to play on)
 * - `net`: `networkState`: 1 idle, 2 loading, 3 no source
 * - `visible` or `hidden`: the page; hidden covers a locked phone
 * - `offline`: when the browser says so
 *
 * The log itself adds the episode and Safari's audio session (active,
 * interrupted or inactive), and a line when the session changes.
 *
 * `moving` is the first time the position advances after a `play`: without it,
 * the element said it was playing and went nowhere.
 */
export function recordPlayback(log: PlaybackLog, audio: HTMLMediaElement): void {
  const session = browserAudioSession()

  const state = () =>
    [
      `t=${audio.currentTime.toFixed(1)}`,
      audio.paused ? 'paused' : 'unpaused',
      `ready=${audio.readyState}`,
      `net=${audio.networkState}`,
      document.visibilityState,
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

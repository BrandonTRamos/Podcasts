import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { dragUnderway } from './holdToDrag'
import { RefreshIcon } from './Icons'

/** How far the finger must travel down before a pull counts as one, rather than a tap or a sideways swipe. */
const START_PX = 10
/** How far the screen must come down for letting go to refresh. */
export const PULL_THRESHOLD_PX = 70
/** Where the screen rests while refreshing: low enough to show the spinner above it. */
const REFRESHING_PX = 56
/** How far the screen could come down with an endless pull: it gives less the further it goes. */
const STRETCH_PX = 160
/** The least time the spinner spins, so a quick refresh still reads as one. */
const MIN_SPIN_MS = 600
/** How long a failed refresh's message stays up. */
const FAILURE_MS = 4000

type Phase = { name: 'idle' } | { name: 'pulling'; distance: number } | { name: 'refreshing' } | { name: 'failed' }

/** How far the screen comes down for the finger's travel: as a rubber band, giving less the further it is pulled. */
const stretched = (travel: number) => STRETCH_PX * (1 - 1 / ((travel * 0.8) / STRETCH_PX + 1))

/**
 * Pulling down from the top of the page, then letting go, refreshes, as in
 * any phone app: the whole screen (`children`) follows the finger down,
 * uncovering a spinner above it, and rests just below the spinner while
 * `onRefresh` runs, then slides back up. A pull not far enough springs back
 * with nothing done. A drag under way (of a podcast held to move it) or an
 * open dialog keeps the finger to itself, as does a screen not `enabled`.
 */
export function PullToRefresh({
  enabled,
  onRefresh,
  children,
}: {
  enabled: boolean
  onRefresh: () => Promise<void>
  children: ReactNode
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const latest = useRef({ enabled, onRefresh, phase })
  useEffect(() => {
    latest.current = { enabled, onRefresh, phase }
  })

  useEffect(() => {
    let touch: { startX: number; startY: number; pulling: boolean; distance: number } | null = null

    const atTop = () => window.scrollY <= 0
    const dialogOpen = () => document.querySelector('[aria-modal="true"]') !== null
    const busy = () => latest.current.phase.name === 'refreshing'

    const onStart = (event: TouchEvent) => {
      touch = null
      if (!latest.current.enabled || event.touches.length !== 1 || !atTop() || busy() || dragUnderway() || dialogOpen()) {
        return
      }
      const { clientX, clientY } = event.touches[0]
      touch = { startX: clientX, startY: clientY, pulling: false, distance: 0 }
    }

    // Never passive: iOS decides at the touch's start whether its moves can be
    // stopped from scrolling (and bouncing) the page, which the pull replaces.
    const onMove = (event: TouchEvent) => {
      if (!touch) return
      if (event.touches.length !== 1 || dragUnderway()) return cancel()
      const { clientX, clientY } = event.touches[0]
      const down = clientY - touch.startY
      if (!touch.pulling) {
        const across = Math.abs(clientX - touch.startX)
        // Scrolling up into the page, or swiping sideways, is not a pull.
        if (down < -START_PX || across > START_PX) {
          touch = null
          return
        }
        if (down < START_PX || !atTop()) return
        touch.pulling = true
      }
      if (event.cancelable) event.preventDefault()
      touch.distance = stretched(Math.max(0, down - START_PX))
      setPhase({ name: 'pulling', distance: touch.distance })
    }

    const onEnd = () => {
      const pulled = touch?.pulling ? touch.distance : 0
      touch = null
      if (pulled >= PULL_THRESHOLD_PX) void refresh()
      else if (pulled > 0) setPhase({ name: 'idle' })
    }

    function cancel() {
      const wasPulling = touch?.pulling
      touch = null
      if (wasPulling) setPhase({ name: 'idle' })
    }

    async function refresh() {
      setPhase({ name: 'refreshing' })
      const spun = new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS))
      try {
        await Promise.all([latest.current.onRefresh(), spun])
        setPhase({ name: 'idle' })
      } catch {
        await spun
        setPhase({ name: 'failed' })
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', cancel)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', cancel)
    }
  }, [])

  useEffect(() => {
    if (phase.name !== 'failed') return
    const timer = setTimeout(() => setPhase({ name: 'idle' }), FAILURE_MS)
    return () => clearTimeout(timer)
  }, [phase.name])

  const distance = phase.name === 'pulling' ? phase.distance : phase.name === 'refreshing' ? REFRESHING_PX : 0
  const style = {
    '--pull': `${distance}px`,
    '--pull-shown': Math.min(1, distance / PULL_THRESHOLD_PX),
    '--pull-turn': `${(distance / PULL_THRESHOLD_PX) * 270}deg`,
  } as CSSProperties
  const classes = ['pull-refresh', phase.name === 'pulling' && 'following', phase.name === 'refreshing' && 'refreshing']

  return (
    <div className={classes.filter(Boolean).join(' ')} style={style}>
      <div className="pull-refresh-spinner" aria-hidden="true">
        <RefreshIcon size={22} />
      </div>
      {phase.name === 'refreshing' && (
        <span className="visually-hidden" role="status">
          Refreshing…
        </span>
      )}
      {phase.name === 'failed' && (
        <p className="pull-refresh-failed" role="alert">
          Couldn’t refresh. Check your connection and try again.
        </p>
      )}
      {/* Moved by `top`, not a transform, which would pin the screen's fixed dialogs and sheets to it. */}
      <div className="pull-refresh-screen">{children}</div>
    </div>
  )
}

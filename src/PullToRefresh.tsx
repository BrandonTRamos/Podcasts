import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { dragUnderway } from './holdToDrag'
import { RefreshIcon } from './Icons'

/** How far the finger must travel down before a pull counts as one, rather than a tap or a sideways swipe. */
const START_PX = 10
/** How far the indicator must come down (after resistance) for letting go to refresh. */
export const PULL_THRESHOLD_PX = 72
/** The furthest the indicator comes down, however far the finger goes. */
const MAX_PULL_PX = 110
/** The least time the indicator spins, so a quick refresh still reads as one. */
const MIN_SPIN_MS = 600
/** How long a failed refresh's message stays up. */
const FAILURE_MS = 4000

type Phase = { name: 'idle' } | { name: 'pulling'; distance: number } | { name: 'refreshing' } | { name: 'failed' }

/** The finger's travel, slowed as it goes, so the indicator lags behind it like a stretched spring. */
const resisted = (travel: number) => Math.min(MAX_PULL_PX, travel * 0.55)

/**
 * Pulling down from the top of the page, then letting go, refreshes: an
 * indicator follows the finger down and spins while `onRefresh` runs. A pull
 * not far enough is let go of with nothing done. The page does not scroll
 * or bounce while pulled, and a drag under way (of a podcast held to move it)
 * or an open dialog keeps the finger to itself.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const latest = useRef({ onRefresh, phase })
  useEffect(() => {
    latest.current = { onRefresh, phase }
  })

  useEffect(() => {
    let touch: { startX: number; startY: number; pulling: boolean; distance: number } | null = null

    const atTop = () => window.scrollY <= 0
    const dialogOpen = () => document.querySelector('[aria-modal="true"]') !== null
    const busy = () => latest.current.phase.name === 'refreshing'

    const onStart = (event: TouchEvent) => {
      touch = null
      if (event.touches.length !== 1 || !atTop() || busy() || dragUnderway() || dialogOpen()) return
      const { clientX, clientY } = event.touches[0]
      touch = { startX: clientX, startY: clientY, pulling: false, distance: 0 }
    }

    // Never passive: iOS decides at the touch's start whether its moves can be
    // stopped from scrolling (and bouncing) the page.
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
      touch.distance = resisted(Math.max(0, down - START_PX))
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

  if (phase.name === 'failed') {
    return (
      <p className="pull-refresh-failed" role="alert">
        Couldn’t refresh. Check your connection and try again.
      </p>
    )
  }

  const distance = phase.name === 'pulling' ? phase.distance : phase.name === 'refreshing' ? PULL_THRESHOLD_PX : 0
  const armed = distance >= PULL_THRESHOLD_PX
  return (
    <div
      className={['pull-refresh', phase.name === 'pulling' && 'following', phase.name === 'refreshing' && 'refreshing', armed && 'armed']
        .filter(Boolean)
        .join(' ')}
      style={{ '--pull': `${distance}px`, '--pull-turn': `${(distance / PULL_THRESHOLD_PX) * 270}deg` } as CSSProperties}
      aria-hidden={phase.name !== 'refreshing'}
    >
      <span className="pull-refresh-spinner">
        <RefreshIcon size={20} />
      </span>
      {phase.name === 'refreshing' && (
        <span className="visually-hidden" role="status">
          Refreshing…
        </span>
      )}
    </div>
  )
}

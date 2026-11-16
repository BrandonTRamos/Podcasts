import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react'

/** How long a press must last to count as held. */
export const LONG_PRESS_MS = 500
/** How long after letting go of a hold its click may still arrive: a touch's follows its release by a little. */
const LATE_CLICK_MS = 600

/**
 * Press and hold a button to do something other than click it. Once held, the
 * click that letting go would send is swallowed wherever it lands, so it can't
 * press whatever the hold has put under the finger. A right click, or the
 * long-press menu a browser offers, holds it at once.
 *
 * Returns the props to spread on the button.
 */
export function useLongPress(onHold: () => void) {
  const latest = useRef(onHold)
  const timer = useRef<number | undefined>(undefined)
  /** The press under way has already been held. */
  const held = useRef(false)

  useEffect(() => {
    latest.current = onHold
  })
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const cancel = () => window.clearTimeout(timer.current)

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      held.current = false
      cancel()
      if (event.button > 0) return
      timer.current = window.setTimeout(() => {
        held.current = true
        swallowReleaseClick()
        navigator.vibrate?.(10)
        latest.current()
      }, LONG_PRESS_MS)
    },
    onPointerUp() {
      cancel()
      held.current = false
    },
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      event.preventDefault()
      cancel()
      // A browser that opens its menu on a long touch may do so after the timer has held it.
      if (held.current) return
      held.current = true
      latest.current()
    },
  }
}

/** Swallows the click a held press sends when let go, which lands wherever the finger then is. */
function swallowReleaseClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const released = () => {
    window.removeEventListener('pointerup', released, true)
    window.removeEventListener('pointercancel', released, true)
    window.setTimeout(() => window.removeEventListener('click', swallow, true), LATE_CLICK_MS)
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.addEventListener('pointerup', released, true)
  window.addEventListener('pointercancel', released, true)
}

import { type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent, useEffect, useRef } from 'react'

export interface Point {
  x: number
  y: number
}

/** What a drag tells its owner, as it goes. */
export interface DragHandlers {
  /** The hold was long enough: the drag starts on the element held. */
  start(id: string, element: HTMLElement, point: Point): void
  move(point: Point): void
  /** The finger (or mouse button) lifted, or the system took the touch away (`dropped` false). */
  end(dropped: boolean): void
}

/** How long a press must last to pick something up. */
export const HOLD_MS = 400
/** How far a finger may stray while holding before it counts as scrolling instead. */
const SLOP_PX = 8

/** How many drags are under way on the page: other gestures, such as pulling to refresh, leave the finger to them. */
let dragsUnderway = 0

/** Whether something held is being dragged, anywhere on the page. */
export const dragUnderway = () => dragsUnderway > 0

/**
 * Press and hold to pick something up, then drag it. A press that moves first
 * is left to scroll the page, and a short one to click. Once picked up, the
 * page stops scrolling under the finger, and the click that would follow
 * letting go is swallowed.
 *
 * Returns the props to spread on each draggable element, given its ID.
 */
export function useHoldToDrag(handlers: DragHandlers) {
  const latest = useRef(handlers)
  const dragging = useRef(false)
  const cancelPending = useRef<(() => void) | null>(null)
  /** When a touch last began: the mouse events a browser makes up from a tap follow it, and are not a press of their own. */
  const lastTouch = useRef(-Infinity)

  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    // Always there, and never passive: iOS decides at the touch's start whether
    // its moves can be stopped from scrolling the page.
    const holdPage = (event: TouchEvent) => {
      if (dragging.current) event.preventDefault()
    }
    window.addEventListener('touchmove', holdPage, { passive: false })
    return () => {
      window.removeEventListener('touchmove', holdPage)
      cancelPending.current?.()
    }
  }, [])

  function press(id: string, element: HTMLElement, from: Point, kind: 'touch' | 'mouse') {
    cancelPending.current?.()
    let at = from
    const moveEvent = kind === 'touch' ? 'touchmove' : 'mousemove'
    const endEvent = kind === 'touch' ? 'touchend' : 'mouseup'

    const pointOf = (event: TouchEvent | MouseEvent): Point | null => {
      if (!('touches' in event)) return { x: event.clientX, y: event.clientY }
      const touch = event.touches[0] ?? event.changedTouches[0]
      return touch ? { x: touch.clientX, y: touch.clientY } : null
    }

    const onMove = (event: TouchEvent | MouseEvent) => {
      const point = pointOf(event)
      if (!point) return
      at = point
      if (dragging.current) latest.current.move(point)
      else if (Math.hypot(point.x - from.x, point.y - from.y) > SLOP_PX) stop()
    }
    const onEnd = (event: TouchEvent | MouseEvent) => {
      if (dragging.current) {
        // A touch let go here would otherwise click what it was held on.
        if (event.cancelable) event.preventDefault()
        swallowNextClick()
        finish(true)
      } else stop()
    }
    const onCancel = () => (dragging.current ? finish(false) : stop())

    const timer = window.setTimeout(() => {
      dragging.current = true
      dragsUnderway++
      window.removeEventListener('scroll', stop, true)
      navigator.vibrate?.(10)
      latest.current.start(id, element, at)
    }, HOLD_MS)

    function stop() {
      window.clearTimeout(timer)
      window.removeEventListener(moveEvent, onMove)
      window.removeEventListener(endEvent, onEnd)
      window.removeEventListener('touchcancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('scroll', stop, true)
      cancelPending.current = null
    }
    function finish(dropped: boolean) {
      stop()
      dragging.current = false
      dragsUnderway--
      latest.current.end(dropped)
    }

    window.addEventListener(moveEvent, onMove, { passive: kind === 'mouse' })
    window.addEventListener(endEvent, onEnd)
    window.addEventListener('touchcancel', onCancel)
    window.addEventListener('blur', onCancel)
    // The page scrolling while held means the press was a scroll.
    window.addEventListener('scroll', stop, true)
    cancelPending.current = () => (dragging.current ? finish(false) : stop())
  }

  return (id: string) => ({
    onTouchStart(event: ReactTouchEvent<HTMLElement>) {
      if (event.touches.length !== 1) return cancelPending.current?.()
      lastTouch.current = event.timeStamp
      const touch = event.touches[0]
      press(id, event.currentTarget, { x: touch.clientX, y: touch.clientY }, 'touch')
    },
    onMouseDown(event: ReactMouseEvent<HTMLElement>) {
      if (event.button !== 0 || event.timeStamp - lastTouch.current < 1000) return
      press(id, event.currentTarget, { x: event.clientX, y: event.clientY }, 'mouse')
    },
    // A long press would otherwise open the browser's menu for the link or image.
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      event.preventDefault()
    },
  })
}

/**
 * Swallows the click a mouse button let go on what it was held on sends, which
 * follows the release at once. (A touch's is stopped by stopping its end.)
 */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

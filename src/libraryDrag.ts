import { useEffect, useRef, useState } from 'react'
import { type Point, useHoldToDrag } from './holdToDrag'
import type { Podcast } from './services'

/** Where a dragged podcast would land: a section of the library, and its place in that section's list. */
export interface DropTarget {
  section: string
  /** Counted in the section's list with the dragged podcast left out. */
  index: number
}

/** A podcast being dragged through the library. */
export interface LibraryDrag {
  podcast: Podcast
  /** The section it was picked up from. */
  from: string
  point: Point
  /** Where on the row it was held, from the row's top left. */
  grab: Point
  left: number
  width: number
  height: number
  target: DropTarget | null
}

/** How long a podcast held over a closed section's heading takes to open it. */
const OPEN_AFTER_MS = 700
/** How close to the screen's top, or to the tab bar, a drag scrolls the page. */
const EDGE_PX = 72
const TAB_BAR_PX = 96

/**
 * Press and hold a podcast in the library to drag it to another place in its
 * list, or into another section. Rows mark themselves as places to drop with
 * `data-drop="row"` (with `data-section` and `data-index`), and headings with
 * `data-drop="heading"`, which put it first in that section. Held over a
 * closed section's heading a moment, the section opens. Near the top or the
 * bottom, the page scrolls.
 */
export function useLibraryDrag({
  podcastOf,
  isOpen,
  onOpenSection,
  onDrop,
}: {
  /** The podcast with this ID, and its section's key. */
  podcastOf: (podcastId: string) => { podcast: Podcast; section: string } | undefined
  isOpen: (section: string) => boolean
  onOpenSection: (section: string) => void
  onDrop: (podcast: Podcast, from: string, target: DropTarget) => void
}) {
  const [drag, setDrag] = useState<LibraryDrag | null>(null)
  const current = useRef<LibraryDrag | null>(null)
  const latest = useRef({ onOpenSection, onDrop })

  useEffect(() => {
    latest.current = { onOpenSection, onDrop }
  })

  function update(change: Partial<LibraryDrag> | null) {
    current.current = change && current.current ? { ...current.current, ...change } : null
    setDrag(current.current)
  }

  const bind = useHoldToDrag({
    start(podcastId, element, point) {
      const found = podcastOf(podcastId)
      if (!found) return
      const rect = element.getBoundingClientRect()
      current.current = {
        podcast: found.podcast,
        from: found.section,
        point,
        grab: { x: point.x - rect.left, y: point.y - rect.top },
        left: rect.left,
        width: rect.width,
        height: rect.height,
        target: { section: found.section, index: Number(element.dataset.index ?? 0) },
      }
      setDrag(current.current)
    },
    move(point) {
      if (!current.current) return
      update({ point, target: targetAt(point, current.current.target) })
    },
    end(dropped) {
      const ended = current.current
      update(null)
      if (dropped && ended?.target) latest.current.onDrop(ended.podcast, ended.from, ended.target)
    },
  })

  const dragging = drag !== null

  // Near the top, or the tab bar, the page scrolls, and what is under the finger changes with it.
  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function scroll() {
      const now = current.current
      if (now) {
        const bottom = window.innerHeight - TAB_BAR_PX - EDGE_PX
        const by = now.point.y < EDGE_PX ? now.point.y - EDGE_PX : now.point.y > bottom ? now.point.y - bottom : 0
        if (by !== 0) {
          window.scrollBy(0, Math.max(-16, Math.min(16, by / 4)))
          update({ target: targetAt(now.point, now.target) })
        }
      }
      frame = requestAnimationFrame(scroll)
    })
    return () => cancelAnimationFrame(frame)
  }, [dragging])

  // Held over a closed section's heading, the section opens, to place it among the section's podcasts.
  const over = drag?.target && drag.target.index === 0 && !isOpen(drag.target.section) ? drag.target.section : null
  useEffect(() => {
    if (over === null) return
    const timer = window.setTimeout(() => latest.current.onOpenSection(over), OPEN_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [over])

  return { drag, bind }
}

/** What would be dropped on under the point: the target there, or the one before if nothing new is under it. */
function targetAt(point: Point, before: DropTarget | null): DropTarget | null {
  const element = document.elementFromPoint?.(point.x, point.y)?.closest<HTMLElement>('[data-drop]')
  const section = element?.dataset.section
  if (!element || section === undefined) return before
  if (element.dataset.drop === 'heading') return { section, index: 0 }
  if (element.dataset.drop === 'row') {
    const rect = element.getBoundingClientRect()
    const index = Number(element.dataset.index)
    return { section, index: point.y < rect.top + rect.height / 2 ? index : index + 1 }
  }
  return before
}

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** The row it was picked up from: its `data-flip` key, which a podcast shown twice (as a favorite) has one of per row. */
  row: string
  /** Where it was picked up from. */
  origin: DropTarget
  /** Where on the row it was held, from the row's top. */
  grabY: number
  left: number
  width: number
  height: number
  target: DropTarget
  /** Let go: it is gliding into its place. */
  settling: boolean
}

/** How long a podcast held over a closed section's heading takes to open it. */
const OPEN_AFTER_MS = 700
/** How close to the screen's top, or to the tab bar, a drag scrolls the page. */
const EDGE_PX = 72
const TAB_BAR_PX = 96
const SLIDE = { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }

/** A place to drop, measured where the page lays it out (in page coordinates, unmoved by animation). */
interface Zone {
  kind: string
  section: string
  index: number
  top: number
  bottom: number
}

/**
 * Press and hold a podcast in the library to drag it to another place in its
 * list, or into another section. Rows mark themselves as places to drop with
 * `data-drop="row"` (with `data-section` and `data-index`), headings with
 * `data-drop="heading"`, which put it first in that section, and the gap it
 * would fill with `data-drop="gap"`. Whatever should slide when the gap moves
 * carries `data-flip` (a key unique in the library), a section's tray and the
 * rows in it alike; a podcast's row is bound, and keyed, by the same key.
 *
 * The lifted podcast follows the finger without React rendering; the library
 * renders only when where it would land changes, and everything that moves
 * then slides there. Let go, it glides into its place before the move is made.
 * Held over a closed section's heading a moment, the section opens. Near the
 * top or the bottom, the page scrolls. A podcast drops only in the sections
 * `accepts` allows for the one it came from.
 */
export function useLibraryDrag({
  container,
  podcastOf,
  accepts = () => true,
  isOpen,
  onOpenSection,
  onDrop,
}: {
  container: RefObject<HTMLElement | null>
  /** The podcast in the row with this key, and its section's key. */
  podcastOf: (row: string) => { podcast: Podcast; section: string } | undefined
  /** Whether a podcast from section `from` may drop in section `to`. */
  accepts?: (from: string, to: string) => boolean
  isOpen: (section: string) => boolean
  onOpenSection: (section: string) => void
  onDrop: (podcast: Podcast, from: string, target: DropTarget) => void
}) {
  const [drag, setDrag] = useState<LibraryDrag | null>(null)
  const current = useRef<LibraryDrag | null>(null)
  const point = useRef<Point>({ x: 0, y: 0 })
  const ghost = useRef<HTMLDivElement>(null)
  const zones = useRef<Zone[]>([])
  /** Where everything that slides showed before the render about to happen, to slide from. */
  const before = useRef<Map<string, number> | null>(null)
  /** Whether the lifted card is gliding into place, let go. */
  const gliding = useRef(false)
  const latest = useRef({ onOpenSection, onDrop, retarget: () => {} })

  function set(next: LibraryDrag | null) {
    current.current = next
    setDrag(next)
  }

  function placeGhost() {
    const now = current.current
    if (ghost.current && now && !now.settling) {
      ghost.current.style.transform = `translate3d(${now.left}px, ${point.current.y - now.grabY}px, 0)`
    }
  }

  function retarget() {
    const now = current.current
    if (!now || now.settling) return
    const allowed = zones.current.filter((zone) => accepts(now.origin.section, zone.section))
    const target = targetAt(allowed, point.current.y + window.scrollY) ?? now.target
    if (target.section === now.target.section && target.index === now.target.index) return
    before.current = positions(container.current)
    set({ ...now, target })
  }

  /** The move is made, and the podcast shows in its place, sliding from where the lifted card left it. */
  function finish() {
    const now = current.current
    if (!now) return
    gliding.current = false
    before.current = positions(container.current, { [now.row]: 'gap' })
    set(null)
    const { origin, target } = now
    if (origin.section !== target.section || origin.index !== target.index) {
      latest.current.onDrop(now.podcast, origin.section, target)
    }
  }

  useEffect(() => {
    latest.current = { onOpenSection, onDrop, retarget }
  })

  const bind = useHoldToDrag({
    start(row, element, at) {
      const found = podcastOf(row)
      if (!found || current.current) return
      const rect = element.getBoundingClientRect()
      const origin = { section: found.section, index: Number(element.dataset.index ?? 0) }
      point.current = at
      set({
        podcast: found.podcast,
        row,
        origin,
        grabY: at.y - rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        target: origin,
        settling: false,
      })
    },
    move(at) {
      point.current = at
      placeGhost()
      retarget()
    },
    end(dropped) {
      const now = current.current
      if (!now || now.settling) return
      before.current = positions(container.current)
      set({ ...now, target: dropped ? now.target : now.origin, settling: true })
    },
  })

  // After each render while dragging: slide what moved, measure where to drop, and when let go, glide into place.
  useLayoutEffect(() => {
    const root = container.current
    const first = before.current
    before.current = null
    const now = current.current
    if (!root || (!first && !now)) return
    const last = layout(root)
    if (first && animates()) {
      const tops = new Map(last.flips)
      for (const [element, top] of last.flips) {
        const from = first.get(element.dataset.flip!)
        if (from === undefined) continue
        // What it sits in (a row in its section) carries it as that slides: it slides only the rest of its way.
        const holder = element.parentElement?.closest<HTMLElement>('[data-flip]')
        const holderFrom = holder ? first.get(holder.dataset.flip!) : undefined
        const carried = holder && holderFrom !== undefined ? holderFrom - tops.get(holder)! : 0
        const by = from - top - carried
        if (Math.abs(by) < 0.5) continue
        element.animate([{ transform: `translateY(${by}px)` }, { transform: 'none' }], SLIDE)
      }
    }
    if (!now) return
    zones.current = last.zones
    placeGhost()
    if (now.settling && !gliding.current) {
      gliding.current = true
      settle(root, now, ghost.current, finish)
    }
  })

  const dragging = drag !== null && !drag.settling

  // Near the top, or the tab bar, the page scrolls, and what is under the finger changes with it.
  useEffect(() => {
    if (!dragging) return
    let frame = requestAnimationFrame(function scroll() {
      const { y } = point.current
      const bottom = window.innerHeight - TAB_BAR_PX - EDGE_PX
      const by = y < EDGE_PX ? y - EDGE_PX : y > bottom ? y - bottom : 0
      if (by !== 0) {
        window.scrollBy(0, Math.max(-14, Math.min(14, by / 5)))
        latest.current.retarget()
      }
      frame = requestAnimationFrame(scroll)
    })
    return () => cancelAnimationFrame(frame)
  }, [dragging])

  // Held over a closed section's heading, the section opens, to place it among the section's podcasts.
  const over =
    dragging && drag.target.index === 0 && drag.target.section !== drag.origin.section && !isOpen(drag.target.section)
      ? drag.target.section
      : null
  useEffect(() => {
    if (over === null) return
    const timer = window.setTimeout(() => latest.current.onOpenSection(over), OPEN_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [over])

  return { drag, bind, ghost }
}

/** Whether to animate: the browser can, and the listener hasn't asked for less motion. */
function animates(): boolean {
  return typeof Element.prototype.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Where each thing that slides shows now, animation included, by its `data-flip` key; `alias` takes another's place. */
function positions(root: HTMLElement | null, alias: Record<string, string> = {}): Map<string, number> {
  const shown = new Map<string, number>()
  if (!root) return shown
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'))) {
    const rect = element.getBoundingClientRect()
    if (rect.height > 0) shown.set(element.dataset.flip!, rect.top + window.scrollY)
  }
  for (const [key, as] of Object.entries(alias)) {
    const top = shown.get(as)
    if (top !== undefined) shown.set(key, top)
  }
  return shown
}

/**
 * Where everything lies once laid out, with any slide still going stopped: what
 * slides, and the places to drop.
 */
function layout(root: HTMLElement): { flips: [HTMLElement, number][]; zones: Zone[] } {
  const sliding = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'))
  for (const element of sliding) for (const animation of element.getAnimations?.() ?? []) animation.cancel()
  const flips: [HTMLElement, number][] = []
  for (const element of sliding) flips.push([element, element.getBoundingClientRect().top + window.scrollY])
  const zones: Zone[] = []
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-drop]'))) {
    const rect = element.getBoundingClientRect()
    if (rect.height === 0) continue
    zones.push({
      kind: element.dataset.drop!,
      section: element.dataset.section ?? '',
      index: Number(element.dataset.index ?? 0),
      top: rect.top + window.scrollY,
      bottom: rect.bottom + window.scrollY,
    })
  }
  return { flips, zones }
}

/** Where it would be dropped with the finger at `y` (in page coordinates), or null if nowhere new. */
function targetAt(zones: Zone[], y: number): DropTarget | null {
  const zone = zones.find((z) => y >= z.top && y < z.bottom)
  if (!zone) return null
  if (zone.kind === 'heading') return { section: zone.section, index: 0 }
  if (zone.kind === 'row') return { section: zone.section, index: y < (zone.top + zone.bottom) / 2 ? zone.index : zone.index + 1 }
  return null
}

/**
 * Glides the lifted card into the gap it leaves for itself, or into the
 * closed section's heading it was let go on, then finishes the drag.
 */
function settle(root: HTMLElement, drag: LibraryDrag, card: HTMLElement | null, finish: () => void) {
  const gap = root.querySelector<HTMLElement>('[data-drop="gap"]')
  const heading = Array.from(root.querySelectorAll<HTMLElement>('[data-drop="heading"]')).find(
    (element) => element.dataset.section === drag.target.section,
  )
  const into = gap ?? heading
  if (!card || !into || !animates()) return finish()
  const rect = into.getBoundingClientRect()
  const lands = gap !== null
  const glide = card.animate(
    [
      { transform: card.style.transform, opacity: 1 },
      {
        transform: `translate3d(${drag.left}px, ${lands ? rect.top : rect.top + rect.height / 2 - drag.height / 2}px, 0) scale(${lands ? 1 : 0.85})`,
        opacity: lands ? 1 : 0,
      },
    ],
    { ...SLIDE, duration: 200, fill: 'forwards' },
  )
  card.firstElementChild?.animate([{}, { transform: 'none', boxShadow: 'none' }], { ...SLIDE, duration: 200, fill: 'forwards' })
  glide.onfinish = finish
  glide.oncancel = finish
}

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { MoreIcon } from './Icons'

/**
 * A button that shows the actions given, in a panel beside it. Choosing one
 * closes the panel, as do Escape and a tap anywhere else.
 */
export function MoreActions({ children, label = 'More actions' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Clear of the bars at the foot of the screen, which would otherwise cover the last rows' actions.
    panel.current?.scrollIntoView?.({ block: 'nearest' })
    const closeOnOutsideTap = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideTap)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideTap)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="more-actions" ref={container}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon size={22} />
      </button>
      {open && (
        <div
          className="more-actions-panel"
          role="group"
          aria-label={label}
          ref={panel}
          onClick={(event) => {
            if ((event.target as Element).closest('button')) setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

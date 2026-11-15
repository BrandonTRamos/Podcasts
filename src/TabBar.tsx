import type { ReactNode } from 'react'
import { DownloadIcon, LatestIcon, LibraryIcon, QueueIcon, SearchIcon } from './Icons'

/** The app's top-level sections, each a tab. */
export type Tab = 'library' | 'latest' | 'queue' | 'downloads' | 'search'

const tabs: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'library', label: 'Library', icon: <LibraryIcon size={24} /> },
  { tab: 'latest', label: 'Latest', icon: <LatestIcon size={24} /> },
  { tab: 'queue', label: 'Queue', icon: <QueueIcon size={24} /> },
  { tab: 'downloads', label: 'Downloads', icon: <DownloadIcon size={24} /> },
  { tab: 'search', label: 'Search', icon: <SearchIcon size={24} /> },
]

/** Stays at the foot of every screen but now playing, and leads to each section in one tap. */
export function TabBar({ current, onSelect }: { current: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav className="tab-bar" aria-label="Sections">
      {tabs.map(({ tab, label, icon }) => (
        <button key={tab} type="button" aria-current={tab === current ? 'page' : undefined} onClick={() => onSelect(tab)}>
          {icon}
          {label}
        </button>
      ))}
    </nav>
  )
}

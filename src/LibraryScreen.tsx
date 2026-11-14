import { useEffect, useState } from 'react'
import type { DataApi, Podcast } from './services'

type Library = { status: 'loading' } | { status: 'failed' } | { status: 'loaded'; podcasts: Podcast[] }

export function LibraryScreen({ data, onSignOut }: { data: DataApi; onSignOut: () => void }) {
  const [library, setLibrary] = useState<Library>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    data.listPodcasts().then(
      (podcasts) => !cancelled && setLibrary({ status: 'loaded', podcasts }),
      () => !cancelled && setLibrary({ status: 'failed' }),
    )
    return () => {
      cancelled = true
    }
  }, [data])

  return (
    <main className="library">
      <header>
        <h1>Library</h1>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>
      {library.status === 'loading' && <p>Loading…</p>}
      {library.status === 'failed' && <p role="alert">Couldn’t load your library.</p>}
      {library.status === 'loaded' &&
        (library.podcasts.length === 0 ? (
          <p>No podcasts yet.</p>
        ) : (
          <ul>
            {library.podcasts.map((podcast) => (
              <li key={podcast.id}>{podcast.title}</li>
            ))}
          </ul>
        ))}
    </main>
  )
}

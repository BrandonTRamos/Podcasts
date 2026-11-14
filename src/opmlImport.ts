import { useCallback, useEffect, useRef, useState } from 'react'
import { type OpmlFeed, parseOpml } from './opml'
import type { DataApi } from './services'
import { subscribeAndSettle } from './subscribing'

/** Feeds being subscribed to at once. The backend ingests a few at a time, so more would only wait. */
const IMPORT_CONCURRENCY = 4

/**
 * How long one feed may take to check before it counts as failed, so a
 * request the backend never settles cannot keep the import from finishing.
 * Well past the ingest function's own time limit.
 */
export const FEED_DEADLINE_MS = 10 * 60_000

/** Larger files are refused unread. A real export of hundreds of podcasts is well under 1 MB. */
export const MAX_OPML_BYTES = 5 * 1024 * 1024

/** How one feed of an import ended. */
export type ImportOutcome = 'added' | 'skipped' | 'failed'

/** One feed of an import, in the file's order; its outcome is null while still to do or under way. */
interface ImportResult {
  feed: OpmlFeed
  outcome: ImportOutcome | null
}

export type ImportState =
  | { status: 'idle' | 'reading' | 'tooLarge' | 'invalid' | 'empty' }
  | { status: 'importing' | 'finished'; results: ImportResult[] }

const outcomeOf: Record<Awaited<ReturnType<typeof subscribeAndSettle>>['status'], ImportOutcome> = {
  subscribed: 'added',
  alreadySubscribed: 'skipped',
  invalidUrl: 'failed',
  unreachable: 'failed',
  notAFeed: 'failed',
  failed: 'failed',
  offline: 'failed',
  lost: 'failed',
}

/**
 * Imports an OPML file: subscribes to every feed in it, a few at a time, so a
 * long file neither holds up the app nor floods the backend. Podcasts join the
 * library as each is added, through the usual data subscriptions. One import
 * at a time; it runs for as long as the calling component is mounted.
 */
export function useOpmlImport(data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>) {
  const [state, setState] = useState<ImportState>({ status: 'idle' })
  const running = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const importFile = useCallback(
    async (file: File) => {
      if (running.current) return
      running.current = true
      try {
        if (file.size > MAX_OPML_BYTES) return setState({ status: 'tooLarge' })
        setState({ status: 'reading' })
        let feeds: OpmlFeed[] | null
        try {
          feeds = parseOpml(await file.text())
        } catch {
          feeds = null
        }
        if (!feeds) return setState({ status: 'invalid' })
        if (feeds.length === 0) return setState({ status: 'empty' })

        const results: ImportResult[] = feeds.map((feed) => ({ feed, outcome: null }))
        const report = (status: 'importing' | 'finished') =>
          setState({ status, results: results.map((result) => ({ ...result })) })
        report('importing')
        let next = 0
        async function worker() {
          while (next < results.length && mounted.current) {
            const result = results[next++]
            const { status } = await subscribeAndSettle(data, result.feed.feedUrl, { deadlineMs: FEED_DEADLINE_MS })
            result.outcome = outcomeOf[status]
            report('importing')
          }
        }
        await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker))
        report('finished')
      } finally {
        running.current = false
      }
    },
    [data],
  )

  return { state, importFile }
}

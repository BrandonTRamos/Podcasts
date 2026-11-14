import { useCallback, useEffect, useState } from 'react'
import type { DataApi, SubscribeRequestState } from './services'

/** Where a subscribe stands. */
export type SubscribeState =
  | SubscribeRequestState
  /** The subscribe call itself failed. */
  | { status: 'offline' }
  /** Watching the background check failed, so its outcome is unknown. */
  | { status: 'lost' }

/** The ways a subscribe can fail, each shown with its own message. */
export type SubscribeFailure = Exclude<SubscribeState['status'], 'pending' | 'subscribed' | 'alreadySubscribed'>

/** The failure message for the state, if it is a failure. */
export function failureMessage(state: SubscribeState | null, messages: Record<SubscribeFailure, string>): string | null {
  return state && state.status in messages ? messages[state.status as SubscribeFailure] : null
}

/**
 * One subscribe at a time, by feed URL: sends it, then follows the background
 * check until it settles. `state` is null before the first, and `busy` is
 * true from sending until the outcome is known.
 */
export function useSubscribe(data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>) {
  const [sending, setSending] = useState(false)
  /** The subscribe request whose background check is under way. */
  const [requestId, setRequestId] = useState<string | null>(null)
  const [state, setState] = useState<SubscribeState | null>(null)

  useEffect(() => {
    if (!requestId) return
    return data.observeSubscribeRequest(requestId, {
      next(next) {
        setState(next)
        if (next.status !== 'pending') setRequestId(null)
      },
      error() {
        setState({ status: 'lost' })
        setRequestId(null)
      },
    })
  }, [data, requestId])

  const subscribe = useCallback(
    async (input: string) => {
      setState(null)
      const feedUrl = input.trim()
      if (!isHttpUrl(feedUrl)) {
        setState({ status: 'invalidUrl' })
        return
      }

      setSending(true)
      try {
        const result = await data.subscribeToFeed(feedUrl)
        if (result.outcome === 'pending') {
          setState({ status: 'pending' })
          setRequestId(result.requestId)
        } else if (result.outcome === 'alreadySubscribed') {
          setState({ status: 'alreadySubscribed', podcastId: result.podcastId })
        } else {
          setState({ status: 'invalidUrl' })
        }
      } catch {
        setState({ status: 'offline' })
      } finally {
        setSending(false)
      }
    },
    [data],
  )

  return { state, busy: sending || state?.status === 'pending', subscribe }
}

/**
 * Subscribes to the feed and waits for the background check to settle.
 * Resolves with how it ended; never rejects. A check that has not settled
 * after `deadlineMs` counts as `lost`: its outcome is unknown.
 */
export async function subscribeAndSettle(
  data: Pick<DataApi, 'subscribeToFeed' | 'observeSubscribeRequest'>,
  input: string,
  { deadlineMs }: { deadlineMs: number },
): Promise<Exclude<SubscribeState, { status: 'pending' }>> {
  const feedUrl = input.trim()
  if (!isHttpUrl(feedUrl)) return { status: 'invalidUrl' }
  let result
  try {
    result = await data.subscribeToFeed(feedUrl)
  } catch {
    return { status: 'offline' }
  }
  if (result.outcome === 'alreadySubscribed') return { status: 'alreadySubscribed', podcastId: result.podcastId }
  if (result.outcome === 'invalidUrl') return { status: 'invalidUrl' }
  const { requestId } = result
  return new Promise((resolve) => {
    let settled = false
    let stop: (() => void) | null = null
    const settle = (state: Exclude<SubscribeState, { status: 'pending' }>) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      stop?.()
      resolve(state)
    }
    const deadline = setTimeout(() => settle({ status: 'lost' }), deadlineMs)
    stop = data.observeSubscribeRequest(requestId, {
      next: (state) => {
        if (state.status !== 'pending') settle(state)
      },
      error: () => settle({ status: 'lost' }),
    })
    // It may have settled before the call returned.
    if (settled) stop()
  })
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

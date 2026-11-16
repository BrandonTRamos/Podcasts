import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserDevice } from './device'

const page = (script: string) => `<!doctype html><html><head><script type="module" crossorigin src="${script}"></script></head><body></body></html>`

function runningPage(script: string) {
  document.head.innerHTML = `<script type="module" crossorigin src="${script}"></script>`
}

function serverPage(script: string) {
  const fetch = vi.fn(async () => new Response(page(script)))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
})

describe('watching for a new version', () => {
  it('says so when the deployed page loads different scripts from the running one', async () => {
    runningPage('/assets/index-old.js')
    const fetch = serverPage('/assets/index-new.js')
    const listener = vi.fn()

    const stop = browserDevice().watchForNewVersion(listener)

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledWith('/', { cache: 'no-store' })
    stop()
  })

  it('stays quiet while the deployed page is the running one', async () => {
    runningPage('/assets/index-same.js')
    const fetch = serverPage('/assets/index-same.js')
    const listener = vi.fn()

    const stop = browserDevice().watchForNewVersion(listener)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(listener).not.toHaveBeenCalled()
    stop()
  })

  it('looks again when the app comes back to the foreground', async () => {
    runningPage('/assets/index-old.js')
    const fetch = serverPage('/assets/index-old.js')
    const listener = vi.fn()
    const stop = browserDevice().watchForNewVersion(listener)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    serverPage('/assets/index-new.js')
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    stop()
  })
})

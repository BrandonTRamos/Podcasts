import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AppShell,
  PAGE_TIMEOUT_MS,
  serveAppShell,
  type ShellEvent,
  type ShellFetchEvent,
  type ShellRequest,
  type WorkerScope,
} from './appShell'

const origin = 'https://tincan.example'

/** The site as deployed: each version's files, by path. */
function site(version: string) {
  return new Map([
    ['/index.html', `<html>TinCan ${version}</html>`],
    [`/assets/index-${version}.js`, `console.log('${version}')`],
    ['/icon-192.png', 'png'],
  ])
}

const shellOf = (version: string): AppShell => ({ version, files: [...site(version).keys()] })

/** In-memory stand-in for the browser's Cache Storage, which outlives any one worker. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, Response>>()
  readonly fetch: (path: string) => Promise<Response>

  constructor(fetch: (path: string) => Promise<Response>) {
    this.fetch = fetch
  }

  async open(name: string) {
    const store = this.stores.get(name) ?? new Map<string, Response>()
    this.stores.set(name, store)
    return {
      addAll: async (paths: string[]) => {
        for (const path of paths) store.set(path, await this.fetch(path))
      },
      match: async (path: string) => store.get(path)?.clone(),
    } as unknown as Cache
  }

  async keys() {
    return [...this.stores.keys()]
  }

  async delete(name: string) {
    return this.stores.delete(name)
  }
}

/**
 * A browser with the site deployed at some version, reachable until it goes
 * offline. Installing a version runs its worker's install and activate, as a
 * browser does on first visit and after each deploy.
 */
function browser() {
  let deployed = site('v1')
  let online = true
  /** Ends the wait of every request the network is sitting on; null while it answers at once. */
  let stalled: Promise<void> | null = null
  const fetchPath = async (path: string) => {
    if (stalled) await stalled
    if (!online) throw new TypeError('Failed to fetch')
    // The host serves the page at the site root.
    const body = deployed.get(path === '/' ? '/index.html' : path)
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
  }
  const caches = new FakeCaches(fetchPath)
  type Listeners = {
    install: ((event: ShellEvent) => void)[]
    activate: ((event: ShellEvent) => void)[]
    fetch: ((event: ShellFetchEvent) => void)[]
  }
  let worker: Listeners | null = null

  return {
    /** How many copies of the file the browser holds, in any of the site's caches. */
    async storedCopiesOf(path: string) {
      let copies = 0
      for (const name of await caches.keys()) if (await (await caches.open(name)).match(path)) copies++
      return copies
    },
    deploy(version: string) {
      deployed = site(version)
    },
    goOffline() {
      online = false
    },
    /**
     * The network stops answering, without failing: requests just wait, as on
     * a phone not long awake. Returns a function that lets them through.
     */
    stall() {
      let release = () => {}
      stalled = new Promise((resolve) => (release = resolve))
      return () => {
        stalled = null
        release()
      }
    },
    async install(shell: AppShell) {
      const listeners: Listeners = { install: [], activate: [], fetch: [] }
      const scope: WorkerScope = {
        addEventListener: (type: 'install' | 'activate' | 'fetch', listener: never) => listeners[type].push(listener),
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
        caches,
        location: { origin },
        fetch: (request: ShellRequest | string) =>
          fetchPath(new URL(typeof request === 'string' ? request : request.url, origin).pathname),
      }
      serveAppShell(scope, shell)
      for (const phase of ['install', 'activate'] as const) {
        const waits: Promise<unknown>[] = []
        listeners[phase].forEach((listener) => listener({ waitUntil: (promise: Promise<unknown>) => void waits.push(promise) }))
        await Promise.all(waits)
      }
      worker = listeners
    },
    /** What the page gets for a request: the worker's answer, or the network's if it leaves it alone. */
    async request(url: string, { mode = 'cors', method = 'GET' }: { mode?: RequestMode; method?: string } = {}) {
      let answer = null as Promise<Response> | null
      const event: ShellFetchEvent = {
        request: { url, mode, method },
        respondWith: (response) => void (answer = response),
        waitUntil: () => {},
      }
      worker?.fetch.forEach((listener) => listener(event))
      return { handled: answer !== null, response: answer ? await answer : null }
    },
  }
}

describe('opening TinCan with no network', () => {
  it('opens from the app shell stored when the worker installed', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))

    tab.goOffline()

    const page = await tab.request(`${origin}/`, { mode: 'navigate' })
    expect(await page.response!.text()).toBe('<html>TinCan v1</html>')
    const script = await tab.request(`${origin}/assets/index-v1.js`)
    expect(await script.response!.text()).toBe("console.log('v1')")
    // Any address in the app opens the same page.
    const deepLink = await tab.request(`${origin}/podcasts`, { mode: 'navigate' })
    expect(await deepLink.response!.text()).toBe('<html>TinCan v1</html>')
  })

  it('loads the page from the network while online, so a new version shows', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))

    tab.deploy('v2')

    const page = await tab.request(`${origin}/`, { mode: 'navigate' })
    expect(await page.response!.text()).toBe('<html>TinCan v2</html>')
  })

  it('keeps only the newest version’s shell once a new worker takes over', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))
    tab.deploy('v2')

    await tab.install(shellOf('v2'))
    tab.goOffline()

    expect(await tab.storedCopiesOf('/assets/index-v1.js')).toBe(0)
    expect(await tab.storedCopiesOf('/assets/index-v2.js')).toBe(1)
    const page = await tab.request(`${origin}/`, { mode: 'navigate' })
    expect(await page.response!.text()).toBe('<html>TinCan v2</html>')
  })

  it('leaves requests to other sites, and writes, to the network', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))

    expect((await tab.request('https://api.example.com/graphql')).handled).toBe(false)
    expect((await tab.request('https://media.example.com/show/ep1.mp3')).handled).toBe(false)
    expect((await tab.request(`${origin}/index.html`, { method: 'POST' })).handled).toBe(false)
  })
})

// iOS loads the app afresh when the listener comes back to it, often before
// the phone has its network back: requests then hang rather than fail.
describe('opening TinCan on a network that keeps it waiting', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens from the stored shell once the page has been awaited long enough', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))
    tab.deploy('v2')
    vi.useFakeTimers()
    tab.stall()

    const page = tab.request(`${origin}/`, { mode: 'navigate' })
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS)

    expect(await (await page).response!.text()).toBe('<html>TinCan v1</html>')
  })

  it('takes the page from the network if it answers before then', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))
    tab.deploy('v2')
    vi.useFakeTimers()
    const release = tab.stall()

    const page = tab.request(`${origin}/`, { mode: 'navigate' })
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS - 1)
    release()

    expect(await (await page).response!.text()).toBe('<html>TinCan v2</html>')
  })

  it('opens from the stored shell when the network, having kept it waiting, then fails', async () => {
    const tab = browser()
    await tab.install(shellOf('v1'))
    vi.useFakeTimers()
    const release = tab.stall()

    const page = tab.request(`${origin}/`, { mode: 'navigate' })
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS - 1)
    tab.goOffline()
    release()

    expect(await (await page).response!.text()).toBe('<html>TinCan v1</html>')
  })
})

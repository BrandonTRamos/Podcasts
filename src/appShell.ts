/**
 * The app shell, as the service worker keeps it: the page, its scripts and
 * styles, the manifest and icons, stored on the device when the worker
 * installs, so TinCan opens with no network. The build lists the files and
 * writes them into the worker (see `vite.config.ts`).
 */
export interface AppShell {
  /** Changes whenever any file of the shell does. */
  version: string
  /** Every file of the shell, as a path from the site root. The page is `/index.html`. */
  files: string[]
}

/** A request, as the worker sees it. */
export type ShellRequest = Pick<Request, 'url' | 'method' | 'mode'>

export interface ShellEvent {
  waitUntil(promise: Promise<unknown>): void
}

export interface ShellFetchEvent extends ShellEvent {
  request: ShellRequest
  respondWith(response: Promise<Response>): void
}

/** The parts of a service worker's global scope the app shell uses. */
export interface WorkerScope {
  addEventListener(type: 'install' | 'activate', listener: (event: ShellEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: ShellFetchEvent) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  caches: Pick<CacheStorage, 'open' | 'keys' | 'delete'>
  location: { origin: string }
  fetch(request: ShellRequest | string): Promise<Response>
}

const CACHE_PREFIX = 'tincan-shell-'
const PAGE = '/index.html'
/**
 * How long a page is awaited from the network before the stored one opens in
 * its place. iOS loads the app afresh when the listener comes back to it,
 * often before the phone has its network back, and a request then can hang
 * for many seconds before it fails.
 */
export const PAGE_TIMEOUT_MS = 2_000

/**
 * Serves the app shell. Pages come from the network while it answers in
 * time, so a new version shows at once, and from the stored shell when it
 * fails or is slow (`PAGE_TIMEOUT_MS`); the
 * shell's other files always come from the store. A new version's worker
 * stores its own shell, takes over straight away and drops the old one.
 * Requests to other sites (the data API, sign-in, publishers' audio) and for
 * anything outside the shell pass through untouched.
 */
export function serveAppShell(scope: WorkerScope, shell: AppShell) {
  const cacheName = CACHE_PREFIX + shell.version
  const files = new Set(shell.files)

  const fromShell = async (path: string) => (await scope.caches.open(cacheName)).match(path)

  /** The page from the network, or the stored one if the network fails or keeps it waiting. */
  async function openPage(request: ShellRequest): Promise<Response> {
    const fetched = scope.fetch(request)
    let timer: ReturnType<typeof setTimeout> | undefined
    const slow = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PAGE_TIMEOUT_MS)
    })
    try {
      const answer = await Promise.race([fetched, slow])
      if (answer) return answer
      // With no page stored, there is only the network to wait for.
      return (await fromShell(PAGE)) ?? (await fetched)
    } catch {
      return (await fromShell(PAGE)) ?? Response.error()
    } finally {
      clearTimeout(timer)
      // Its failing after the stored page has opened is of no account.
      fetched.catch(() => {})
    }
  }

  scope.addEventListener('install', (event) => {
    event.waitUntil(
      scope.caches
        .open(cacheName)
        .then((cache) => cache.addAll(shell.files))
        .then(() => scope.skipWaiting()),
    )
  })

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      scope.caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName).map((name) => scope.caches.delete(name)),
          ),
        )
        .then(() => scope.clients.claim()),
    )
  })

  scope.addEventListener('fetch', (event) => {
    const { request } = event
    if (request.method !== 'GET') return
    const url = new URL(request.url)
    if (url.origin !== scope.location.origin) return
    if (request.mode === 'navigate') {
      event.respondWith(openPage(request))
    } else if (files.has(url.pathname)) {
      event.respondWith(fromShell(url.pathname).then((stored) => stored ?? scope.fetch(request)))
    }
  })
}

import { createFileClient } from './opfsFiles'
import { createPlaybackLog, localStorageText } from './playbackLog'
import type { Device, DeviceFiles, DeviceStorage, ScreenHold } from './services'

/**
 * The browser's own facilities: the Origin Private File System, local
 * storage, `fetch` and the browser's view of the network, the screen wake
 * lock and storage persistence.
 */
export function browserDevice(): Device {
  return {
    files: originPrivateFiles(),
    storage: localStorageRecords('tincan.device.'),
    playbackLog: createPlaybackLog(localStorageText('tincan.playbackLog')),
    fetch: (url, init) => fetch(url, init),
    isOnline: () => navigator.onLine,
    watchConnectivity(listener) {
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)
      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
    async keepScreenOn(): Promise<ScreenHold> {
      if (!('wakeLock' in navigator)) throw new Error('No screen wake lock in this browser')
      return navigator.wakeLock.request('screen')
    },
    async persistStorage() {
      if (!navigator.storage?.persist) return false
      return (await navigator.storage.persisted()) || navigator.storage.persist()
    },
    reload: () => window.location.reload(),
    watchForNewVersion,
  }
}

/** How often an open app looks for a new deploy, besides when it comes back to the foreground or online. */
const NEW_VERSION_CHECK_MS = 30 * 60_000

/**
 * Looks for a new deploy by fetching the page afresh and comparing the
 * scripts it loads with the running page's: their names carry a hash of their
 * contents, so they differ exactly when a different version is deployed. The
 * fetch for `/` passes the service worker by (it holds only `/index.html`),
 * so this sees what the server has now. Checks on launch, every half hour,
 * and whenever the app returns to the foreground or the network comes back,
 * since an installed app may stay open, in the background, for days.
 */
function watchForNewVersion(listener: () => void): () => void {
  const running = moduleScripts(document)
  let stopped = false
  let found = false
  const check = async () => {
    if (stopped || found || !navigator.onLine) return
    try {
      const response = await fetch('/', { cache: 'no-store' })
      if (!response.ok) return
      const deployed = moduleScripts(new DOMParser().parseFromString(await response.text(), 'text/html'))
      if (stopped || found || deployed.length === 0 || deployed.join() === running.join()) return
      found = true
      listener()
    } catch {
      // Offline or the server didn't answer; the next check tries again.
    }
  }
  const checkIfVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }
  const timer = window.setInterval(() => void check(), NEW_VERSION_CHECK_MS)
  document.addEventListener('visibilitychange', checkIfVisible)
  window.addEventListener('online', checkIfVisible)
  void check()
  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', checkIfVisible)
    window.removeEventListener('online', checkIfVisible)
  }
}

/** The paths of the scripts a page loads as modules, which name the build it is from. */
function moduleScripts(page: Document): string[] {
  return Array.from(
    page.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
    (script) => new URL(script.getAttribute('src')!, window.location.origin).pathname,
  )
}

/**
 * Records in `localStorage` under keys starting with `prefix`, apart from
 * anything else the app keeps there. Storage can be unavailable (private
 * browsing, or blocked): reads then find nothing.
 */
function localStorageRecords(prefix: string): DeviceStorage {
  const storage = () => {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }
  return {
    get: (key) => storage()?.getItem(prefix + key) ?? null,
    set(key, value) {
      const store = storage()
      if (!store) throw new Error('No local storage')
      store.setItem(prefix + key, value)
    },
    remove: (key) => storage()?.removeItem(prefix + key),
    keys() {
      const store = storage()
      if (!store) return []
      const keys: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length))
      }
      return keys
    },
  }
}

/**
 * Files in the Origin Private File System's root folder, written durably
 * chunk by chunk from a dedicated worker (see `opfsFiles.ts`), which starts
 * on first use.
 */
function originPrivateFiles(): DeviceFiles {
  let files: DeviceFiles | null = null
  const connect = () => {
    if (files) return files
    const worker = new Worker(new URL('./opfsWorker.ts', import.meta.url), { type: 'module' })
    const client = createFileClient((message, transfer) => worker.postMessage(message, transfer), playbackUrl)
    worker.addEventListener('message', (event) => client.receive(event.data))
    files = client.files
    return files
  }
  return {
    list: () => connect().list(),
    size: (name) => connect().size(name),
    openForAppend: (name, options) => connect().openForAppend(name, options),
    rename: (from, to) => connect().rename(from, to),
    playbackUrl,
    remove: (name) => connect().remove(name),
  }
}

/** A File from the file system refers to the file on disk; the URL doesn't copy it into memory. */
async function playbackUrl(name: string): Promise<string | null> {
  try {
    const file = await (await navigator.storage.getDirectory()).getFileHandle(name)
    return URL.createObjectURL(await file.getFile())
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

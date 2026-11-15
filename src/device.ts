import { createFileClient } from './opfsFiles'
import type { Device, DeviceFiles, ScreenHold } from './services'

/**
 * The browser's own facilities, as the download manager uses them: the Origin
 * Private File System, `fetch`, the screen wake lock and storage persistence.
 */
export function browserDevice(): Device {
  return {
    files: originPrivateFiles(),
    fetch: (url, init) => fetch(url, init),
    async keepScreenOn(): Promise<ScreenHold> {
      if (!('wakeLock' in navigator)) throw new Error('No screen wake lock in this browser')
      return navigator.wakeLock.request('screen')
    },
    async persistStorage() {
      if (!navigator.storage?.persist) return false
      return (await navigator.storage.persisted()) || navigator.storage.persist()
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

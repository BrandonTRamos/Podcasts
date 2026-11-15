import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'

const SERVICE_WORKER = 'sw.js'
/** In `src/serviceWorker.ts`, as a string in any quotes the minifier picks. */
const SHELL_PLACEHOLDER = /([`"'])__TINCAN_APP_SHELL__\1/
/** The page. Written after the scripts it loads, whose names it holds, so it is listed by name. */
const PAGE = 'index.html'

/** Every file under the folder, as paths relative to it. */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

/**
 * Builds the service worker (`src/serviceWorker.ts`) to /sw.js, with the app
 * shell it keeps written in: the page, every script and style the build
 * emits, and every file in public/, with a version that changes whenever any
 * of them does.
 */
function appShellServiceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'tincan-app-shell',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    generateBundle(_options, bundle) {
      const worker = bundle[SERVICE_WORKER]
      if (worker?.type !== 'chunk') throw new Error(`${SERVICE_WORKER} was not built`)
      if (!SHELL_PLACEHOLDER.test(worker.code)) throw new Error(`${SERVICE_WORKER} has no app shell placeholder`)
      const hash = createHash('sha256')
      const built = Object.values(bundle).filter((file) => file.fileName !== SERVICE_WORKER && !file.fileName.endsWith('.map'))
      for (const file of built) hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source)
      const publicFiles = config.publicDir ? filesIn(config.publicDir) : []
      for (const name of publicFiles) hash.update(name).update(readFileSync(join(config.publicDir, name)))
      const names = new Set([PAGE, ...built.map((file) => file.fileName), ...publicFiles])
      const shell = { version: hash.digest('hex').slice(0, 16), files: [...names].map((name) => `/${name}`).sort() }
      worker.code = worker.code.replace(SHELL_PLACEHOLDER, () => JSON.stringify(JSON.stringify(shell)))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appShellServiceWorker()],
  build: {
    rolldownOptions: {
      input: { index: PAGE, sw: 'src/serviceWorker.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? SERVICE_WORKER : 'assets/[name]-[hash].js'),
      },
    },
  },
})

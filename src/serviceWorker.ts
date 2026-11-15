// The service worker, built to /sw.js as a plain script (see vite.config.ts),
// which writes the shell's files and version in place of the placeholder.
import { type AppShell, serveAppShell, type WorkerScope } from './appShell'

serveAppShell(self as unknown as WorkerScope, JSON.parse('__TINCAN_APP_SHELL__') as AppShell)

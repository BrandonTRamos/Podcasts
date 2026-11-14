import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Two test seams, one per deployable (see spec "Testing Decisions").
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        resolve: {
          // Mirrors the `$amplify/*` path in amplify/tsconfig.json, used by function
          // handlers to import their generated env (`$amplify/env/<function>`).
          alias: { $amplify: fileURLToPath(new URL('./.amplify/generated', import.meta.url)) },
        },
        test: {
          name: 'backend',
          environment: 'node',
          include: ['amplify/**/*.test.ts'],
          setupFiles: ['amplify/test/setup.ts'],
        },
      },
    ],
  },
})

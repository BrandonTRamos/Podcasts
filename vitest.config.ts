import react from '@vitejs/plugin-react'
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

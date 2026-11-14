import { afterEach, beforeEach, vi } from 'vitest'

// Refuse real network access from backend tests. A test that needs HTTP fakes
// it with `vi.stubGlobal('fetch', ...)`; the stub is reset after each test.
beforeEach(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    throw new Error(`Unexpected outbound HTTP request to ${url}. Fake fetch in the test.`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

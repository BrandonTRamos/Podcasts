import { describe, expect, it, vi } from 'vitest'

// Backend tests invoke function handlers directly, faking only outbound HTTP
// and the data store (spec, Testing Decisions). Real network access is refused
// so a test can never reach a live feed by accident. The data store fake comes
// with the first handler that reads or writes records.
describe('backend test setup', () => {
  it('refuses outbound HTTP that a test has not faked', async () => {
    await expect(fetch('https://feeds.example.com/show.xml')).rejects.toThrow(
      /Unexpected outbound HTTP request/,
    )
  })

  it('lets a test fake outbound HTTP', async () => {
    vi.stubGlobal('fetch', async () => new Response('<rss/>', { status: 200 }))

    const response = await fetch('https://feeds.example.com/show.xml')

    expect(await response.text()).toBe('<rss/>')
  })
})

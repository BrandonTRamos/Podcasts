import { describe, expect, it, vi } from 'vitest'

// Backend tests invoke function handlers directly. Only outbound HTTP and the
// data store are faked; real network access is refused so a test can never
// reach a live feed by accident.
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

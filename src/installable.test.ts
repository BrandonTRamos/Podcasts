import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import manifestText from '../public/manifest.webmanifest?raw'

// What a browser reads to install TinCan to a home screen: the page's <head> and
// the web app manifest it links. Files are imported raw, as served from public/.
const publicFiles = import.meta.glob<string>('../public/**/*', { query: '?inline', import: 'default', eager: true })

const head = new DOMParser().parseFromString(indexHtml, 'text/html').head
const manifest = JSON.parse(manifestText) as {
  name: string
  short_name: string
  display: string
  start_url: string
  scope: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

// A file in public/ as the data URL Vite inlines it to, looked up by the absolute
// path the browser would request (the base URL only resolves relative paths).
function publicAsset(path: string): string {
  const dataUrl = publicFiles[`../public${new URL(path, 'https://tincan.test/').pathname}`]
  if (!dataUrl) throw new Error(`${path} is not in public/`)
  return dataUrl
}

function pngSize(path: string): string {
  const bytes = Uint8Array.from(atob(publicAsset(path).split(',')[1]), (c) => c.charCodeAt(0))
  expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG')
  const view = new DataView(bytes.buffer)
  return `${view.getUint32(16)}x${view.getUint32(20)}`
}

describe('installing TinCan to a home screen', () => {
  it('links a manifest that names the app TinCan', () => {
    expect(head.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest')
    expect(manifest.name).toBe('TinCan')
    expect(manifest.short_name).toBe('TinCan')
  })

  it('opens standalone, without browser chrome, at the app root', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    // iOS Safari reads these from the page rather than the manifest.
    expect(head.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes')
    expect(head.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes')
    expect(head.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('TinCan')
  })

  it('has home-screen icons at the sizes Android and iOS ask for', () => {
    const icons = manifest.icons.filter((icon) => icon.type === 'image/png')
    for (const size of ['192x192', '512x512']) {
      const icon = icons.find((i) => i.sizes === size && (i.purpose ?? 'any').split(' ').includes('any'))
      expect(icon, `${size} icon`).toBeDefined()
      expect(pngSize(icon!.src)).toBe(size)
    }
    expect(icons.some((i) => i.purpose?.split(' ').includes('maskable'))).toBe(true)

    const appleIcon = head.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
    expect(appleIcon).toBeTruthy()
    expect(pngSize(appleIcon!)).toBe('180x180')

    const favicon = head.querySelector('link[rel="icon"]')?.getAttribute('href')
    expect(favicon).toBeTruthy()
    expect(publicAsset(favicon!)).toMatch(/^data:image\/svg\+xml/)
  })
})

import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'
import iconSvg from '../public/icon.svg?raw'
import { App } from './App'
import { SPLASH_MIN_MS } from './splash'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

const page = new DOMParser().parseFromString(indexHtml, 'text/html')

/**
 * Puts the page's loading screen in the document, as the browser has it before
 * the app starts, with the clock at nought, as it is when a page opens.
 */
function openPage(): HTMLElement {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const splash = document.importNode(page.getElementById('splash')!, true)
  document.body.append(splash)
  return splash
}

function startApp(auth = fakeAuth(owner)) {
  render(
    <App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />,
  )
}

/** Lets that much time pass since the page opened. */
function wait(ms: number) {
  act(() => void vi.advanceTimersByTime(ms))
}

afterEach(() => {
  vi.useRealTimers()
  document.getElementById('splash')?.remove()
})

describe('the loading screen', () => {
  it('is on the page itself, outside the app, so it shows before the app has loaded', () => {
    const splash = page.getElementById('splash')!

    expect(splash.getAttribute('role')).toBe('status')
    expect(splash.textContent.trim()).toBe('Loading…')
    expect(page.getElementById('root')!.contains(splash)).toBe(false)
  })

  it('draws the icon, with a sound bar to move for each of the icon’s', () => {
    const icon = new DOMParser().parseFromString(iconSvg, 'image/svg+xml')
    const iconBars = Array.from(icon.querySelectorAll('path')).at(-1)!.getAttribute('d')!
    const bars = Array.from(page.querySelectorAll('#splash .bars path'), (bar) => bar.getAttribute('d'))

    expect(bars.join(' ')).toBe(iconBars)
    expect(bars).toHaveLength(5)
  })

  it('stays up while the app finds out who is signed in, then gives way to the sign-in screen', async () => {
    const splash = openPage()

    startApp()
    expect(splash).toBeInTheDocument()

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
    wait(SPLASH_MIN_MS)
    await waitFor(() => expect(splash).not.toBeInTheDocument())
  })

  it('gives way to the library when the owner is already signed in', async () => {
    const auth = fakeAuth(owner)
    await auth.signIn(owner.email, owner.password)
    const splash = openPage()

    startApp(auth)

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    wait(SPLASH_MIN_MS)
    await waitFor(() => expect(splash).not.toBeInTheDocument())
  })

  it('plays for at least a second, however soon the app is ready', async () => {
    const splash = openPage()

    startApp()
    await screen.findByRole('heading', { name: 'Sign in to TinCan' })
    wait(SPLASH_MIN_MS / 2)

    expect(splash).toBeInTheDocument()
    expect(splash).not.toHaveClass('leaving')

    wait(SPLASH_MIN_MS / 2)

    expect(splash).toHaveClass('leaving')
    await waitFor(() => expect(splash).not.toBeInTheDocument())
  })

  it('goes as soon as the app is ready, when that took longer than a second', async () => {
    const splash = openPage()
    wait(SPLASH_MIN_MS)

    startApp()
    await screen.findByRole('heading', { name: 'Sign in to TinCan' })

    await waitFor(() => expect(splash).toHaveClass('leaving'))
    await waitFor(() => expect(splash).not.toBeInTheDocument())
  })
})

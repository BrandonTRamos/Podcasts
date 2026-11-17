import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

/** Opens TinCan on `device` with the owner signed in, on their library. */
async function launch(device = new FakeDevice()) {
  const auth = fakeAuth(owner, { device })
  await auth.signIn(owner.email, owner.password)
  const view = render(
    <App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />,
  )
  await screen.findByRole('heading', { name: 'Library' })
  return { user: userEvent.setup(), device, unmount: view.unmount }
}

type User = ReturnType<typeof userEvent.setup>

async function openSettings(user: User) {
  await user.click(screen.getByRole('button', { name: 'Settings' }))
  await screen.findByRole('heading', { name: 'Settings' })
}

/** The theme the page has: what the stylesheet reads. */
const pageTheme = () => document.documentElement.dataset.theme ?? 'system'

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('settings', () => {
  it('opens from the pill at the top, which shows as current there, and no tab does', async () => {
    const { user } = await launch()

    await openSettings(user)

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('navigation', { name: 'Sections' }).querySelector('[aria-current]')).toBeNull()
  })

  it('is left by choosing a tab', async () => {
    const { user } = await launch()
    await openSettings(user)

    await user.click(screen.getByRole('button', { name: 'Queue' }))

    expect(await screen.findByRole('heading', { name: 'Queue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current')
  })
})

describe('the theme', () => {
  it('follows the device until another is chosen', async () => {
    const { user } = await launch()
    await openSettings(user)

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    expect(pageTheme()).toBe('system')
  })

  it('takes light or dark at once, and back to the device with system', async () => {
    const { user } = await launch()
    await openSettings(user)

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(pageTheme()).toBe('dark')
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(pageTheme()).toBe('light')

    await user.click(screen.getByRole('radio', { name: 'System' }))
    expect(pageTheme()).toBe('system')
  })

  it('is kept by the device for the next launch', async () => {
    const first = await launch()
    await openSettings(first.user)
    await first.user.click(screen.getByRole('radio', { name: 'Dark' }))
    first.unmount()
    delete document.documentElement.dataset.theme

    const relaunched = await launch(first.device)

    expect(pageTheme()).toBe('dark')
    await openSettings(relaunched.user)
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
  })

  it('outlasts signing out, being the device’s own', async () => {
    const { user } = await launch()
    await openSettings(user)
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    await user.click(screen.getByRole('button', { name: 'Library' }))

    await chooseLibraryAction(user, 'Sign out')

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
    expect(pageTheme()).toBe('light')
  })
})

describe('the playback log', () => {
  it('is copied from settings', async () => {
    const { user, device } = await launch()
    device.playbackLog.record('control play')
    device.playbackLog.record('audio play t=600.0 unpaused')
    await openSettings(user)

    await user.click(screen.getByRole('button', { name: 'Copy playback log' }))

    expect(await screen.findByText('Copied 2 lines.')).toBeInTheDocument()
    expect((await navigator.clipboard.readText()).split('\n')).toEqual(device.playbackLog.lines())
  })

  it('is shown to copy by hand where the browser won’t copy it', async () => {
    const { user, device } = await launch()
    device.playbackLog.record('control play')
    await openSettings(user)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))

    await user.click(screen.getByRole('button', { name: 'Copy playback log' }))

    expect(await screen.findByRole('textbox', { name: 'Playback log' })).toHaveValue(device.playbackLog.lines().join('\n'))
  })
})

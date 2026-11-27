import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'
import { chooseLibraryAction, openLibrary } from './test/ui'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

function renderApp(auth = fakeAuth(owner), device = new FakeDevice()) {
  const { unmount } = render(
    <App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />,
  )
  return { unmount, user: userEvent.setup() }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('a new version', () => {
  it('shows a banner at the foot of the screen once a new version is deployed, and reloads on Refresh', async () => {
    const auth = fakeAuth(owner)
    await auth.signIn(owner.email, owner.password)
    const device = new FakeDevice()
    render(<App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)
    await screen.findByRole('main')
    expect(screen.queryByText('A new version is available.')).not.toBeInTheDocument()

    act(() => device.deployNewVersion())
    expect(await screen.findByText('A new version is available.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))

    expect(device.reloads).toBe(1)
  })
})

describe('getting around', () => {
  it('reaches every section from the tabs at the foot of the screen, and marks the one it is on', async () => {
    const { user } = renderApp()
    await signIn(user, owner.email, owner.password)
    await screen.findByRole('navigation', { name: 'Sections' })

    for (const [tab, heading] of [
      ['Library', 'Library'],
      ['Latest', 'Latest episodes'],
      ['Queue', 'Queue'],
      ['Downloads', 'Downloads'],
      ['Search', 'Search'],
    ]) {
      const tabs = screen.getByRole('navigation', { name: 'Sections' })
      await user.click(within(tabs).getByRole('button', { name: tab }))

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(within(tabs).getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page')
    }
  })
})

describe('access', () => {
  it('shows a signed-out visitor the sign-in screen, with no way to sign up', async () => {
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
    expect(screen.queryByText(/sign up|create account|register/i)).not.toBeInTheDocument()
  })

  it('takes the owner from sign-in to Latest by default', async () => {
    const { user } = renderApp()

    await signIn(user, owner.email, owner.password)

    expect(await screen.findByRole('heading', { level: 1, name: 'Latest episodes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-current', 'page')
  })

  it('rejects wrong credentials and stays on the sign-in screen', async () => {
    const { user } = renderApp()

    await signIn(user, owner.email, 'wrong password')

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
  })

  it('opens on Latest after reloading with the owner still signed in', async () => {
    const device = new FakeDevice()
    const { unmount, user } = renderApp(fakeAuth(owner), device)
    await signIn(user, owner.email, owner.password)
    await openLibrary(user)

    unmount()
    renderApp(fakeAuth(owner), device)

    expect(await screen.findByRole('heading', { level: 1, name: 'Latest episodes' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('returns to the sign-in screen after signing out', async () => {
    const { user } = renderApp()
    await signIn(user, owner.email, owner.password)

    await openLibrary(user)
    await chooseLibraryAction(user, 'Sign out')

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
  })
})

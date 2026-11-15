import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { FakeAudio, fakeAuth, fakeDataApi, FakeDevice, FakeMediaSession } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

function renderApp(auth = fakeAuth(owner)) {
  const { unmount } = render(
    <App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device: new FakeDevice() }} />,
  )
  return { unmount, user: userEvent.setup() }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('reloading', () => {
  it('reloads the app from the library, so a newly deployed version shows without closing the installed app', async () => {
    const auth = fakeAuth(owner)
    await auth.signIn(owner.email, owner.password)
    const device = new FakeDevice()
    render(<App services={{ auth, data: fakeDataApi(), audio: new FakeAudio(), mediaSession: new FakeMediaSession(), device }} />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reload app' }))

    expect(device.reloads).toBe(1)
  })
})

describe('getting around', () => {
  it('reaches every section from the tabs at the foot of the screen, and marks the one it is on', async () => {
    const { user } = renderApp()
    await signIn(user, owner.email, owner.password)
    await screen.findByRole('heading', { name: 'Library' })

    for (const [tab, heading] of [
      ['Latest', 'Latest episodes'],
      ['Queue', 'Queue'],
      ['Downloads', 'Downloads'],
      ['Search', 'Search'],
      ['Library', 'Library'],
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

  it('takes the owner from sign-in to an empty library', async () => {
    const { user } = renderApp()

    await signIn(user, owner.email, owner.password)

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.getByText('No podcasts yet.')).toBeInTheDocument()
  })

  it('rejects wrong credentials and stays on the sign-in screen', async () => {
    const { user } = renderApp()

    await signIn(user, owner.email, 'wrong password')

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
  })

  it('keeps the owner signed in across a page reload', async () => {
    const { unmount, user } = renderApp()
    await signIn(user, owner.email, owner.password)
    await screen.findByRole('heading', { name: 'Library' })

    unmount()
    renderApp()

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('returns to the sign-in screen after signing out', async () => {
    const { user } = renderApp()
    await signIn(user, owner.email, owner.password)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to TinCan' })).toBeInTheDocument()
  })
})

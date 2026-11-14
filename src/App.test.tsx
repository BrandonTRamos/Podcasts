import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { fakeAuth, fakeDataApi } from './test/fakes'

const owner = { email: 'owner@example.com', password: 'correct horse battery' }

function renderApp(auth = fakeAuth(owner)) {
  const { unmount } = render(<App services={{ auth, data: fakeDataApi() }} />)
  return { auth, unmount, user: userEvent.setup() }
}

async function signIn(user: ReturnType<typeof userEvent.setup>, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

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
    const { auth, unmount, user } = renderApp()
    await signIn(user, owner.email, owner.password)
    await screen.findByRole('heading', { name: 'Library' })

    unmount()
    renderApp(auth)

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

import { useState, type FormEvent } from 'react'
import type { AuthService, User } from './services'

export function SignInScreen({
  signIn,
  onSignedIn,
}: {
  signIn: AuthService['signIn']
  onSignedIn: (user: User) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await signIn(email, password)
      if (result.ok) onSignedIn(result.user)
      else setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="sign-in">
      <h1>Sign in to TinCan</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
    </main>
  )
}

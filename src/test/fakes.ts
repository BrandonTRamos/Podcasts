import type { AuthService, DataApi, SignInResult, User } from '../services'

const SESSION_KEY = 'fake-auth-session'

/**
 * In-memory stand-in for Cognito. Like Amplify, it keeps the session in
 * `localStorage`, so rendering a fresh `<App>` behaves like a page reload.
 */
export function fakeAuth(account: { email: string; password: string }): AuthService {
  return {
    async currentUser() {
      const stored = localStorage.getItem(SESSION_KEY)
      return stored ? (JSON.parse(stored) as User) : null
    },
    async signIn(email, password): Promise<SignInResult> {
      if (email !== account.email || password !== account.password) {
        return { ok: false, message: 'Incorrect email or password.' }
      }
      const user = { email }
      localStorage.setItem(SESSION_KEY, JSON.stringify(user))
      return { ok: true, user }
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY)
    },
  }
}

export function fakeDataApi(): DataApi {
  return {
    async listPodcasts() {
      return []
    },
  }
}

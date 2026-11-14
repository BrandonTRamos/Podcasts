import type { AuthService, DataApi, SignInResult, User } from '../services'

/**
 * In-memory stand-in for Cognito. The session lives on the fake itself, so a
 * second `<App>` rendered with the same fake behaves like a page reload with
 * tokens still in browser storage.
 */
export function fakeAuth(account: { email: string; password: string }): AuthService {
  let session: User | null = null
  return {
    async currentUser() {
      return session
    },
    async signIn(email, password): Promise<SignInResult> {
      if (email !== account.email || password !== account.password) {
        return { ok: false, message: 'Incorrect email or password.' }
      }
      session = { email }
      return { ok: true, user: session }
    },
    async signOut() {
      session = null
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

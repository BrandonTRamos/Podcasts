/**
 * The client's boundary with the backend. The UI depends only on these
 * interfaces; `amplifyServices.ts` implements them against Cognito and the
 * data API, and tests substitute in-memory fakes.
 */

export interface User {
  email: string
}

export type SignInResult = { ok: true; user: User } | { ok: false; message: string }

export interface AuthService {
  /** The signed-in user from a stored session, or null when signed out. */
  currentUser(): Promise<User | null>
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
}

export interface Podcast {
  id: string
  title: string
}

export interface DataApi {
  listPodcasts(): Promise<Podcast[]>
}

export interface Services {
  auth: AuthService
  data: DataApi
}

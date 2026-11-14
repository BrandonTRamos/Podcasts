import { generateClient } from 'aws-amplify/data'
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import type { Schema } from '../amplify/data/resource'
import type { Services, SignInResult } from './services'

/** Production `Services`: Cognito for auth, the AppSync data API for data. */
export function amplifyServices(): Services {
  const client = generateClient<Schema>()

  return {
    auth: {
      async currentUser() {
        try {
          const user = await getCurrentUser()
          return { email: user.signInDetails?.loginId ?? user.username }
        } catch {
          return null
        }
      },

      async signIn(email, password): Promise<SignInResult> {
        try {
          const result = await signInClearingStaleSession(email, password)
          if (result.isSignedIn) return { ok: true, user: { email } }
          return {
            ok: false,
            message: `This account needs a step TinCan does not support (${result.nextStep.signInStep}). See the README.`,
          }
        } catch (error) {
          const name = error instanceof Error ? error.name : ''
          if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') {
            return { ok: false, message: 'Incorrect email or password.' }
          }
          return { ok: false, message: 'Sign-in failed. Check your connection and try again.' }
        }
      },

      async signOut() {
        await signOut()
      },
    },

    data: {
      async listPodcasts() {
        const { data, errors } = await client.models.Podcast.list()
        if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
        return data.map((podcast) => ({ id: podcast.id, title: podcast.title }))
      },
    },
  }
}

/** Signs in; if leftover tokens make Cognito think a session exists, drops them and retries once. */
async function signInClearingStaleSession(email: string, password: string) {
  try {
    return await signIn({ username: email, password })
  } catch (error) {
    if (!(error instanceof Error && error.name === 'UserAlreadyAuthenticatedException')) throw error
    await signOut()
    return signIn({ username: email, password })
  }
}

import { generateClient } from 'aws-amplify/data'
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import type { Schema } from '../amplify/data/resource'
import type { Services, SignInResult, SubscribeStart } from './services'

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
      observePodcasts(observer) {
        const subscription = client.models.Podcast.observeQuery({
          selectionSet: ['id', 'title', 'author', 'artworkUrl'],
        }).subscribe({
          next: ({ items }) =>
            observer.next(
              items.map((podcast) => ({
                id: podcast.id,
                title: podcast.title,
                author: podcast.author ?? null,
                artworkUrl: podcast.artworkUrl ?? null,
              })),
            ),
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
      },

      observeEpisodes(podcastId, observer) {
        const subscription = client.models.Episode.observeQuery({
          filter: { podcastId: { eq: podcastId } },
          selectionSet: ['id', 'podcastId', 'title', 'publishedAt', 'durationSeconds'],
        }).subscribe({
          next: ({ items }) =>
            observer.next(
              items.map((episode) => ({
                id: episode.id,
                podcastId: episode.podcastId,
                title: episode.title,
                publishedAt: episode.publishedAt ?? null,
                durationSeconds: episode.durationSeconds ?? null,
              })),
            ),
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
      },

      async subscribeToFeed(feedUrl): Promise<SubscribeStart> {
        const { data, errors } = await client.mutations.subscribe({ feedUrl })
        if (errors?.length || !data) throw new Error(errors?.map((e) => e.message).join('; ') ?? 'No result')
        if (data.outcome === 'pending' && data.requestId) return { outcome: 'pending', requestId: data.requestId }
        if (data.outcome === 'alreadySubscribed' && data.podcastId) {
          return { outcome: 'alreadySubscribed', podcastId: data.podcastId }
        }
        if (data.outcome === 'invalidUrl') return { outcome: 'invalidUrl' }
        throw new Error(`Unexpected subscribe result: ${data.outcome}`)
      },

      observeSubscribeRequest(requestId, observer) {
        const subscription = client.models.SubscribeRequest.observeQuery({
          filter: { id: { eq: requestId } },
          selectionSet: ['id', 'status', 'podcastId'],
        }).subscribe({
          next: ({ items }) => {
            const request = items[0]
            if (!request) return
            const { status, podcastId } = request
            if (status === 'subscribed' || status === 'alreadySubscribed') {
              if (podcastId) observer.next({ status, podcastId })
              else observer.error()
            } else {
              observer.next({ status })
            }
          },
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
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

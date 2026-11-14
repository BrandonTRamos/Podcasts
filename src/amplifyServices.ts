import { generateClient } from 'aws-amplify/data'
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import type { Schema } from '../amplify/data/resource'
import type { Episode, SavedEpisodeState, Services, SignInResult, SubscribeStart } from './services'

const episodeFields = ['id', 'podcastId', 'title', 'publishedAt', 'durationSeconds', 'enclosureUrl'] as const
const stateFields = ['id', 'podcastId', 'positionSeconds', 'played', 'queueOrder', 'updatedAt'] as const

/** Production auth and data: Cognito for auth, the AppSync data API for data. */
export function amplifyServices(): Pick<Services, 'auth' | 'data'> {
  const client = generateClient<Schema>()

  /** Every queued episode's state, all pages of them. */
  async function listQueuedStates(): Promise<SavedEpisodeState[]> {
    const states: SavedEpisodeState[] = []
    let nextToken: string | null | undefined = null
    do {
      const page: { data: StateRecord[]; errors?: unknown[]; nextToken?: string | null } =
        await client.models.EpisodeState.list({
          filter: { queueOrder: { attributeExists: true } },
          selectionSet: [...stateFields],
          limit: 1000,
          nextToken,
        })
      if (page.errors?.length) throw new Error('Could not list the queue')
      states.push(...page.data.map(toSavedEpisodeState))
      nextToken = page.nextToken
    } while (nextToken)
    return states
  }

  /** One episode's details, or null if it no longer exists. */
  async function fetchEpisode(id: string): Promise<Episode | null> {
    const { data, errors } = await client.models.Episode.get({ id }, { selectionSet: [...episodeFields] })
    if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
    return data ? toEpisode(data) : null
  }

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
          selectionSet: [...episodeFields],
        }).subscribe({
          next: ({ items }) => observer.next(items.map(toEpisode)),
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

      observeEpisodeStates(podcastId, observer) {
        const subscription = client.models.EpisodeState.observeQuery({
          filter: { podcastId: { eq: podcastId } },
          selectionSet: [...stateFields],
        }).subscribe({
          // The first results arrive a page at a time; wait until all of them have.
          next: ({ items, isSynced }) => isSynced && observer.next(items.map(toSavedEpisodeState)),
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
      },

      async saveEpisodeState(episodeId, podcastId, change): Promise<SavedEpisodeState> {
        // Most saves are to an episode already started, so try updating first. Each
        // call fails its condition when the record is (or is not) there yet.
        const update = () => client.models.EpisodeState.update({ id: episodeId, ...change })
        let result = await update()
        if (!result.data && failedCondition(result.errors)) {
          const { queueOrder, ...rest } = change
          result = await client.models.EpisodeState.create({
            id: episodeId,
            podcastId,
            positionSeconds: 0,
            played: false,
            ...rest,
            // Left out rather than null when not queued, as an update leaves it.
            ...(queueOrder != null && { queueOrder }),
          })
          // Another device created it in the meantime.
          if (!result.data && failedCondition(result.errors)) result = await update()
        }
        if (result.errors?.length || !result.data) {
          throw new Error(result.errors?.map((e) => e.message).join('; ') ?? 'No record saved')
        }
        return toSavedEpisodeState(result.data)
      },

      // Not observeQuery with a filter: its live updates are filtered too, so it
      // would miss an episode joining or leaving the queue. Instead the queued
      // states are listed, and every state change is watched and sorted here.
      observeQueue(observer) {
        /** The latest state seen of each episode, queued or not, so an older event cannot undo a newer one. A deleted one stays, unqueued. */
        const latest = new Map<string, SavedEpisodeState>()
        const episodes = new Map<string, Episode>()
        /** Queued, but its episode is gone with its podcast: left out until its state changes again. */
        const gone = new Set<string>()
        /** The latest save any live event has shown; null until the first. */
        let asOf: string | null = null
        let synced = false
        let closed = false
        const fail = () => {
          if (!closed) observer.error()
        }

        /** Keeps the state if it is the newest seen. Returns whether it changes the queue. */
        function take(state: SavedEpisodeState): boolean {
          const current = latest.get(state.episodeId)
          if (current && Date.parse(current.updatedAt) > Date.parse(state.updatedAt)) return false
          latest.set(state.episodeId, state)
          gone.delete(state.episodeId)
          return state.queueOrder !== null || (current?.queueOrder ?? null) !== null
        }

        const queued = () =>
          [...latest.values()].filter((state) => state.queueOrder !== null && !gone.has(state.episodeId))

        /** Sends the whole queue, once the details of every episode in it have been fetched. */
        async function deliver(snapshotAsOf: string | null) {
          let missing = queued().filter((state) => !episodes.has(state.episodeId))
          while (missing.length) {
            const found = await Promise.all(missing.map((state) => fetchEpisode(state.episodeId)))
            if (closed) return
            missing.forEach(({ episodeId }, i) => {
              const episode = found[i]
              if (episode) episodes.set(episodeId, episode)
              else gone.add(episodeId)
            })
            missing = queued().filter((state) => !episodes.has(state.episodeId))
          }
          if (closed) return
          observer.next({
            entries: queued().map((state) => ({ state, episode: episodes.get(state.episodeId)! })),
            asOf: snapshotAsOf,
          })
        }

        function onEvent(state: SavedEpisodeState) {
          if (asOf === null || Date.parse(state.updatedAt) > Date.parse(asOf)) asOf = state.updatedAt
          if (take(state) && synced) deliver(asOf).catch(fail)
        }
        const selectionSet = [...stateFields]
        const subscriptions = [
          client.models.EpisodeState.onCreate({ selectionSet }).subscribe({ next: (record) => onEvent(toSavedEpisodeState(record)), error: fail }),
          client.models.EpisodeState.onUpdate({ selectionSet }).subscribe({ next: (record) => onEvent(toSavedEpisodeState(record)), error: fail }),
          client.models.EpisodeState.onDelete({ selectionSet }).subscribe({
            next: (record) => onEvent({ ...toSavedEpisodeState(record), queueOrder: null }),
            error: fail,
          }),
        ]

        listQueuedStates()
          .then((states) => {
            if (closed) return
            states.forEach(take)
            synced = true
            // A fresh fetch: it takes account of every save so far.
            return deliver(null)
          })
          .catch(fail)

        return () => {
          closed = true
          subscriptions.forEach((subscription) => subscription.unsubscribe())
        }
      },
    },
  }
}

interface StateRecord {
  id: string
  podcastId: string
  positionSeconds: number
  played: boolean
  queueOrder?: number | null
  updatedAt: string
}

function toEpisode(record: {
  id: string
  podcastId: string
  title: string
  publishedAt?: string | null
  durationSeconds?: number | null
  enclosureUrl: string
}): Episode {
  return {
    id: record.id,
    podcastId: record.podcastId,
    title: record.title,
    publishedAt: record.publishedAt ?? null,
    durationSeconds: record.durationSeconds ?? null,
    enclosureUrl: record.enclosureUrl,
  }
}

function toSavedEpisodeState(record: StateRecord): SavedEpisodeState {
  const { id, podcastId, positionSeconds, played, queueOrder, updatedAt } = record
  return { episodeId: id, podcastId, positionSeconds, played, queueOrder: queueOrder ?? null, updatedAt }
}

/** The data API refused a write because the record did, or did not, exist. */
function failedCondition(errors: readonly { errorType?: string }[] | undefined): boolean {
  return errors?.some((error) => error.errorType?.includes('ConditionalCheckFailed')) ?? false
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

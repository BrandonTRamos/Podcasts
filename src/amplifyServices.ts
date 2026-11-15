import { generateClient } from 'aws-amplify/data'
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth'
import { LATEST_LISTING } from '../amplify/data/latestEpisodes'
import { newestFirst } from './episodes'
import type { Schema } from '../amplify/data/resource'
import {
  type Episode,
  LATEST_EPISODES_LIMIT,
  type Podcast,
  type PodcastSearch,
  type EpisodeStateChange,
  type SavedEpisodeState,
  type Services,
  type SignInResult,
  type StagingState,
  type StoredSession,
  type SubscribeStart,
} from './services'

const episodeFields = ['id', 'podcastId', 'title', 'publishedAt', 'durationSeconds', 'enclosureUrl'] as const
const stateFields = ['id', 'podcastId', 'positionSeconds', 'played', 'queueOrder', 'updatedAt'] as const
const podcastFields = ['id', 'title', 'author', 'artworkUrl', 'lastFetchedAt', 'lastFetchError', 'categoryId', 'libraryOrder'] as const
const categoryFields = ['id', 'name'] as const

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

  /**
   * Updates an episode's listening state unless the change it holds was made
   * after this one, in one conditional write. The model client can't send a
   * condition, so this is the generated mutation, called directly. Its
   * selection set holds every field, as live updates of it carry only these.
   */
  async function updateIfNotOutdone(
    input: { id: string; changedAt: string } & EpisodeStateChange,
  ): Promise<{ data: StateRecord | null; errors?: readonly { message: string; errorType?: string }[] }> {
    try {
      const result = (await client.graphql({
        query: UPDATE_EPISODE_STATE,
        variables: {
          input,
          condition: { or: [{ changedAt: { attributeExists: false } }, { changedAt: { le: input.changedAt } }] },
        },
      })) as { data?: { updateEpisodeState?: StateRecord | null } }
      return { data: result.data?.updateEpisodeState ?? null }
    } catch (error) {
      // A GraphQL error rejects with the whole result.
      const errors = (error as { errors?: { message: string; errorType?: string }[] } | null)?.errors
      if (errors) return { data: null, errors }
      throw error
    }
  }

  /** One episode's details, or null if it no longer exists. */
  async function fetchEpisode(id: string): Promise<Episode | null> {
    const { data, errors } = await client.models.Episode.get({ id }, { selectionSet: [...episodeFields] })
    throwIfErrors(errors)
    return data ? toEpisode(data) : null
  }

  return {
    auth: {
      async storedSession(): Promise<StoredSession> {
        try {
          const user = await getCurrentUser()
          return { status: 'signedIn', user: { email: user.signInDetails?.loginId ?? user.username } }
        } catch (error) {
          // No tokens stored, or Cognito refused to renew them for good (Amplify then clears them).
          const name = error instanceof Error ? error.name : ''
          if (name === 'UserUnAuthenticatedException' || SESSION_ENDED.some((ended) => name.startsWith(ended))) {
            return { status: 'signedOut' }
          }
          // The tokens have expired and renewing them failed for now, as it does with no network.
          return { status: 'unconfirmed' }
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
        const subscription = client.models.Podcast.observeQuery({ selectionSet: [...podcastFields] }).subscribe({
          next: ({ items }) => observer.next(items.map(toPodcast)),
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
      },

      observeCategories(observer) {
        const subscription = client.models.Category.observeQuery({ selectionSet: [...categoryFields] }).subscribe({
          next: ({ items }) => observer.next(items.map(({ id, name }) => ({ id, name }))),
          error: () => observer.error(),
        })
        return () => subscription.unsubscribe()
      },

      async createCategory(name) {
        const { data, errors } = await client.models.Category.create({ name }, { selectionSet: [...categoryFields] })
        throwIfErrors(errors)
        if (!data) throw new Error('Creating the category returned no record')
        return { id: data.id, name: data.name }
      },

      async renameCategory(categoryId, name) {
        const { errors } = await client.models.Category.update({ id: categoryId, name }, { selectionSet: [...categoryFields] })
        throwIfErrors(errors)
      },

      async deleteCategory(categoryId) {
        const { errors } = await client.models.Category.delete({ id: categoryId }, { selectionSet: [...categoryFields] })
        throwIfErrors(errors)
      },

      async setPodcastCategory(podcastId, categoryId) {
        // A null removes the field. Every field the library shows is selected, as live updates carry only these.
        const { errors } = await client.models.Podcast.update(
          { id: podcastId, categoryId, libraryOrder: null },
          { selectionSet: [...podcastFields] },
        )
        throwIfErrors(errors)
      },

      async placePodcast(podcastId, categoryId, libraryOrder) {
        const { errors } = await client.models.Podcast.update(
          { id: podcastId, categoryId, libraryOrder },
          { selectionSet: [...podcastFields] },
        )
        throwIfErrors(errors)
      },

      // Not observeQuery: it can't query an index in order, or stop at a limit.
      // Instead the newest are queried from the date index, and every new or
      // changed episode is watched and sorted in here.
      observeLatestEpisodes(observer) {
        const latest = new Map<string, Episode>()
        let synced = false
        let closed = false
        const fail = () => {
          if (!closed) observer.error()
        }
        const deliver = () => {
          if (closed || !synced) return
          const dated = newestFirst([...latest.values()].filter((episode) => episode.publishedAt !== null))
          // Those that fall off the end are forgotten, so the map stays small.
          for (const episode of dated.slice(LATEST_EPISODES_LIMIT)) latest.delete(episode.id)
          observer.next(dated.slice(0, LATEST_EPISODES_LIMIT))
        }
        const take = (record: EpisodeFields) => {
          latest.set(record.id, toEpisode(record))
          deliver()
        }
        const selectionSet = [...episodeFields]
        const subscriptions = [
          client.models.Episode.onCreate({ selectionSet }).subscribe({ next: take, error: fail }),
          client.models.Episode.onUpdate({ selectionSet }).subscribe({ next: take, error: fail }),
          client.models.Episode.onDelete({ selectionSet }).subscribe({
            next: (record) => {
              latest.delete(record.id)
              deliver()
              // Fill the gap from the index with episodes that were past the limit.
              load()
            },
            error: fail,
          }),
        ]

        /** One query at a time: deletes that arrive while one runs (an unsubscribe, say) ask for one more. */
        let loading = false
        let loadAgain = false
        function load() {
          if (loading) {
            loadAgain = true
            return
          }
          loading = true
          client.models.Episode.listEpisodesByDate(
            { listing: LATEST_LISTING },
            { sortDirection: 'DESC', limit: LATEST_EPISODES_LIMIT, selectionSet },
          )
            .then(({ data, errors }) => {
              throwIfErrors(errors)
              // A live event that arrived first is newer than the query's copy.
              for (const record of data) if (!latest.has(record.id)) latest.set(record.id, toEpisode(record))
              synced = true
              deliver()
            })
            .catch(fail)
            .finally(() => {
              loading = false
              if (loadAgain && !closed) {
                loadAgain = false
                load()
              }
            })
        }
        load()

        return () => {
          closed = true
          subscriptions.forEach((subscription) => subscription.unsubscribe())
        }
      },

      async refreshPodcast(podcastId) {
        const { errors } = await client.mutations.refreshPodcast({ podcastId })
        throwIfErrors(errors)
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

      // Fetched apart from the episode lists, which would otherwise carry every
      // episode's notes, often several kilobytes each, to show none of them.
      async getShowNotes(episodeId) {
        const { data, errors } = await client.models.Episode.get({ id: episodeId }, { selectionSet: ['id', 'showNotes'] })
        throwIfErrors(errors)
        return data?.showNotes ?? null
      },

      async searchPodcasts(term): Promise<PodcastSearch> {
        const { data, errors } = await client.queries.searchPodcasts({ term })
        if (errors?.length || !data) throw new Error(errors?.map((e) => e.message).join('; ') ?? 'No result')
        if (data.outcome === 'directoryUnavailable') return { outcome: 'directoryUnavailable' }
        return {
          outcome: 'found',
          podcasts: data.podcasts.map((podcast) => ({
            title: podcast.title,
            author: podcast.author ?? null,
            artworkUrl: podcast.artworkUrl ?? null,
            feedUrl: podcast.feedUrl,
            podcastId: podcast.podcastId ?? null,
          })),
        }
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

      async unsubscribe(podcastId) {
        const { data, errors } = await client.mutations.unsubscribe({ podcastId })
        if (errors?.length || !data) throw new Error(errors?.map((e) => e.message).join('; ') ?? 'Not unsubscribed')
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

      stageDownload(episodeId, observer) {
        // The client names the request, so it can watch for the outcome before asking.
        const requestId = crypto.randomUUID()
        const selectionSet = ['id', 'status', 'url', 'urlExpiresAt'] as const
        let stopped = false
        let delivered: string | null = null
        let subscription: { unsubscribe(): void } | undefined
        const stop = () => {
          stopped = true
          clearInterval(poll)
          subscription?.unsubscribe()
        }
        const deliver = (staging: StagingRecord | null | undefined) => {
          if (stopped || !staging) return
          const state = toStagingState(staging)
          const key = JSON.stringify(state)
          if (key === delivered) return
          delivered = key
          observer.next(state)
        }
        subscription = client.models.DownloadStaging.observeQuery({
          filter: { id: { eq: requestId } },
          selectionSet: [...selectionSet],
        }).subscribe({
          next: ({ items }) => deliver(items[0]),
          error: () => stopped || observer.error(),
        })
        // A live update can be missed (one landing before the subscription is
        // up, or while it reconnects), so the record is also read every so often.
        const poll = setInterval(() => {
          client.models.DownloadStaging.get({ id: requestId }, { selectionSet: [...selectionSet] }).then(
            ({ data }) => deliver(data),
            () => {},
          )
        }, STAGING_POLL_MS)
        // Returns at once: the copy is made in the background.
        client.mutations.stageDownload({ requestId, episodeId }).then(
          ({ errors }) => {
            if (errors?.length && !stopped) observer.error()
          },
          () => stopped || observer.error(),
        )
        return stop
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

      async saveEpisodeState(episodeId, podcastId, change, changedAt): Promise<SavedEpisodeState> {
        // Most saves are to an episode already started, so try updating first. An
        // update fails its condition when the record is not there yet, or holds a
        // change made later than this one; a create, when the record is there.
        const update = () => updateIfNotOutdone({ id: episodeId, ...change, changedAt })
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
            changedAt,
          })
          if (!result.data && failedCondition(result.errors)) {
            // It is there: either another device created it in the meantime, or it holds a later change.
            result = await update()
            if (!result.data && failedCondition(result.errors)) {
              // The later change wins: this one is dropped, and the state as it stands is the answer.
              result = await client.models.EpisodeState.get({ id: episodeId }, { selectionSet: [...stateFields] })
            }
          }
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

/** Errors renewing a session that mean it is over: Amplify clears its tokens on these. */
const SESSION_ENDED = [
  'NotAuthorizedException',
  'TokenRevokedException',
  'UserNotFoundException',
  'PasswordResetRequiredException',
  'UserNotConfirmedException',
  'RefreshTokenReuseException',
]

const UPDATE_EPISODE_STATE = /* GraphQL */ `
  mutation UpdateEpisodeState($input: UpdateEpisodeStateInput!, $condition: ModelEpisodeStateConditionInput) {
    updateEpisodeState(input: $input, condition: $condition) {
      id
      podcastId
      positionSeconds
      played
      queueOrder
      changedAt
      createdAt
      updatedAt
    }
  }
`

interface StateRecord {
  id: string
  podcastId: string
  positionSeconds: number
  played: boolean
  queueOrder?: number | null
  updatedAt: string
}

/** An episode as the data API returns it, with the fields the client selects. */
interface EpisodeFields {
  id: string
  podcastId: string
  title: string
  publishedAt?: string | null
  durationSeconds?: number | null
  enclosureUrl: string
}

function toPodcast(record: {
  id: string
  title: string
  author?: string | null
  artworkUrl?: string | null
  lastFetchedAt?: string | null
  lastFetchError?: Podcast['lastFetchError'] | null
  categoryId?: string | null
  libraryOrder?: number | null
}): Podcast {
  return {
    id: record.id,
    title: record.title,
    author: record.author ?? null,
    artworkUrl: record.artworkUrl ?? null,
    lastFetchedAt: record.lastFetchedAt ?? null,
    lastFetchError: record.lastFetchError ?? null,
    categoryId: record.categoryId ?? null,
    libraryOrder: record.libraryOrder ?? null,
  }
}

function toEpisode(record: EpisodeFields): Episode {
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

function throwIfErrors(errors: readonly { message: string }[] | undefined) {
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '))
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

/** How often a staging request is read while its copy is prepared, in case a live update is missed. */
const STAGING_POLL_MS = 10_000

type StagingRecord = Pick<Schema['DownloadStaging']['type'], 'status' | 'url' | 'urlExpiresAt'>

function toStagingState({ status, url, urlExpiresAt }: StagingRecord): StagingState {
  if (status !== 'ready') return { status }
  return url && urlExpiresAt ? { status, url, expiresAt: urlExpiresAt } : { status: 'failed' }
}

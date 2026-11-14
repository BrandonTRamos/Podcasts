import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime'
import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import { LATEST_LISTING } from '../data/latestEpisodes'
import type { Schema } from '../data/resource'
import type { EpisodeRecord, FeedStore, PodcastRecord, SubscribeRequestRecord } from './feedStore'

/**
 * Production `FeedStore`: the AppSync data API, reached with the function's IAM
 * role. Writing through the API (not straight to DynamoDB) is what lets the
 * client's data subscriptions see new podcasts and episodes as they land.
 */
export async function amplifyFeedStore(): Promise<FeedStore> {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
    process.env as Parameters<typeof getAmplifyDataClientConfig>[0],
  )
  Amplify.configure(resourceConfig, libraryOptions)
  const client = generateClient<Schema>()

  return {
    async findPodcastByFeedUrl(feedUrl) {
      const { data, errors } = await client.models.Podcast.listPodcastByFeedUrl({ feedUrl })
      throwIfErrors(errors)
      return data[0] ? toPodcast(data[0]) : null
    },

    async listPodcasts() {
      const podcasts: PodcastRecord[] = []
      let nextToken: string | null | undefined = null
      do {
        const page: { data: Schema['Podcast']['type'][]; errors?: GraphQLErrors; nextToken?: string | null } =
          await client.models.Podcast.list({ limit: 1000, nextToken })
        throwIfErrors(page.errors)
        podcasts.push(...page.data.map(toPodcast))
        nextToken = page.nextToken
      } while (nextToken)
      return podcasts
    },

    async getPodcast(id) {
      const { data, errors } = await client.models.Podcast.get({ id })
      throwIfErrors(errors)
      return data ? toPodcast(data) : null
    },

    async createPodcast(podcast) {
      const { data, errors } = await client.models.Podcast.create(podcast)
      throwIfErrors(errors)
      if (!data) throw new Error('Creating the podcast returned no record')
      return toPodcast(data)
    },

    async updatePodcast(id, changes) {
      // A null removes the field.
      const { errors } = await client.models.Podcast.update({ id, ...changes })
      throwIfErrors(errors)
    },

    async getEpisode(id) {
      const { data, errors } = await client.models.Episode.get({ id })
      throwIfErrors(errors)
      if (!data) return null
      if (data.listing !== LATEST_LISTING) {
        // Stored before the latest-episodes index existed: put it in the index.
        // A one-off for each such episode, the first time a refresh looks at it.
        const update = await client.models.Episode.update({ id, listing: LATEST_LISTING, publishedAt: data.publishedAt ?? null })
        throwIfErrors(update.errors)
      }
      return toEpisode(data)
    },

    async createEpisode({ publishedAt, ...episode }) {
      // Left out rather than null when undated: a null can't be stored in the index's sort key.
      const { errors } = await client.models.Episode.create({
        ...episode,
        ...(publishedAt !== null && { publishedAt }),
        listing: LATEST_LISTING,
      })
      throwIfErrors(errors)
    },

    async updateEpisode(episode) {
      // An update removes a field set to null, so an episode that loses its date leaves the index.
      const { errors } = await client.models.Episode.update({ ...episode, listing: LATEST_LISTING })
      throwIfErrors(errors)
    },

    async createSubscribeRequest(feedUrl) {
      const expiresAt = Math.floor(Date.now() / 1000) + REQUEST_LIFETIME_SECONDS
      const { data, errors } = await client.models.SubscribeRequest.create({ feedUrl, status: 'pending', expiresAt })
      throwIfErrors(errors)
      if (!data) throw new Error('Creating the subscribe request returned no record')
      return toSubscribeRequest(data)
    },

    async getSubscribeRequest(id) {
      const { data, errors } = await client.models.SubscribeRequest.get({ id })
      throwIfErrors(errors)
      return data ? toSubscribeRequest(data) : null
    },

    async settleSubscribeRequest(id, { status, podcastId }) {
      const { errors } = await client.models.SubscribeRequest.update({ id, status, podcastId })
      throwIfErrors(errors)
    },
  }
}

/** Requests only matter while the client waits for the outcome; DynamoDB removes them after this. */
const REQUEST_LIFETIME_SECONDS = 24 * 60 * 60

type GraphQLErrors = { errorType?: string; message: string }[]

function throwIfErrors(errors: GraphQLErrors | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => `${error.errorType ?? 'Error'}: ${error.message}`).join('; '))
  }
}

function toPodcast(podcast: Schema['Podcast']['type']): PodcastRecord {
  return {
    id: podcast.id,
    feedUrl: podcast.feedUrl,
    title: podcast.title,
    author: podcast.author ?? null,
    artworkUrl: podcast.artworkUrl ?? null,
    etag: podcast.etag ?? null,
    lastModified: podcast.lastModified ?? null,
    lastFetchedAt: podcast.lastFetchedAt ?? null,
    lastFetchError: podcast.lastFetchError ?? null,
  }
}

function toSubscribeRequest(request: Schema['SubscribeRequest']['type']): SubscribeRequestRecord {
  return {
    id: request.id,
    feedUrl: request.feedUrl,
    status: request.status,
    podcastId: request.podcastId ?? null,
  }
}

function toEpisode(episode: Schema['Episode']['type']): EpisodeRecord {
  return {
    id: episode.id,
    podcastId: episode.podcastId,
    guid: episode.guid,
    title: episode.title,
    publishedAt: episode.publishedAt ?? null,
    durationSeconds: episode.durationSeconds ?? null,
    enclosureUrl: episode.enclosureUrl,
    enclosureType: episode.enclosureType ?? null,
    showNotes: episode.showNotes ?? null,
  }
}

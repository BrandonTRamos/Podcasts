import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime'
import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../data/resource'
import type { EpisodeRecord, FeedStore, PodcastRecord } from './feedStore'

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
      const { errors } = await client.models.Podcast.update({ id, ...changes })
      throwIfErrors(errors)
    },

    async getEpisode(id) {
      const { data, errors } = await client.models.Episode.get({ id })
      throwIfErrors(errors)
      return data ? toEpisode(data) : null
    },

    async createEpisode(episode) {
      const { errors } = await client.models.Episode.create(episode)
      throwIfErrors(errors)
    },

    async requestRefresh(podcastId) {
      const { errors } = await client.mutations.refreshPodcast({ podcastId })
      throwIfErrors(errors)
    },
  }
}

function throwIfErrors(errors: { errorType?: string; message: string }[] | undefined) {
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

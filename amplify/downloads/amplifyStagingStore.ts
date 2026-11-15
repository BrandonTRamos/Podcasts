import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime'
import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import type { Schema } from '../data/resource'
import type { StagingStore } from './stagingStore'

/** Staging records only matter while the client waits on them; DynamoDB removes them after this (backend.ts). */
const STAGING_LIFETIME_SECONDS = 24 * 60 * 60

/**
 * Production `StagingStore`: the AppSync data API, reached with the function's
 * IAM role, so the client's data subscription sees the request settle.
 */
export async function amplifyStagingStore(): Promise<StagingStore> {
  const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(
    process.env as Parameters<typeof getAmplifyDataClientConfig>[0],
  )
  Amplify.configure(resourceConfig, libraryOptions)
  const client = generateClient<Schema>()

  return {
    async getEnclosureUrl(episodeId) {
      const { data, errors } = await client.models.Episode.get({ id: episodeId }, { selectionSet: ['id', 'enclosureUrl'] })
      throwIfErrors(errors)
      return data?.enclosureUrl ?? null
    },

    async createStaging({ id, episodeId }) {
      const expiresAt = Math.floor(Date.now() / 1000) + STAGING_LIFETIME_SECONDS
      const { errors } = await client.models.DownloadStaging.create({ id, episodeId, status: 'preparing', expiresAt })
      throwIfErrors(errors)
    },

    async settleStaging(id, outcome) {
      const { errors } = await client.models.DownloadStaging.update({ id, ...outcome })
      throwIfErrors(errors)
    },
  }
}

function throwIfErrors(errors: { errorType?: string; message: string }[] | undefined) {
  if (errors?.length) {
    throw new Error(errors.map((error) => `${error.errorType ?? 'Error'}: ${error.message}`).join('; '))
  }
}

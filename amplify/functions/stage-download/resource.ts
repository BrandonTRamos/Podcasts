import { defineFunction } from '@aws-amplify/backend'

/**
 * The `stageDownload` mutation, invoked asynchronously so the mutation returns
 * at once: copies an episode's file to the private staging bucket (made in
 * `backend.ts`, which also gives the function its name as `STAGING_BUCKET`).
 */
export const stageDownloadFunction = defineFunction({
  name: 'stage-download',
  entry: './handler.ts',
  // Called by, and calling, the data API: it must live in the data stack to avoid a circular dependency.
  resourceGroupName: 'data',
  // An episode of several hundred megabytes is copied as it arrives, which can take minutes.
  timeoutSeconds: 900,
  memoryMB: 512,
})

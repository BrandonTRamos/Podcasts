import { amplifyStagingStore } from '../../downloads/amplifyStagingStore'
import { s3StagingBucket } from '../../downloads/s3StagingBucket'
import { createStageDownloadHandler, type StageDownloadEvent } from '../../downloads/stageDownload'

const bucketName = process.env.STAGING_BUCKET
if (!bucketName) throw new Error('STAGING_BUCKET must name the staging bucket (see backend.ts)')

const stage = createStageDownloadHandler({ store: await amplifyStagingStore(), bucket: s3StagingBucket(bucketName) })

/** Invoked asynchronously by the `stageDownload` mutation. */
export const handler = (event: StageDownloadEvent) => stage(event)

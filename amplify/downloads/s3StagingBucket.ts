import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { StagingBucket } from './stagingStore'

/** Each part of a multipart upload. With `QUEUE_SIZE` parts in flight, this bounds the memory a copy takes. */
const PART_SIZE = 8 * 1024 * 1024
const QUEUE_SIZE = 2

/**
 * Production `StagingBucket`: the private S3 bucket made in `backend.ts`. A
 * copy is uploaded in parts as it arrives; a failed upload is aborted, leaving
 * no object. Links are presigned GETs.
 */
export function s3StagingBucket(bucketName: string): StagingBucket {
  const s3 = new S3Client({})
  return {
    async put(key, body, { contentType }) {
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucketName,
          Key: key,
          Body: Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
          ...(contentType && { ContentType: contentType }),
        },
        partSize: PART_SIZE,
        queueSize: QUEUE_SIZE,
        leavePartsOnError: false,
      })
      await upload.done()
    },

    linkTo(key, seconds) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName, Key: key }), { expiresIn: seconds })
    },
  }
}

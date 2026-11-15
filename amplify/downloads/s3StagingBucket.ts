import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
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

    async list() {
      const objects: { key: string; storedAt: Date }[] = []
      let ContinuationToken: string | undefined
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucketName, ContinuationToken }))
        for (const { Key, LastModified } of page.Contents ?? []) {
          if (Key && LastModified) objects.push({ key: Key, storedAt: LastModified })
        }
        ContinuationToken = page.NextContinuationToken
      } while (ContinuationToken)
      return objects
    },

    async remove(keys) {
      // At most 1000 keys a request.
      for (let at = 0; at < keys.length; at += 1000) {
        const batch = keys.slice(at, at + 1000)
        const { Errors } = await s3.send(
          new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
        )
        if (Errors?.length) throw new Error(`Could not delete ${Errors.length} staged copies: ${Errors[0].Code}`)
      }
    },
  }
}

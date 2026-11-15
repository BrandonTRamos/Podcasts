import { normaliseFeedUrl, withUrlsRedactedFromErrors } from '../feeds/feedUrl'
import type { StagingBucket, StagingStore } from './stagingStore'

/** The `stageDownload` mutation's event. AppSync invokes the handler asynchronously, so the mutation returns at once. */
export interface StageDownloadEvent {
  /** `requestId` is chosen by the client, which watches the staging record of that ID for the outcome. */
  arguments: { requestId: string; episodeId: string }
}

/** How long the link to a temporary copy works: long enough to download it, and to resume soon after an interruption. */
export const LINK_LIFETIME_SECONDS = 60 * 60

/** Longest the host may take to send the whole file: inside the function's own timeout (stage-download/resource.ts). */
const FETCH_TIMEOUT_MS = 14 * 60 * 1000

/**
 * The download stager, the fallback for publishers whose hosts don't let a web
 * page download their files. It copies the episode's file into the private
 * temporary bucket as it arrives, never holding it whole, and records a
 * short-lived link to the copy on the staging request, which the client
 * watches. Only the episode's own file is fetched, and only over http or
 * https. A copy cut short by the host is not kept.
 */
export function createStageDownloadHandler({
  store,
  bucket,
  now = () => new Date(),
}: {
  store: StagingStore
  bucket: StagingBucket
  now?: () => Date
}) {
  return withUrlsRedactedFromErrors('stageDownload', async ({ arguments: { requestId, episodeId } }: StageDownloadEvent) => {
    await store.createStaging({ id: requestId, episodeId })
    try {
      const enclosureUrl = await store.getEnclosureUrl(episodeId)
      // Server-side fetches accept only http and https.
      if (enclosureUrl === null || normaliseFeedUrl(enclosureUrl) === null) {
        await store.settleStaging(requestId, { status: 'unavailable' })
        return
      }

      let response: Response
      try {
        response = await fetch(enclosureUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      } catch {
        await store.settleStaging(requestId, { status: 'unavailable' })
        return
      }
      if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {})
        await store.settleStaging(requestId, { status: 'unavailable' })
        return
      }

      const objectKey = `staged/${requestId}`
      const body = response.body.pipeThrough(endingWithLength(response.headers.get('Content-Length')))
      try {
        await bucket.put(objectKey, body, { contentType: response.headers.get('Content-Type') })
      } catch (error) {
        if (error instanceof CutShort) {
          await store.settleStaging(requestId, { status: 'failed' })
          return
        }
        throw error
      }

      const url = await bucket.linkTo(objectKey, LINK_LIFETIME_SECONDS)
      const urlExpiresAt = new Date(now().getTime() + LINK_LIFETIME_SECONDS * 1000).toISOString()
      await store.settleStaging(requestId, { status: 'ready', objectKey, url, urlExpiresAt })
    } catch (error) {
      // The client is told, and the failure still shows in the logs.
      await store.settleStaging(requestId, { status: 'failed' }).catch(() => {})
      throw error
    }
  })
}

/** The host stopped sending before the end of the file. */
class CutShort extends Error {}

/** Passes the file through as it comes, failing it at the end if it is shorter or longer than the host said. */
function endingWithLength(contentLength: string | null) {
  const expected = contentLength !== null && /^\d+$/.test(contentLength.trim()) ? Number(contentLength) : null
  let received = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.length
      controller.enqueue(chunk)
    },
    flush(controller) {
      if (expected !== null && received !== expected) controller.error(new CutShort('The host sent part of the file'))
    },
  })
}

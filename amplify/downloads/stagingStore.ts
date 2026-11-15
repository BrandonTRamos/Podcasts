/**
 * The download stager's boundaries: the data API, for the episode and the
 * staging record the client watches, and the private bucket the temporary
 * copy goes to. `amplifyStagingStore.ts` and `s3StagingBucket.ts` implement
 * them; backend tests substitute in-memory fakes.
 */

/** How a staging request stands: `preparing` while the copy is made, then how that ended. */
export type StagingStatus =
  | 'preparing'
  /** The copy is stored, and reachable through the link. */
  | 'ready'
  /** The publisher's host didn't send the file, or the episode has none that can be fetched. */
  | 'unavailable'
  /** Anything else: the host stopped part way, or storing the copy failed. */
  | 'failed'

export type StagingOutcome =
  | {
      status: 'ready'
      /** The copy's key in the bucket. */
      objectKey: string
      /** A short-lived link to the copy. */
      url: string
      /** When the link stops working (ISO 8601). */
      urlExpiresAt: string
    }
  | { status: 'unavailable' | 'failed' }

export interface StagingStore {
  /** The episode's audio file on the publisher's host, or null when there is no such episode. */
  getEnclosureUrl(episodeId: string): Promise<string | null>
  /** Records a new request, `preparing`. Fails if one with this ID exists already. */
  createStaging(request: { id: string; episodeId: string }): Promise<void>
  settleStaging(id: string, outcome: StagingOutcome): Promise<void>
}

export interface StagingBucket {
  /**
   * Stores the stream as the object, as it arrives: never held whole in
   * memory. Resolves once it is all stored; rejects, storing nothing, if the
   * stream errors.
   */
  put(key: string, body: ReadableStream<Uint8Array>, options: { contentType: string | null }): Promise<void>
  /** A link to read the object by, which works for this many seconds. */
  linkTo(key: string, seconds: number): Promise<string>
}

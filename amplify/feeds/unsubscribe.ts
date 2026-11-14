import type { FeedStore } from './feedStore'
import { redactUrls, withUrlsRedactedFromErrors } from './feedUrl'

export interface UnsubscribeEvent {
  arguments: { podcastId: string }
}

/** Records deleted at once. */
const CONCURRENCY = 10

/**
 * The `unsubscribe` mutation: removes a podcast from the library, with its
 * episodes and their listening state (queue places included). Resolves true
 * once all of it is gone, including when it was gone already.
 *
 * The podcast goes last, so that one that fails part-way stays in the library
 * and unsubscribing again finishes the job. A last sweep then catches an
 * episode or state written meanwhile, by a refresh under way, say, or another
 * device saving its place. That sweep failing is logged, not reported: the
 * podcast has left the library, so there is nothing left to try again from.
 */
export function createUnsubscribeHandler({ store }: { store: FeedStore }) {
  async function removeEpisodesAndStates(podcastId: string) {
    await deleteEach(await store.listEpisodeStateIds(podcastId), (id) => store.deleteEpisodeState(id))
    await deleteEach(await store.listEpisodeIds(podcastId), (id) => store.deleteEpisode(id))
  }

  return withUrlsRedactedFromErrors('unsubscribe', async ({ arguments: { podcastId } }: UnsubscribeEvent) => {
    await removeEpisodesAndStates(podcastId)
    await store.deletePodcast(podcastId)
    try {
      await removeEpisodesAndStates(podcastId)
    } catch (error) {
      // The podcast is gone, so the listener can no longer ask again: report success, and log what was left.
      console.error(`Unsubscribe from podcast ${podcastId} left records behind: ${redactUrls(String(error))}`)
    }
    return true
  })
}

/** Deletes each, a few at a time. Rejects, once those under way have finished, if any failed. */
async function deleteEach(ids: string[], remove: (id: string) => Promise<void>) {
  const waiting = [...ids]
  const failures: unknown[] = []
  async function worker() {
    for (let id = waiting.shift(); id !== undefined && !failures.length; id = waiting.shift()) {
      await remove(id).catch((error: unknown) => failures.push(error))
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failures.length) throw failures[0]
}

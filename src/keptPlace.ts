import { readJson, writeJson } from './localCopy'
import type { Player } from './player'
import type { DeviceStorage } from './services'

/** While an episode plays, its place is kept on the device this often. */
export const KEEP_PLACE_MS = 5_000

const PLACE_KEY = 'place'

/** Where the listener had got to in an episode, and when (ISO 8601). */
export interface KeptPlace {
  episodeId: string
  podcastId: string
  positionSeconds: number
  at: string
}

/**
 * Keeps the playing episode's place on this device every `KEEP_PLACE_MS`.
 * The position is saved for every device far less often while playing (each
 * save is a write to the backend), and iOS can close an app playing in the
 * background without a word: the next launch then picks up from the place
 * kept here (`takeKeptPlace`), seconds back rather than up to a minute.
 *
 * Follows the player's own state, not React, so it carries on while the app
 * is hidden. Returns a function that stops it.
 */
export function keepPlace(player: Pick<Player, 'getState' | 'subscribe'>, storage: DeviceStorage): () => void {
  let playing: string | null = null
  let keptAt = 0
  return player.subscribe(() => {
    const state = player.getState()
    if (!state.episode || !state.playing || state.failed) {
      playing = null
      return
    }
    const now = Date.now()
    // Where it starts playing from is already saved, so the first is kept an interval on.
    if (playing !== state.episode.id) {
      playing = state.episode.id
      keptAt = now
      return
    }
    if (now - keptAt < KEEP_PLACE_MS) return
    keptAt = now
    writeJson(storage, PLACE_KEY, {
      episodeId: state.episode.id,
      podcastId: state.episode.podcastId,
      positionSeconds: state.position,
      at: new Date(now).toISOString(),
    } satisfies KeptPlace)
  })
}

/** Drops the place kept: the position has been saved properly since, or its episode is gone. */
export function forgetKeptPlace(storage: DeviceStorage) {
  storage.remove(PLACE_KEY)
}

/**
 * The place kept and never saved, if there is one and it looks whole: the app
 * was closed while playing. It is taken, so the next launch finds none.
 */
export function takeKeptPlace(storage: DeviceStorage): KeptPlace | undefined {
  const place = readJson<KeptPlace>(storage, PLACE_KEY)
  storage.remove(PLACE_KEY)
  const whole =
    typeof place === 'object' &&
    place !== null &&
    typeof place.episodeId === 'string' &&
    typeof place.podcastId === 'string' &&
    typeof place.positionSeconds === 'number' &&
    Number.isFinite(place.positionSeconds) &&
    place.positionSeconds >= 0 &&
    typeof place.at === 'string' &&
    !Number.isNaN(Date.parse(place.at))
  return whole ? place : undefined
}

import { afterEach, describe, expect, it } from 'vitest'
import { createPlaybackLog, LOG_LINES, memoryText, recordLastRun, recordPlayback } from './playbackLog'
import { FakeDeviceStorage } from './test/fakes'
import { takeKeptPlace } from './keptPlace'

const at = (iso: string) => () => new Date(iso)

describe('the playback log', () => {
  it('stamps each line with the time', () => {
    const log = createPlaybackLog(memoryText(), at('2026-11-16T14:03:22.512Z'))

    log.record('control play')

    expect(log.lines()).toEqual(['11-16T14:03:22.512 control play ep=none'])
  })

  it('names the episode loaded on each line, and says when none is', () => {
    const log = createPlaybackLog(memoryText(), at('2026-11-16T14:03:22.512Z'))

    log.record('launch in browser')
    log.loaded('episode-17')
    log.record('control play')
    log.loaded(null)
    log.record('control pause')

    expect(log.lines()).toEqual([
      '11-16T14:03:22.512 launch in browser ep=none',
      '11-16T14:03:22.512 control play ep=episode-17',
      '11-16T14:03:22.512 control pause ep=none',
    ])
  })

  it('carries the audio session’s state as each line is written', () => {
    const session: { state?: string } = { state: 'active' }
    const log = createPlaybackLog(memoryText(), at('2026-11-16T14:03:22.512Z'), () => session)

    log.record('control play')
    session.state = 'interrupted'
    log.record('audio pause')

    expect(log.lines()).toEqual([
      '11-16T14:03:22.512 control play ep=none session=active',
      '11-16T14:03:22.512 audio pause ep=none session=interrupted',
    ])
  })

  it('says the audio session’s state is unknown when the browser gives none', () => {
    const log = createPlaybackLog(memoryText(), at('2026-11-16T14:03:22.512Z'), () => ({}))

    log.record('control play')

    expect(log.lines()).toEqual(['11-16T14:03:22.512 control play ep=none session=unknown'])
  })

  describe('a stalled line', () => {
    /** A clock that moves on a second at each look. */
    const ticking = () => {
      let time = Date.parse('2026-11-16T14:03:22.512Z')
      return () => new Date((time += 1000) - 1000)
    }

    it('that repeats the one before, for the same episode, gives that one a count and the time of the latest', () => {
      const store = memoryText()
      const log = createPlaybackLog(store, ticking())
      log.loaded('episode-17')

      log.record('audio stalled t=600.0 unpaused')
      log.record('audio stalled t=600.0 unpaused')
      log.record('audio stalled t=601.2 unpaused')

      const expected = ['11-16T14:03:22.512 audio stalled t=600.0 unpaused ep=episode-17 x3 latest=11-16T14:03:24.512']
      expect(log.lines()).toEqual(expected)
      expect(createPlaybackLog(store).lines()).toEqual(expected)
    })

    it('is always logged after any other line', () => {
      const log = createPlaybackLog(memoryText(), ticking())

      log.record('audio stalled t=600.0 unpaused')
      log.record('audio waiting t=600.0 unpaused')
      log.record('audio stalled t=600.0 unpaused')

      expect(log.lines().map((line) => line.slice(19))).toEqual([
        'audio stalled t=600.0 unpaused ep=none',
        'audio waiting t=600.0 unpaused ep=none',
        'audio stalled t=600.0 unpaused ep=none',
      ])
    })

    it('is logged when the episode has changed', () => {
      const log = createPlaybackLog(memoryText(), ticking())
      log.loaded('episode-17')
      log.record('audio stalled t=600.0 unpaused')

      log.loaded('episode-18')
      log.record('audio stalled t=0.0 unpaused')

      expect(log.lines().map((line) => line.slice(19))).toEqual([
        'audio stalled t=600.0 unpaused ep=episode-17',
        'audio stalled t=0.0 unpaused ep=episode-18',
      ])
    })
  })

  it('is still there after a relaunch', () => {
    const store = memoryText()
    createPlaybackLog(store).record('control pause')

    const relaunched = createPlaybackLog(store)
    relaunched.record('control play')

    expect(relaunched.lines().map((line) => line.slice(19))).toEqual(['control pause ep=none', 'control play ep=none'])
  })

  it('drops the oldest lines once full', () => {
    const log = createPlaybackLog(memoryText())

    for (let i = 0; i < LOG_LINES + 2; i++) log.record(`line ${i}`)

    const lines = log.lines()
    expect(lines).toHaveLength(LOG_LINES)
    expect(lines[0]).toMatch(/line 2 /)
    expect(lines.at(-1)).toMatch(new RegExp(`line ${LOG_LINES + 1} `))
  })

  it('starts again when what was stored can’t be read', () => {
    const store = memoryText()
    store.write('{not json')
    const log = createPlaybackLog(store)

    log.record('control play')

    expect(log.lines()).toHaveLength(1)
  })

  it('carries on in memory when nothing can be stored', () => {
    const log = createPlaybackLog({
      read: () => null,
      write() {
        throw new DOMException('Full', 'QuotaExceededError')
      },
    })

    log.record('control play')

    expect(log.lines()).toHaveLength(1)
  })
})

describe('the line at launch on how the last run ended', () => {
  /** A device whose last run logged these lines and kept this place, launched again at 14:20. */
  function lastRun(lines: string[], place?: object, episodeId: string | null = 'ep-1') {
    const store = memoryText()
    const before = createPlaybackLog(store, at('2026-11-16T14:03:22.512Z'), () => undefined)
    before.loaded(episodeId)
    for (const line of lines) before.record(line)
    const storage = new FakeDeviceStorage()
    if (place) storage.set('place', JSON.stringify(place))
    return { log: createPlaybackLog(store, at('2026-11-16T14:20:00.000Z')), storage }
  }

  it('says the page was told, when that was the last word', () => {
    const { log, storage } = lastRun(['audio pause t=600.0 paused ready=4 net=1 hidden', 'page going t=600.0 paused ready=4 net=1 hidden'])

    recordLastRun(log, storage)

    expect(log.lines().at(-1)).toBe('11-16T14:20:00.000 last run closed with the page told ep=none')
  })

  it('says it ended without a word, and when and where it was last known to be playing, when it left a place playing', () => {
    const { log, storage } = lastRun(['page t=600.0 unpaused ready=4 net=1 hidden'], {
      episodeId: 'ep-1',
      podcastId: 'pod-1',
      positionSeconds: 605,
      at: '2026-11-16T14:03:27.600Z',
    })

    recordLastRun(log, storage)

    expect(log.lines().at(-1)).toBe(
      '11-16T14:20:00.000 last run ended without a word: last known playing at 11-16T14:03:27.600, episode ep-1 t=605.0 ep=none',
    )
  })

  it('says it ended without a word when its last line had it playing, though it kept no place', () => {
    const { log, storage } = lastRun(['audio moving t=3.2 unpaused ready=4 net=2 hidden'])

    recordLastRun(log, storage)

    expect(log.lines().at(-1)).toBe(
      '11-16T14:20:00.000 last run ended without a word: last known playing at 11-16T14:03:22.512, episode ep-1 t=3.2 ep=none',
    )
  })

  it('gives the time of the latest, when its last line had it playing and stood for several', () => {
    const store = memoryText()
    let time = Date.parse('2026-11-16T14:03:22.512Z')
    const before = createPlaybackLog(store, () => new Date((time += 1000) - 1000), () => undefined)
    before.loaded('ep-1')
    for (let i = 0; i < 3; i++) before.record('audio stalled t=3.2 unpaused ready=2 net=2 hidden')
    const log = createPlaybackLog(store, at('2026-11-16T14:20:00.000Z'))

    recordLastRun(log, new FakeDeviceStorage())

    expect(log.lines().at(-1)).toBe(
      '11-16T14:20:00.000 last run ended without a word: last known playing at 11-16T14:03:24.512, episode ep-1 t=3.2 ep=none',
    )
  })

  it('leaves the place kept for the launch to pick up from', () => {
    const place = { episodeId: 'ep-1', podcastId: 'pod-1', positionSeconds: 605, at: '2026-11-16T14:03:27.600Z' }
    const { log, storage } = lastRun(['page t=600.0 unpaused ready=4 net=1 hidden'], place)

    recordLastRun(log, storage)

    expect(takeKeptPlace(storage)).toEqual(place)
  })

  it('says it ended paused, not that it stopped without a word, when it was paused', () => {
    const { log, storage } = lastRun(['audio pause t=600.0 paused ready=4 net=1 hidden'])

    recordLastRun(log, storage)

    expect(log.lines().at(-1)).toBe('11-16T14:20:00.000 last run ended paused, episode ep-1 ep=none')
  })

  it('says it ended with nothing loaded, when no episode was', () => {
    const { log, storage } = lastRun(['launch installed Mozilla/5.0 t=0.0 paused ready=0 net=0 visible'], undefined, null)

    recordLastRun(log, storage)

    expect(log.lines().at(-1)).toBe('11-16T14:20:00.000 last run ended with nothing loaded ep=none')
  })

  it('says nothing of a last run at a first launch', () => {
    const log = createPlaybackLog(memoryText())

    recordLastRun(log, new FakeDeviceStorage())

    expect(log.lines()).toEqual([])
  })
})

describe('recording what the audio element does', () => {
  const audio = document.createElement('audio')
  const log = createPlaybackLog(memoryText())
  recordPlayback(log, audio)
  /** The lines since the last look, without their times. */
  let seen = 0
  const fresh = () => {
    const lines = log.lines().slice(seen)
    seen += lines.length
    return lines.map((line) => line.slice(19))
  }
  /** jsdom plays nothing, so the test says where the element is. */
  let paused = true
  let position = 0
  Object.defineProperty(audio, 'paused', { get: () => paused })
  Object.defineProperty(audio, 'currentTime', { get: () => position })
  const fire = (type: string) => audio.dispatchEvent(new Event(type))

  afterEach(() => {
    paused = true
    position = 0
  })

  it('notes the launch, and whether the app is installed', () => {
    expect(fresh()).toEqual([expect.stringMatching(/^launch in browser .+ t=0\.0 paused ready=0 net=0 visible ep=none$/)])
  })

  it('records each event with the element’s state', () => {
    paused = false
    position = 600

    fire('play')
    fire('waiting')

    expect(fresh()).toEqual([
      'audio play t=600.0 unpaused ready=0 net=0 visible ep=none',
      'audio waiting t=600.0 unpaused ready=0 net=0 visible ep=none',
    ])
  })

  it('records the position moving, once, after a play', () => {
    paused = false
    position = 600
    fire('play')
    fire('timeupdate')

    position = 600.3
    fire('timeupdate')
    position = 600.6
    fire('timeupdate')

    expect(fresh()).toEqual([expect.stringMatching(/^audio play /), 'audio moving t=600.3 unpaused ready=0 net=0 visible ep=none'])
  })

  it('doesn’t take a seek for the position moving', () => {
    paused = false
    position = 600
    fire('play')

    position = 1200
    fire('timeupdate')

    expect(fresh()).toEqual([expect.stringMatching(/^audio play /)])
  })

  it('records the page being hidden', () => {
    document.dispatchEvent(new Event('visibilitychange'))

    expect(fresh()).toEqual(['page t=0.0 paused ready=0 net=0 visible ep=none'])
  })
})

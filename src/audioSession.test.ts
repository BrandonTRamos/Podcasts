import { describe, expect, it } from 'vitest'
import { claimPlaybackAudioSession } from './mediaSession'

// Safari's audio session: unless told the page plays media, iOS hands the lock
// screen back to Apple Music moments after playback pauses (a headset taken off).
describe('claiming the audio session for playback', () => {
  it('tells the browser the app plays media, so it keeps the lock screen while paused', () => {
    const browser = { audioSession: { type: 'auto' } }

    claimPlaybackAudioSession(browser)

    expect(browser.audioSession.type).toBe('playback')
  })

  it('does nothing where the browser has no audio session', () => {
    expect(() => claimPlaybackAudioSession({})).not.toThrow()
  })

  it('carries on if the browser refuses the type', () => {
    const browser = {
      audioSession: {
        set type(_: string) {
          throw new DOMException('Not supported', 'NotSupportedError')
        },
      },
    }

    expect(() => claimPlaybackAudioSession(browser)).not.toThrow()
  })
})

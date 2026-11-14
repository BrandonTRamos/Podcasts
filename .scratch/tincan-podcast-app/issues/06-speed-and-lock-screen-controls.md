# 06: Playback speed and lock-screen controls

**What to build:** The listener can change playback speed and have it remembered. The phone's lock screen, the OS media controls and headphone buttons all show what is playing and control it. (Spec stories 28, 29, 42, 43, 45.)

**Blocked by:** 04

**Status:** done

- [x] The listener can pick a playback speed from presets, and it applies immediately
- [x] The chosen speed persists across episodes and app relaunch
- [x] The OS media controls show episode title, podcast name and artwork
- [x] Play, pause, skip back 15 seconds and skip forward 30 seconds work from the OS media controls
- [x] Headphone and Bluetooth play/pause buttons control playback
- [x] The OS media controls show the current position and duration
- [x] Client-seam tests assert on the metadata and control handlers through a fake of the media-session interface

## Comments

- Speed lives in the player engine (`src/player.ts`: `SPEEDS` presets 0.75–2×, `setSpeed`, `speed` in the player state) and is picked from a "Playback speed" select on now playing. It is applied as both `playbackRate` and `defaultPlaybackRate`, so a new file keeps it, and re-applied on `loadedmetadata` and `play` for browsers that reset it.
- Decision not spelled out in the spec: speed is remembered per device in `localStorage` (`tincan.playbackSpeed`), not synced through the backend. An unknown stored value falls back to 1×.
- OS media controls go through a new `MediaSessionControls` service (`src/services.ts`), wrapped over `navigator.mediaSession` by `browserMediaSession` (`src/mediaSession.ts`, every call guarded). `connectMediaSession` follows the player's own state, not React: metadata (episode title, podcast name as artist, podcast artwork), playback state, and position state (position capped at the duration, rate = speed; cleared while the length is unknown). Cleared on sign out.
- Handlers: play, pause, seekbackward (15 s), seekforward (30 s) and seekto (lock-screen scrubber). The OS's suggested seek offset is ignored, to match the in-app buttons. No next/previous track: on iOS those replace the skip buttons, a trade-off ticket 07 (queue) has to decide. Headphone and Bluetooth play/pause reach the app as the same play/pause actions.
- Metadata is set again each time playback starts, since Safari can drop it when a file loads.
- Tests: `src/MediaControls.test.tsx` (through `FakeMediaSession` in `src/test/fakes.ts`, which rejects invalid position states as the real API does) and the "playback speed" block in `src/Playback.test.tsx`, including relaunch.
- Not exercised in a real browser or on a phone from this session. Ticket 08's iPhone check should cover: lock-screen title/artwork/podcast name, the skip buttons' labels (iOS may not show 15/30), scrubbing, AirPods/Bluetooth play-pause, speed surviving a new episode on iOS, and whether re-setting metadata on resume makes the artwork flicker.

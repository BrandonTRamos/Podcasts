# 04: Stream an episode

**What to build:** The listener taps an episode and it plays, streamed straight from the publisher. They can pause, seek and skip, and a mini player stays with them while they browse. A now-playing screen gives the full controls. (Spec stories 25, 26, 27, 33, 34, 35.)

**Blocked by:** 03

**Status:** done

- [x] Tapping an episode starts it streaming from the publisher's URL
- [x] Play and pause work, and a seek bar shows elapsed time and duration
- [x] Skip back moves 15 seconds and skip forward moves 30 seconds
- [x] A mini player with title, artwork and play/pause stays visible on every screen while something is loaded
- [x] A now-playing screen shows artwork and the full set of controls
- [x] Starting another episode replaces the current one
- [x] An episode that fails to load shows a clear message and leaves the app usable
- [x] Playback uses a plain audio element, not the Web Audio API
- [x] Client-seam tests cover these behaviours with a faked audio element

## Comments

- Implemented with a player engine (`src/player.ts`) over one plain `<audio>` element injected as `Services.audio`; UI in `src/NowPlaying.tsx`; client-seam tests in `src/Playback.test.tsx` with `FakeAudio` (`src/test/fakes.ts`).
- The mini player is hidden while the now-playing screen is open, since that screen carries the same controls and more.
- Tapping the episode already loaded carries on from where it is (or retries it, if it failed to load), rather than restarting it.
- Not exercised against a live publisher in a real browser from this session: no sandbox here. Ticket 08 covers the iPhone check.

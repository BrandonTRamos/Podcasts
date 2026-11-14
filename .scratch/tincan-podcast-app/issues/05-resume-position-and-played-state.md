# 05: Resume position and played state

**What to build:** The listener's place in every episode is remembered and follows them between devices. Episodes they finish are marked played, they can correct that by hand, and episode lists show what is played, part-played or new. (Spec stories 17, 19, 20, 24, 30, 31, 32.)

**Blocked by:** 04

**Status:** done

- [x] Position is saved on pause, when an episode ends and when the app is backgrounded
- [x] During continuous playback, position is saved at most once every 60 seconds
- [x] Opening a part-played episode resumes from the saved position
- [x] A position saved on one device is used when the episode is opened on another
- [x] An episode that plays to the end is marked played
- [x] The listener can mark an episode played or unplayed by hand
- [x] Episode lists show played state, and progress for part-played episodes
- [x] Episode lists can be filtered to unplayed
- [x] Client-seam tests cover resume, played state and the 60-second save limit

## Comments

- `EpisodeState` model (`amplify/data/resource.ts`): id = the episode's ID, `podcastId`, `positionSeconds`, `played`. "Updated time" is the data API's own `updatedAt`. Queue order left for ticket 07.
- Client: listening store (`src/listening.ts`) keeps this device's copy, shows changes at once, saves in the background. Each save sends only the fields it changes (a position save can't undo a "played" mark made elsewhere); of two saves the later `updatedAt` wins. A failed save stays shown locally until a later save replaces it; no retry or offline queue (later ticket).
- Player engine (`src/player.ts`) saves on pause, at the end (marking played), when another episode replaces the loaded one, on `visibilitychange` to hidden / `pagehide`, and at most every 60 s while playing (wall clock).
- Cross-device: states are observed live, and fetched afresh when the app becomes visible again, since iOS can suspend a backgrounded app and its live updates are not replayed. A paused loaded episode moves to a newer position saved elsewhere.
- Decisions not spelled out in the spec: a played episode opens from the start; marking an episode unplayed also takes it back to the start. Lists label each episode Played, part-played (progress bar + time left) or New.
- Tests: `src/Listening.test.tsx`, two devices sharing one fake backend (`fakeDataApi().anotherDevice()`, `sleep`/`wake` to miss live updates).
- Not exercised against a real backend or browser from this session (no sandbox): the `EpisodeState` table, the update-then-create save, Amplify `observeQuery`'s `isSynced` paging, and real iOS audio seeking before metadata loads. Ticket 08's iPhone check should include resume and save-on-lock.

# 14: Offline launch

**What to build:** With no network at all, the listener opens TinCan, sees their library, and plays their downloaded episodes. Nothing asks them to sign in. What they listen to offline syncs once they are back online. (Spec stories 51, 52, 53, 54.)

**Blocked by:** 05, 13

**Status:** done

- [x] With no network, the app opens
- [x] The library, episode lists and listening state are visible offline
- [x] Downloaded episodes play offline, with seeking
- [x] Offline playback works when the session has expired, with no sign-in prompt in the way
- [x] Episodes that are not downloaded are shown as unavailable while offline
- [x] The app shows when it is offline
- [x] Position, played state and queue changes made offline are kept and synced when the network returns
- [x] When the same episode changed on two devices, the most recent change wins
- [x] Client-seam tests cover launch, playback and later sync with the data API unreachable

## Comments

- **2026-11-14, PR review round 1: flaky test from before this ticket.** `src/FeedRefresh.test.tsx`, "stops checking once the backend has had time to answer", failed about 1 run in 3 with "Checking for new episodes…" still shown. It ran under `vi.useFakeTimers({ shouldAdvanceTime: true })`, so real time leaked into the fake clock. The 30-second check timer could also be set after the first `advanceTimersByTime`, since the Refresh tap's result was handled outside `act`. Fixed in the test only: fake timers (`setTimeout`/`clearTimeout`) now start just before the tap, and the tap runs inside `act`, so the timer starts at a known time. The app code was fine. Since `amplify.yml` runs `npm run check` before deploying, a flake like this could fail a production deploy.

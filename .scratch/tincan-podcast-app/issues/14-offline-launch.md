# 14: Offline launch

**What to build:** With no network at all, the listener opens TinCan, sees their library, and plays their downloaded episodes. Nothing asks them to sign in. What they listen to offline syncs once they are back online. (Spec stories 51, 52, 53, 54.)

**Blocked by:** 05, 13

**Status:** ready-for-agent

- [ ] With no network, the app opens
- [ ] The library, episode lists and listening state are visible offline
- [ ] Downloaded episodes play offline, with seeking
- [ ] Offline playback works when the session has expired, with no sign-in prompt in the way
- [ ] Episodes that are not downloaded are shown as unavailable while offline
- [ ] The app shows when it is offline
- [ ] Position, played state and queue changes made offline are kept and synced when the network returns
- [ ] When the same episode changed on two devices, the most recent change wins
- [ ] Client-seam tests cover launch, playback and later sync with the data API unreachable

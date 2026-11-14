# 05: Resume position and played state

**What to build:** The listener's place in every episode is remembered and follows them between devices. Episodes they finish are marked played, they can correct that by hand, and episode lists show what is played, part-played or new. (Spec stories 17, 19, 20, 24, 30, 31, 32.)

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Position is saved on pause, when an episode ends and when the app is backgrounded
- [ ] During continuous playback, position is saved at most once every 60 seconds
- [ ] Opening a part-played episode resumes from the saved position
- [ ] A position saved on one device is used when the episode is opened on another
- [ ] An episode that plays to the end is marked played
- [ ] The listener can mark an episode played or unplayed by hand
- [ ] Episode lists show played state, and progress for part-played episodes
- [ ] Episode lists can be filtered to unplayed
- [ ] Client-seam tests cover resume, played state and the 60-second save limit

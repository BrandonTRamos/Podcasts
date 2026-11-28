# 10: Queue advances while locked

**What to build:** On the iPhone app, the next queued episode starts by itself when one ends, with the phone locked, every time. The iPhone's player hands the upcoming queue to native code, which advances without JavaScript. Marking the finished episode played is ticket 11. (Spec: Player, Native audio; stories 33 to 37, 41.)

**Blocked by:** 04, 05, 07

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] Whenever the iPhone's player is told the upcoming queue, it hands it to native code
- [ ] When an episode ends, native code starts the next one without JavaScript
- [ ] Each queued episode starts from its saved position
- [ ] The lock screen shows the new episode's artwork and titles after an advance
- [ ] The lock screen offers a next button exactly when something is queued, and it works
- [ ] Skipping to the next episode, from the app or the lock screen, keeps the place in the one left
- [ ] A queue change made in the app while an episode plays takes effect for locked playback
- [ ] When the queue is empty, playback stops at the end of the episode
- [ ] On return, the app shows the episode now playing and its position
- [ ] Each advance is a line in the playback log
- [ ] A queue change made on another device while the phone is locked is not seen until JavaScript next runs; that is accepted and noted in the README
- [ ] Tests drive the whole app over the fake native bridge: every queue change reaches native code, and an advance native code reports shows on screen
- [ ] The Swift that orders the queue has unit tests that run on the macOS runner
- [ ] On the phone: the queue advances three times in a row with the phone locked. Result recorded under `## Comments`

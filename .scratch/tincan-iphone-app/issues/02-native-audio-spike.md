# 02: Native audio spike

**What to build:** A first, minimal cut of TinCan's own Swift audio plugin, behind a bare test screen that only the iPhone app shows. It exists to answer four questions on the owner's phone before any real work depends on the answers. The test screen is thrown away; the plugin is the seed of the real one if the spike passes. This ticket is a gate: see "Order of work" in the spec.

**Blocked by:** 01

**Status:** ready-for-agent

**Human steps:** the owner installs the build, runs each check on the iPhone and reports what happened. Stop and say exactly what to do for each check.

The questions:

1. Does native audio play, and advance to the next item by itself, through an hour with the phone locked?
2. Does a file stored on the phone play at 3x and at 0.5x?
3. Does JavaScript in the shell keep running while the phone is locked and native audio plays, and if so for how long?
4. Is writing Swift with no local compiler, through cloud builds, tolerable?

- [ ] The plugin is Swift in this repo, compiled by the pipeline from ticket 01; no community or paid audio plugin
- [ ] The test screen can queue a remote episode followed by a second item, and a file stored on the phone, and set the speed
- [ ] With the phone locked for an hour, playback continues and the second item starts by itself (question 1)
- [ ] Play pressed and the phone locked at once: the item starts, or it does not, and which is recorded
- [ ] The stored file plays at 3x and at 0.5x (question 2)
- [ ] JavaScript writes a timestamp every few seconds to somewhere that survives; after the locked hour the test screen shows the gaps, which answer question 3
- [ ] The lock screen shows a title, and play and pause work from it
- [ ] The number of cloud builds this ticket took, and the time from push to running on the phone, are recorded (question 4)
- [ ] Results and the owner's verdict on question 4 are recorded under `## Comments`
- [ ] Pass: ADR 2 is written with what was measured, and tickets 05 to 17 are revised wherever a measurement contradicts them (they were written before it). Fail: that is said plainly, the tickets not yet done from 05 on are set to `wontfix` with the reason (the web-only prefactors 03, 04 and 12 stand either way), and the React Native fallback goes back to the owner for discussion

# 07: Lock-screen controls

**What to build:** On the iPhone app, the lock screen and Control Centre show what is playing and control it, and headphone and Bluetooth buttons work. Native code handles all of it, so it works while JavaScript is paused. The next button comes with the queue, in ticket 10. (Spec: Native audio; stories 38 to 40, 42, 43.)

**Blocked by:** 05

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] The lock screen and Control Centre show artwork, episode title, podcast title, position and length
- [ ] Play, pause, skip back and skip forward work from the lock screen
- [ ] The skip buttons move by the intervals chosen in Settings, and follow a change to them
- [ ] The scrubber seeks
- [ ] Headphone and Bluetooth buttons play and pause
- [ ] All of these work with the phone locked for long enough that JavaScript is paused
- [ ] What was done from the lock screen shows in the app on return
- [ ] An episode paused for ten minutes with the phone locked plays on at once from the lock screen
- [ ] Tests drive the whole app over the fake native bridge: what is playing and the skip intervals reach native code, and a control used on the lock screen shows on screen
- [ ] On the phone: each control works from the lock screen and from headphones. Result recorded under `## Comments`

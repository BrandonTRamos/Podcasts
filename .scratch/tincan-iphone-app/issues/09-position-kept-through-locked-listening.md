# 09: Position kept through locked listening

**What to build:** On the iPhone app, the listener's place is never lost while the phone is locked, whatever iOS does to the app. Native code records listening changes on the phone as they happen. Whenever JavaScript next runs, they are sent on through the listening store with the times they were made, so other devices catch up. This ticket covers position; episodes that finish while locked are ticket 11. (Spec: Listening changes while locked; ADR 1; stories 50, 51, 53 to 56.)

**Blocked by:** 05

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] While playing, native code records a listening change with the position and the time: at intervals, at every pause, and when the app goes to the background
- [ ] They are stored where they survive iOS ending the app, a force-quit and a restart of the phone
- [ ] Nothing here depends on JavaScript running while the app is in the background
- [ ] Whenever JavaScript runs (at launch, on return to the foreground, or in the background if iOS allows it), the stored changes are taken and passed to the listening store, each with its own time
- [ ] A change is removed from the phone only once the listening store has it; one taken twice does no harm
- [ ] A stored change older than one made on another device loses to it, and a newer one wins, as ADR 1 says
- [ ] With no network, the changes wait in the listening store and are sent when it returns, as now
- [ ] After iOS ends the app mid-episode, the next launch opens the episode within the recording interval of where it stopped
- [ ] Tests drive the whole app over the fake native bridge: stored changes are saved to the backend with their own times; an older one loses to a newer one from elsewhere
- [ ] The Swift that stores the changes has unit tests that run on the macOS runner
- [ ] On the phone: after twenty minutes locked and the app swiped away, reopening shows the right position, and the web app shows it too. Result recorded under `## Comments`

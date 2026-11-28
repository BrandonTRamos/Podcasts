# 11: Episodes finished while locked are played

**What to build:** On the iPhone app, an episode that ends while the phone is locked is marked played and leaves the queue, on the phone and on every other device, as it would have had the app been open. Native code records the listening changes; they are sent on when JavaScript next runs, by the path ticket 09 built. (Spec: Listening changes while locked; ADR 1; stories 52, 53, 56.)

**Blocked by:** 09, 10

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] When an episode ends, native code records that it finished, with the time
- [ ] When the next one starts, native code records that too, and then its position as ticket 09 does
- [ ] When JavaScript next runs, each finished episode is marked played and leaves the queue, through the listening store, with the time it finished
- [ ] Several episodes finished in one locked stretch are all handled, in the order they happened
- [ ] An episode marked unplayed on another device after it finished here stays unplayed, as ADR 1 says
- [ ] The library, the queue screen and the in-progress list are right as soon as the app is opened
- [ ] The web app shows the same once the phone has sent the changes
- [ ] Tests drive the whole app over the fake native bridge: finished episodes become played and leave the queue, in order, with their own times
- [ ] On the phone: after two episodes finish locked, the app and then the web app show both as played and out of the queue. Result recorded under `## Comments`

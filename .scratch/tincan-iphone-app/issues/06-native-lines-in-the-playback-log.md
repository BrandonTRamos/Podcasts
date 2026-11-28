# 06: Native lines in the playback log

**What to build:** On the iPhone app, the playback log in Settings records what native code saw, including what happened while the app was in the background, and says how the last run ended. With no Mac to attach to the phone, this log is the only evidence of a fault, so it comes before the tickets whose faults it will be needed for. (Spec: Playback log; stories 68 to 70, 72.)

**Blocked by:** 05

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] Native code records a line when playback starts, pauses, stalls, recovers and fails, when the app goes to the background and comes back, and when the audio session's state changes
- [ ] Every line names the episode it is about
- [ ] Lines recorded while JavaScript was paused appear in the log, in order, with the times they happened
- [ ] The log says how the last run ended: closed by the owner, ended by iOS, or crashed, as far as iOS tells
- [ ] The log is read and copied from Settings exactly as now, and keeps its current limit on size
- [ ] The web app's log is unchanged
- [ ] Tests drive the whole app over the fake native bridge: lines native code reports appear in Settings in order
- [ ] On the phone: after a few minutes locked, the copied log holds lines from the locked stretch. Result recorded under `## Comments`

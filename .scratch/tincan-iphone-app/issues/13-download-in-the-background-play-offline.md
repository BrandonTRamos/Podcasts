# 13: Download in the background, play offline

**What to build:** On the iPhone app, an episode downloads through iOS's background transfers, carries on with the phone locked, and then plays with no network. Start with an existing download plugin behind the downloads service; write our own Swift only if it fails on the phone. The downloads screen and removal are ticket 14. (Spec: Native downloads; stories 57 to 61, 64 to 67, 71.)

**Blocked by:** 05, 06, 12

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] The iPhone app's services hand the app a downloads service built on native code; the web app's is unchanged
- [ ] A download starts from the same control as on the web, and shows progress
- [ ] It carries on with the app in the background and the phone locked, and finishes there
- [ ] A dropped connection resumes by itself, keeping what was fetched
- [ ] A finished download shows the downloaded badge
- [ ] The file is kept in the app's own support directory: not in the Files app, not where iOS clears caches, not backed up to iCloud
- [ ] An episode from any host downloads directly; the fallback for blocked hosts is not used on the iPhone
- [ ] The player plays the stored copy whenever an episode has one, including for an episode already loaded from the stream
- [ ] A stored episode plays with no network, with seeking, any speed from 0.5x to 3x and lock-screen controls
- [ ] It plays with no network even when the session has expired
- [ ] A download starting, finishing and failing are each a line in the playback log
- [ ] Which plugin was used, or that our own was written and why, is recorded under `## Comments`
- [ ] Tests drive the whole app over the fake native bridge: start, progress, finish and resume show on screen, and the player is given the stored copy
- [ ] On the phone: a download finishes with the phone locked, then plays at 3x in airplane mode. Result recorded under `## Comments`

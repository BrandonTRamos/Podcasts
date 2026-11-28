# 14: Download management on the iPhone

**What to build:** On the iPhone app, the downloads screen and everything around a stored episode work as they do on the web: seeing what is stored, removing it, and trusting the badge. (Spec: Native downloads; stories 62, 63.)

**Blocked by:** 13

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] The downloads screen lists stored episodes and transfers in flight, with the sizes and the space used that the web app shows
- [ ] A transfer in flight can be cancelled, and nothing of it is left on the phone
- [ ] Removing a download frees its space
- [ ] The downloaded badge is checked at launch against what is really on the phone
- [ ] A download that finished while the app was not running is found at the next launch
- [ ] Transfers cut off by a force-quit resume on the next open
- [ ] Unsubscribing from a podcast removes its stored episodes, as on the web
- [ ] Each removal is a line in the playback log
- [ ] Tests drive the whole app over the fake native bridge: the list, cancel, remove and the check at launch
- [ ] On the phone: a download is removed and the space returns; a transfer cut off by a force-quit resumes. Result recorded under `## Comments`

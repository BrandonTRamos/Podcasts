# 08: iPhone streaming check

**What to build:** Nothing is built. The owner tests streaming on a real iPhone against the production URL. This is the spec's biggest risk, checked as early as the features allow. (Spec stories 41–45; spec "Manual check on a real iPhone".)

**Blocked by:** 02, 07

**Status:** ready-for-human

- [ ] TinCan installs to the home screen and opens standalone
- [ ] Playback continues with the screen locked for at least 10 minutes
- [ ] The lock screen shows artwork and title, and play, pause and skip work from it
- [ ] The queue advances to the next episode with the screen locked, at least twice in a row
- [ ] Headphone or Bluetooth buttons control playback
- [ ] After force-quitting the app, an episode resumes from where it was
- [ ] Results are recorded under a `## Comments` heading in this file
- [ ] Each failure is written up as a new ticket
- [ ] If locked-screen auto-advance cannot be made reliable, that is flagged for a decision on a native client

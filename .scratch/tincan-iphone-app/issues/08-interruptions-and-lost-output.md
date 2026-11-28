# 08: Interruptions and lost output

**What to build:** On the iPhone app, playback behaves as a podcast app should when something else wants the audio or the output goes away. In the web app the browser decided these; here they are TinCan's. (Spec: Native audio; stories 44 to 49.)

**Blocked by:** 05, 06

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] A phone call, Siri or an alarm pauses playback
- [ ] Afterwards playback carries on by itself when iOS says it should, and stays paused when iOS does not
- [ ] Unplugging headphones or losing Bluetooth pauses playback; it never moves to the speaker
- [ ] The silent switch does not mute playback
- [ ] Starting playback stops other apps' audio; the two are never mixed
- [ ] Spoken directions from a maps app pause playback while they speak, and it carries on after
- [ ] Nothing rewinds on resume
- [ ] The position is saved at each of these pauses
- [ ] Each interruption, each change of output and each resume is a line in the playback log
- [ ] On return, the app shows whether it is playing or paused, correctly
- [ ] Tests drive the whole app over the fake native bridge: a pause or resume that native code reports shows on screen and is saved
- [ ] On the phone: a call, an alarm, unplugged headphones and the silent switch each behave as above. Result recorded under `## Comments`

# 26: iPhone background playback check

**What to build:** Nothing is built. The owner tests playback in the background on a real iPhone against the production URL, with TinCan installed to the home screen, and copies the playback log from Settings after each check. (Spec stories 61–75; spec "Manual check on a real iPhone", in the background.)

**Blocked by:** 20, 21, 22, 23, 24, 25

**Status:** ready-for-human

- [ ] Press play on a stream and lock the phone at once: the episode starts by itself, or it does not. Which, and what the log says, is recorded
- [ ] If it does not start, pressing play on the lock screen starts it
- [ ] With the app just launched and nothing tapped, the log shows whether the last episode's file loaded
- [ ] Pressing play at launch starts the last episode within a moment
- [ ] An episode paused for ten minutes with the phone locked plays on from the lock screen, with sound, and without a fresh load
- [ ] After swiping the app away while it plays, the next launch's log line says the page was told
- [ ] After iOS closes the app in the background, the next launch's log line says how it ended
- [ ] With TinCan playing, swiping away only a native app leaves it playing
- [ ] With TinCan playing, swiping away only another installed web app: whether it stops is recorded, for the report to Apple
- [ ] The log's lines name the episode and the audio session's state
- [ ] Results are recorded under a `## Comments` heading in this file
- [ ] Each failure is written up as a new ticket: if iOS refuses the try at playing while hidden, a ticket to remove it (24); if iOS loads nothing before a tap, a ticket to remove the load at launch (25)

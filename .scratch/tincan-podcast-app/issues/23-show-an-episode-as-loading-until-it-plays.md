# 23: Show an episode as loading until it plays

**What to build:** From the moment the listener presses play until the episode's position first moves, the mini player and the now-playing screen show it as loading, so the listener knows it is not playing yet and does not put the phone away. Streams took 1.5 to 3.6 seconds to start in the log this came from. (Spec story 64; spec "In the background on iPhone", not playing yet.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] After play is pressed, the mini player and the now-playing screen show the episode as loading until its position first moves
- [ ] Once the position moves, they show it as playing
- [ ] The same shows when the player engine loads a file afresh by itself, and when a failed file is being tried again
- [ ] Pausing while it loads shows it as paused
- [ ] An episode playing on from a pause, whose position moves at once, shows no loading state worth seeing (no flicker)
- [ ] The loading state is told to assistive technology, not shown by look alone
- [ ] It comes from what the audio element already reports; nothing new is stored
- [ ] Client-seam tests cover loading then playing, pausing while loading, and a fresh load by the player engine

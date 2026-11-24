# 24: An episode iOS paused while loading waits, then plays

**What to build:** The listener presses play and locks the phone before the file has loaded. iOS pauses a file that has not yet produced sound when the app is hidden. Today the app takes that for an ordinary pause and stays silent until the listener comes back. Instead the episode is waiting to play: it shows as loading, the player engine tries once more when the file can play, and it starts when the app shows again or from the lock screen. (Spec stories 63, 65, 66, 67; spec "In the background on iPhone", paused by iOS while loading.)

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] A pause that arrives with the app hidden, without the player or an OS control having asked for it, on a file that has not got going, leaves the episode waiting to play, not paused
- [ ] While it waits, the mini player and the now-playing screen show it as loading, and the OS media controls are not told it is paused by the listener
- [ ] Once the file can play, the player engine tries to play it, once; if that is refused, the episode stays waiting
- [ ] It plays when the app shows again, whether iOS or the player engine starts it, and is not started twice
- [ ] Play on the lock screen plays it
- [ ] Pause, on the lock screen or in the app, makes it an ordinary pause
- [ ] Time spent waiting does not count as a long pause in the background: it is not loaded afresh for it
- [ ] A pause the listener asked for, and a pause on a file that had got going, behave as before
- [ ] Nothing is saved as the listener's place for a file that never got going
- [ ] The audio element fake can pause a file by itself as the page is hidden and play it again as the page shows; client-seam tests use it to cover waiting, the one further try, starting when shown, and play and pause on the lock screen
- [ ] The README's "In the background" section says what happens

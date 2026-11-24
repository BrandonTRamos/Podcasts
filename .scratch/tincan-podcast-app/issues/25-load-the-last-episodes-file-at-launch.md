# 25: Load the last episode's file at launch

**What to build:** The listener opens the app and presses play on the episode they were last on, and it starts within a moment. Today that episode's file loads nothing until it is played, so that a stored copy which turned up since is used. Its file now loads at launch, paused at the saved place, and a stored copy that appears later is still the one played. (Spec stories 68, 69; spec "In the background on iPhone", the last episode at launch.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] At launch, the last episode's file is loaded, paused at its saved place, from the stored copy if there is one and otherwise the stream
- [ ] The browser is asked for no more than the file's metadata
- [ ] Pressing play then plays it on without a fresh load
- [ ] If a stored copy has appeared since launch, pressing play plays from the copy, at the same place
- [ ] Seeking before it is played moves where it will start
- [ ] A file that fails to load before it is played shows no failure and saves nothing; it is loaded again when played
- [ ] Nothing is shown as playing or loading at launch, and the OS media controls show the episode paused
- [ ] A place saved on another device before it is played is still adopted
- [ ] Offline, with a stored copy, the launch and the play both work with no network
- [ ] Client-seam tests cover the load at launch, playing on without a fresh load, a stored copy that appeared since, and a load that fails before play; the existing last-episode tests are updated to match

## Comments

- This reverses the earlier choice to load nothing until played. Ticket 26 checks on the iPhone whether iOS loads anything before a tap; if it does not, this is taken out again.

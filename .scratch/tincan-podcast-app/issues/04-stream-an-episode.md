# 04: Stream an episode

**What to build:** The listener taps an episode and it plays, streamed straight from the publisher. They can pause, seek and skip, and a mini player stays with them while they browse. A now-playing screen gives the full controls. (Spec stories 25, 26, 27, 33, 34, 35.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Tapping an episode starts it streaming from the publisher's URL
- [ ] Play and pause work, and a seek bar shows elapsed time and duration
- [ ] Skip back moves 15 seconds and skip forward moves 30 seconds
- [ ] A mini player with title, artwork and play/pause stays visible on every screen while something is loaded
- [ ] A now-playing screen shows artwork and the full set of controls
- [ ] Starting another episode replaces the current one
- [ ] An episode that fails to load shows a clear message and leaves the app usable
- [ ] Playback uses a plain audio element, not the Web Audio API
- [ ] Client-seam tests cover these behaviours with a faked audio element

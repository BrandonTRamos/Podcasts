# 22: Play straight on after a long pause when the file is still loaded

**What to build:** The listener presses play on an episode paused long ago and it plays at once when its file is still loaded. Today it is always loaded afresh after a minute paused in the background, which costs seconds of silence and, on 2026-11-24, left an episode silent in a locked phone. The file is loaded afresh only when it is gone, or turns out stuck. (Spec stories 61, 62; spec "In the background on iPhone", playing on after a long pause.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] An episode paused in the background for a minute or more, whose audio element still holds enough of the file to play, is played on as it is, with no fresh load
- [ ] One whose audio element no longer holds enough to play is loaded afresh at once, at the same place, as now
- [ ] One played on that has not moved four seconds later is still loaded afresh, whoever pressed play
- [ ] An episode paused with the app in front still plays straight on, however long the pause
- [ ] The player engine's rescue line in the playback log is written only when a fresh load actually happens
- [ ] Client-seam tests cover a long pause with the file still loaded, a long pause with the file gone, and the stuck check after playing on; the existing long-pause tests are updated to match
- [ ] The README's "Playing on after a pause" matches

# 11: Show notes

**What to build:** The listener opens an episode and reads its show notes, with working links, before or while listening. (Spec story 18.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] An episode screen shows title, date, duration and show notes
- [ ] The episode can be played from that screen
- [ ] Show notes are sanitised before display: scripts, inline event handlers, frames and other active content are removed
- [ ] Links in show notes open outside the app and cannot reach back into it
- [ ] Plain-text show notes display readably, with line breaks kept
- [ ] An episode with no show notes shows a sensible empty state
- [ ] Client-seam tests include a fixture with hostile markup and assert that none of it survives

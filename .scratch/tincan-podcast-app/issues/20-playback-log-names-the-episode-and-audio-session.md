# 20: Playback log names the episode and the audio session

**What to build:** The owner reads the playback log and can tell which episode each line is about and what Safari's audio session was doing. Events that repeat and mean nothing by themselves no longer push the useful lines out, and a pause nobody asked for stands out. (Spec stories 70, 71, 74, 75; spec "In the background on iPhone", the playback log.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every line written while an episode is loaded names it by its ID; lines written with none loaded say so
- [ ] The log is told the episode by the player engine, not by reading the audio element; no feed or enclosure URL is ever logged
- [ ] Where the browser has an audio session, every line carries its state, read as the line is written, and `unknown` when the browser gives none
- [ ] A `stalled` line that directly follows another `stalled` line for the same episode is not added: the earlier line gains a count and the time of the latest
- [ ] The first `stalled` after any other line is always logged
- [ ] A pause that arrives without the player or an OS control having asked for it is marked with a line of its own, written by the player engine as its other rescue lines are
- [ ] The log still holds at most 300 lines and is written to the device as each line is recorded
- [ ] Log-seam tests cover the episode ID, the session state (present, and `unknown`), and repeats folded into a count
- [ ] A client-seam test covers the line for a pause nobody asked for
- [ ] The README's account of the playback log matches

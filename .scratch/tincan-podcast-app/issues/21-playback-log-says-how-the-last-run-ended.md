# 21: Playback log says how the last run ended

**What to build:** At each launch, the playback log says how the run before it ended, so that playback stopping without a word is a line in the log and not just a gap. It also says whether this launch restored the screens of a run iOS closed. (Spec stories 72, 73; spec "In the background on iPhone", the playback log.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] At launch, one line says how the last run ended, worked out from what that run left on the device: the last line it logged, and the place it kept while playing
- [ ] A run whose last word was the page going is reported as closed with the page told
- [ ] A run that was playing and left no such word is reported as ended without a word, with when it was last known to be playing and where
- [ ] A run that ended paused, or with nothing loaded, is reported as such and not as a silent stop
- [ ] A first launch, with no earlier run, logs no such line
- [ ] At launch, one line says whether the screens were restored from a run iOS closed
- [ ] Reading the place kept for this line does not take it: the next launch still picks up from it as before
- [ ] Log-seam tests cover a run that ended with the page told, one that ended without a word, and a first launch
- [ ] A client-seam test covers the line for restored screens

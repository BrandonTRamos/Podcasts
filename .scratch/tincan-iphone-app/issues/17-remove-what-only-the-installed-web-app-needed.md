# 17: Remove what only the installed web app needed

**What to build:** The web app stops carrying what existed only for the installed web app on iPhone, now that the iPhone app has replaced it. The web app on a desktop works exactly as before. (Spec: Order of work, step 5; stories 73, 74.)

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] The web's player loses the workarounds that exist only for iOS: the fresh load after a long pause in the background, the wait for a file iOS paused while loading, the try at playing while hidden, the load at launch held to metadata
- [ ] A workaround is removed only when no desktop browser needs it; where that is not known, it stays, and the reason is written beside it
- [ ] The pieces that exist only for adding TinCan to an iPhone home screen are removed
- [ ] Playback-log lines that only described iOS's handling of a web page are removed
- [ ] Kept, because the desktop uses them: the service worker and offline launch, the web's downloads, the fallback for blocked hosts, the keyboard and media-key controls
- [ ] Tests for removed behaviour are removed with it; every other test asserts what it asserted before
- [ ] The README says that listening on the iPhone is through the iPhone app, and no longer describes installing the web app there
- [ ] The pull request lists what was removed and what was kept, with the reason for each
- [ ] The web app is checked in a desktop browser after the deploy: an episode streams, the queue advances, a download plays offline
- [ ] `npm run check` is green

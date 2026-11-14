# 12: Unsubscribe and OPML import

**What to build:** The listener can remove a show from their library, and can bring in all their subscriptions from another podcast app by importing an OPML file. (Spec stories 9, 13.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] The listener can unsubscribe from a podcast, after confirming
- [ ] Unsubscribing removes the podcast, its episodes and their listening state, including any queue entries
- [ ] If an episode from that podcast is playing, playback stops
- [ ] Importing an OPML file subscribes to every feed in it
- [ ] Feeds already in the library are skipped
- [ ] The import ends with a summary of added, skipped and failed feeds
- [ ] A file that is not valid OPML shows a clear error
- [ ] A large import does not freeze the app, and podcasts appear as they are added
- [ ] Backend-seam tests cover unsubscribe; client-seam tests cover both flows

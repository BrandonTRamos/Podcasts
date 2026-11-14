# 03: Subscribe by feed URL

**What to build:** The listener pastes a podcast feed URL and subscribes. The podcast appears in their library with its artwork, and its episodes appear newest first. Subscribing returns at once; episodes show up as they are ingested. (Spec stories 8, 10, 11, 12, 14, 15, 17, 60.)

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Pasting a valid feed URL adds the podcast to the library with title, author and artwork
- [ ] Subscribing returns immediately, and episodes appear without a manual reload
- [ ] A podcast screen lists its episodes newest first, each with title, date and duration
- [ ] The first ingest takes only the most recent 100 episodes, and that cap is configurable
- [ ] An invalid, unreachable or non-feed URL shows a clear error and leaves no broken podcast in the library
- [ ] Subscribing to a feed already in the library says so and creates no duplicate
- [ ] Only http and https URLs are accepted
- [ ] Feed URLs are not written to logs
- [ ] Ingesting the same feed twice creates no duplicate episodes
- [ ] Feeds with missing durations, missing GUIDs (falling back to the enclosure URL), the iTunes namespace and malformed dates are all ingested
- [ ] Backend-seam tests invoke the handler with fixture feeds, faking only HTTP and the data store
- [ ] Client-seam tests cover subscribing, the error cases and browsing to a podcast's episodes

# 12: Unsubscribe and OPML import

**What to build:** The listener can remove a show from their library, and can bring in all their subscriptions from another podcast app by importing an OPML file. (Spec stories 9, 13.)

**Blocked by:** 03

**Status:** done

- [x] The listener can unsubscribe from a podcast, after confirming
- [x] Unsubscribing removes the podcast, its episodes and their listening state, including any queue entries
- [x] If an episode from that podcast is playing, playback stops
- [x] Importing an OPML file subscribes to every feed in it
- [x] Feeds already in the library are skipped
- [x] The import ends with a summary of added, skipped and failed feeds
- [x] A file that is not valid OPML shows a clear error
- [x] A large import does not freeze the app, and podcasts appear as they are added
- [x] Backend-seam tests cover unsubscribe; client-seam tests cover both flows

## Comments

- **Ingest parallelism:** `amplify/backend.ts` sets `parallelizationFactor: 4` on the subscribe-request stream mapping. Without it the stream handles one request at a time, so a large OPML import would be ingested feed by feed, taking minutes per dozen feeds. This applies to every subscribe, not just imports.
- **Per-feed deadline:** the client counts a feed as failed if its outcome hasn't arrived after 10 minutes (`FEED_DEADLINE_MS` in `src/opmlImport.ts`), so a request that never settles can't stop the import from finishing.
- **Not yet run against a real backend:** the `unsubscribe` function and mutation are covered only by the backend-seam tests with a fake store. They first run on AWS when this merges and deploys.

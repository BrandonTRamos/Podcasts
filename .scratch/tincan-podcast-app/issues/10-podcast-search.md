# 10: Podcast search

**What to build:** The listener searches for a podcast by name, sees matching shows with artwork, and subscribes to one in a single action, without ever handling a feed URL. (Spec stories 5, 6, 7.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Searching by name returns matching podcasts with title, author and artwork
- [ ] Subscribing from a result adds the podcast to the library, the same as subscribing by URL
- [ ] Results already in the library are marked as subscribed
- [ ] A search with no matches says so
- [ ] A directory failure shows a clear error and leaves the app usable
- [ ] Backend-seam tests invoke the search handler with the directory's HTTP responses faked
- [ ] Client-seam tests cover searching, subscribing from a result and the empty and error states

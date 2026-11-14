# 10: Podcast search

**What to build:** The listener searches for a podcast by name, sees matching shows with artwork, and subscribes to one in a single action, without ever handling a feed URL. (Spec stories 5, 6, 7.)

**Blocked by:** 03

**Status:** done

- [x] Searching by name returns matching podcasts with title, author and artwork
- [x] Subscribing from a result adds the podcast to the library, the same as subscribing by URL
- [x] Results already in the library are marked as subscribed
- [x] A search with no matches says so
- [x] A directory failure shows a clear error and leaves the app usable
- [x] Backend-seam tests invoke the search handler with the directory's HTTP responses faked
- [x] Client-seam tests cover searching, subscribing from a result and the empty and error states

## Comments

**2026-11-14 (agent):** Implemented on branch `ticket/10-podcast-search`.

- **Backend:** a `searchPodcasts` query (`search-podcasts` function, `amplify/directory/searchPodcasts.ts`) asks the iTunes Search API for up to 25 podcasts. It returns title, author, artwork and feed URL in the directory's order. Results with no http or https feed are dropped, a feed listed twice appears once, and a result whose normalised feed URL is in the library carries its podcast ID. A directory failure (unreachable, an error status, or an answer that isn't search results) returns `directoryUnavailable` rather than throwing, so it doesn't count as a function failure. Store errors are rethrown with URLs redacted.
- **Client:** a Search screen, opened from the library's Search button. Each result subscribes through the same `subscribe` mutation and background check as a pasted URL (the shared logic is in `src/subscribing.ts`), and shows "Subscribing…", then "Subscribed" with an Open button, or an error on that row. The listener never sees a feed URL.
- **Verified:** the real iTunes API response for "history of rome" has the fields the parser reads (`collectionName`, `artistName`, `feedUrl`, `artworkUrl600`). The search function was **not deployed to the sandbox**, and the Search screen was not tried live. Owner check: run `npm run sandbox` and `npm run dev`, search for a show, and subscribe to a result.
- **Known gaps:**
  - A show subscribed earlier by a URL that differs from the directory's (http instead of https, say) isn't marked as subscribed. Subscribing to it then reports `alreadySubscribed` only if the URLs match after normalisation.
  - Opening a podcast from the search results and going back lands on the library, not on the results.

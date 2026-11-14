# 03: Subscribe by feed URL

**What to build:** The listener pastes a podcast feed URL and subscribes. The podcast appears in their library with its artwork, and its episodes appear newest first. Subscribing returns at once; episodes show up as they are ingested. (Spec stories 8, 10, 11, 12, 14, 15, 17, 60.)

**Blocked by:** 01

**Status:** done

- [x] Pasting a valid feed URL adds the podcast to the library with title, author and artwork
- [x] Subscribing returns immediately, and episodes appear without a manual reload
- [x] A podcast screen lists its episodes newest first, each with title, date and duration
- [x] The first ingest takes only the most recent 100 episodes, and that cap is configurable
- [x] An invalid, unreachable or non-feed URL shows a clear error and leaves no broken podcast in the library
- [x] Subscribing to a feed already in the library says so and creates no duplicate
- [x] Only http and https URLs are accepted
- [x] Feed URLs are not written to logs
- [x] Ingesting the same feed twice creates no duplicate episodes
- [x] Feeds with missing durations, missing GUIDs (falling back to the enclosure URL), the iTunes namespace and malformed dates are all ingested
- [x] Backend-seam tests invoke the handler with fixture feeds, faking only HTTP and the data store
- [x] Client-seam tests cover subscribing, the error cases and browsing to a podcast's episodes

## Comments

**2026-11-14 (agent):** Implemented on branch `ticket/03-subscribe-by-feed-url`.

- **Design:** `subscribe` checks the feed with one synchronous fetch, adds the podcast, then starts the async `refreshPodcast` mutation, which ingests episodes in the background. This differs from the spec's "fully asynchronous" wording; the reasons are in `docs/adr/0001-subscribe-checks-the-feed-before-returning.md`.
- **Episode cap:** `EPISODE_LIMIT` is 100, set in `amplify/functions/refresh-podcast/resource.ts`. It applies to every refresh, not only the first: each run looks at the newest 100 items in the feed. Ticket 09 may revisit this.
- **Brought forward from ticket 09:** a failed refresh records `lastFetchError`, and the podcast screen shows it when there are no episodes, so it never shows "Fetching episodes…" forever. `etag` and `lastModified` are stored but not yet sent with requests. `refreshPodcast` can also be called by the signed-in user.
- **Verified live in the sandbox** by invoking the subscribe Lambda with this repo's fixture feed:
  - subscribing, a repeat subscribe and a non-feed URL each return the right outcome;
  - episodes are ingested in the background through AppSync;
  - no feed URL appears in either function's logs, and AppSync logging is off.

  The test records were deleted afterwards.
- **Not observed live:** episodes arriving in an open browser. It needs the owner signed in. The client-seam test covers it with the faked data API. Owner check: run `npm run dev` against the sandbox, subscribe to a feed, and watch episodes appear on the podcast screen.
- **Known gap:** two subscribes to the same new URL sent at the same moment could both pass the duplicate check. This is acceptable for a single user.

**2026-11-14 (agent), PR review fix round 1:** This supersedes the "Design" and "Brought forward from ticket 09" points above.

- **Subscribe now returns at once**, as the spec asks.
  - The `subscribe` mutation does no fetching. It refuses URLs that are not http or https, says if the feed is already in the library, and otherwise records a pending `SubscribeRequest` and returns it.
  - The request table's DynamoDB stream triggers `ingest-feed`. That function fetches and checks the feed. A bad feed marks the request `unreachable`, `notAFeed` or `failed`, and nothing is added to the library. A good feed adds the podcast, marks the request `subscribed`, then ingests the newest 100 episodes.
  - The client watches the request through a data subscription. It shows "Checking the feed…", then opens the podcast or shows the error.
  - Requests expire after a day (DynamoDB time to live).
  - ADR 0001 is removed.
- **Ticket 09 scope removed:**
  - recording a failed refresh and showing it;
  - the `lastFetchedAt`, `lastFetchError`, `etag` and `lastModified` fields;
  - the user-callable `refreshPodcast` mutation.

  A podcast with no episodes shows "No episodes yet."
- **Re-verified live in the sandbox** with the repo's fixture feed. These calls returned at once, and the background step then set the request's status:

  | Feed URL | Returned at once | Request status | Library |
  |---|---|---|---|
  | Fixture feed | `pending` | `subscribed` | Podcast added with 2 episodes |
  | Web page | `pending` | `notAFeed` | Nothing added |
  | Unresolvable `.invalid` host | `pending` | `unreachable` | Nothing added |

  `ftp://` gave `invalidUrl` at once, and subscribing again gave `alreadySubscribed`. The ingest function ran once per new request and not for updates or deletes. Time to live is enabled, no feed URL appears in either function's logs, and AppSync logging is off. The test records were deleted afterwards.
- **Still not observed live:** the browser receiving the request outcome and new episodes. It needs the owner signed in. The client-seam tests cover it with the faked data API. Owner check: run `npm run dev` against the sandbox and subscribe to a feed.

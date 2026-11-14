# 09: Automatic refresh and feed health

**What to build:** New episodes turn up without the listener doing anything. They can also refresh a podcast on demand, see when each feed last refreshed and whether it failed, and browse one list of the latest episodes across all subscriptions. (Spec stories 16, 21, 22, 23.)

**Blocked by:** 03

**Status:** done

- [x] Every subscribed feed is refreshed hourly with no action from the listener
- [x] New episodes appear in the app without a manual reload
- [x] An unchanged feed is detected with a conditional request and causes no writes
- [x] An episode whose audio URL changed in the feed is updated, not duplicated
- [x] One failing feed does not stop the others, and the failure is recorded against that podcast
- [x] A podcast screen shows when it last refreshed and whether the last attempt failed
- [x] A podcast can be refreshed on demand
- [x] A latest-episodes screen lists episodes from all subscriptions, newest first
- [x] Backend-seam tests cover an unchanged feed, a failing feed, a changed audio URL and a feed with thousands of episodes
- [x] Client-seam tests cover manual refresh, the health display and the latest-episodes list

## Comments

**2026-11-14 (agent):** Implemented on branch `ticket/09-automatic-refresh-and-feed-health`.

- **Refresher** (`refresh-feeds` function, `amplify/feeds/refreshFeeds.ts`): EventBridge Scheduler runs it hourly for every podcast. The async `refreshPodcast` mutation runs it for one podcast. It sends a conditional GET using the stored `etag`/`lastModified`. A changed feed's newest 100 items are upserted: new episodes are added, and changed ones (such as a new audio URL) are updated under the same ID. The podcast's version and `lastFetchedAt` are written last, so a run that fails part-way refetches the feed in full next time. Feeds are fetched 5 at a time. A failing feed records `lastFetchError` once and the run carries on. An unexpected failure is recorded as `failed`, and the run fails once the other podcasts are done. Lambda's async retries are off, so the next hourly run is the retry.
- **Decision to check, "causes no writes":** I read this literally. A 304 writes nothing, so "Last refreshed" (`lastFetchedAt`) is the last time the feed was fetched in full. For a feed whose host supports ETag or Last-Modified, that is roughly when it last changed. The screen adds "checked hourly". Showing the time of the last check instead would cost one podcast write per feed per hour (about 36k a month for 50 feeds).
- **On-demand refresh** returns at once. The screen shows "Checking for new episodes…" until a new result arrives, or for 30 s, because an unchanged feed sends nothing back.
- **Latest episodes:** each episode has a constant `listing` field and a date index (`listEpisodesByDate`), capped at 50 and newest first. Undated episodes are left out. Episodes stored before this change join the index the first time a refresh looks at them, but only those still in their feed's newest 100 items.
- **Verified live in the sandbox** with this repo's fixture feed served from GitHub, which sends an ETag:
  - subscribing stored the ETag and put the episodes in the date index;
  - the hourly run got a 304 and wrote nothing;
  - an unreachable feed recorded `unreachable`, the other podcast was untouched, and a repeat failure wrote nothing more;
  - the on-demand event refreshed one podcast;
  - no feed URL appeared in the logs;
  - the `refreshPodcast` resolver invokes the function with `Event` (async), and the schedule is `cron(0 */1 * * ? *)`.

  The test records were deleted afterwards.
- **Not observed live:** the browser side (health display, Refresh button, Latest screen). It needs the owner signed in. The client-seam tests in `src/FeedRefresh.test.tsx` cover it.

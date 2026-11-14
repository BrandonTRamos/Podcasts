# Subscribe checks the feed before returning

**Status:** accepted (ticket 03)

The spec says subscribe is asynchronous: "the operation returns at once, the work runs in the background, and the client learns the outcome through data subscriptions." Ticket 03 also asks that an invalid, unreachable or non-feed URL "shows a clear error and leaves no broken podcast in the library."

**Decision:** the `subscribe` mutation does one synchronous fetch and parse of the feed (15-second timeout) before it creates the podcast. It returns an outcome (`subscribed`, `alreadySubscribed`, `invalidUrl`, `unreachable`, `notAFeed`). Ingesting the episodes, the slow part on large feeds, runs in the background through the async `refreshPodcast` mutation, and episodes reach the client through data subscriptions.

**Why:** the error comes back with the request, and a podcast only exists once its feed has been shown to work. The fully asynchronous alternative creates a pending podcast first and deletes it if the feed fails. The library would briefly show broken entries, and the client would need extra state to report the failure.

**Cost:** subscribe takes as long as one feed fetch (usually about a second) instead of returning instantly, and a feed is fetched twice on subscribe.

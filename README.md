# TinCan

A single-user podcast web app. React + TypeScript client (Vite), AWS Amplify Gen 2 backend (Cognito, AppSync + DynamoDB). See `.scratch/tincan-podcast-app/spec.md`.

**Live:** https://main.d1s9jkcv1hp6j9.amplifyapp.com (production, AWS Amplify Hosting app `TinCan`, id `d1s9jkcv1hp6j9`, us-east-1)

## Prerequisites

- Node 22 (`.nvmrc`) and npm
- AWS credentials for your account configured on this machine (`aws sts get-caller-identity` should succeed)

```sh
npm install
```

`npm install` runs `scripts/repair-lockfile.cjs` afterwards. Some Amplify packages publish inconsistent bundles, which leave npm 10's lockfile out of sync with what `npm ci` expects; the script writes npm's own resolved tree back to `package-lock.json`. Commit the lockfile it leaves.

## Start the sandbox (backend)

Each developer gets a personal cloud sandbox: a private copy of the backend in your AWS account.

```sh
npm run sandbox                  # deploy, then watch amplify/ and redeploy on change
npx ampx sandbox --once          # deploy once and exit
npx ampx sandbox delete          # tear it down
```

Deploying writes `amplify_outputs.json` at the repo root. The client reads it at startup. It is git-ignored.

## Create the owner's account

Sign-up is disabled, so the one account is created by an admin. After the sandbox is deployed:

```sh
POOL=$(node -p 'require("./amplify_outputs.json").auth.user_pool_id')
read -r -p 'Email: ' EMAIL
read -r -s -p 'Password: ' PASSWORD; echo

aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$EMAIL" \
  --password "$PASSWORD" --permanent
unset PASSWORD
```

The password needs at least 8 characters with upper case, lower case, a number and a symbol. `--permanent` matters: the app has no "set a new password" screen.

## Run the app locally

With the sandbox deployed:

```sh
npm run dev
```

Open the printed URL and sign in.

## Checks

```sh
npm run lint        # oxlint
npm run typecheck   # client, Vite config and amplify/ backend
npm test            # all tests, once
npm run check       # all three
npm run test:watch  # tests in watch mode
```

## Tests

Two seams, one per deployable, run as two Vitest projects (`vitest.config.ts`):

- **client** (`src/**/*.test.{ts,tsx}`, jsdom): renders `<App>` and drives it as a user would with Testing Library. The UI talks to the backend only through the `Services` interface in `src/services.ts`; tests pass in-memory fakes from `src/test/fakes.ts`, and production passes `amplifyServices()`.
- **backend** (`amplify/**/*.test.ts`, node): invokes function handlers with an event. Real network access is refused by `amplify/test/setup.ts`. Tests fake outbound HTTP with `fakeHttp` and the data store with `fakeFeedStore` (both in `amplify/test/fakes.ts`; the fake store also plays the request table's stream), and use fixture feeds from `amplify/test/fixtures/`. The fake HTTP answers conditional requests with 304 as a real server would. The download stager's tests use `amplify/test/stagingFakes.ts` instead: a fake audio host that streams files made only as they are read, a fake staging store and a fake bucket. Handlers are built by factories in `amplify/feeds/`, `amplify/directory/` and `amplify/downloads/` that take the store (and, for the stager, the bucket); `amplify/functions/*/handler.ts` wires in the real ones (`amplifyFeedStore.ts` and `amplifyStagingStore.ts`, the AppSync data API; `s3StagingBucket.ts`, S3).

`amplify/alerts/alerts.test.ts` (backend project) synthesizes the alerts into a CloudFormation template with the CDK's `Template` assertions and checks the budget, the alarms and the email subscription; it deploys nothing.

`src/installable.test.ts` (client project) checks what a browser reads to install the app to a home screen: the manifest, the `<head>` tags and the icon files in `public/`. `src/appShell.test.ts` (client project) drives the service worker's install, activate and fetch events, with a fake Cache Storage and network, rather than rendering `<App>`.

## Feeds

Subscribing returns at once and finishes in the background; the client learns the outcome through data subscriptions.

- **Subscribe** (`subscribe` mutation, `amplify/feeds/subscribe.ts`): refuses URLs that are not http or https, says if the feed is already in the library, and otherwise records a pending `SubscribeRequest` and returns it. Requests expire after a day (DynamoDB time to live).
- **Ingest** (`ingest-feed` function, `amplify/feeds/ingestFeed.ts`): triggered by the `SubscribeRequest` table's stream for each new request (wired in `amplify/backend.ts`, up to 4 requests at once). It fetches and parses the feed. A bad feed marks the request `unreachable`, `notAFeed` or `failed`, and nothing is added to the library. A good feed adds the podcast, marks the request `subscribed`, then ingests the newest `FIRST_INGEST_EPISODE_LIMIT` episodes (100; set in `amplify/functions/ingest-feed/resource.ts`). Episode IDs derive from the podcast and the item's GUID (or enclosure URL), so ingesting the same feed again creates no duplicates.
- The client (`src/LibraryScreen.tsx`) shows "Checking the feed…" while the request is pending, then opens the podcast or shows the error.
- **Refresh** (`refresh-feeds` function, `amplify/feeds/refreshFeeds.ts`): EventBridge Scheduler runs it every hour for every podcast, and the `refreshPodcast` mutation runs it for one podcast (invoked asynchronously, so the mutation returns at once). Each feed is fetched with a conditional GET (`If-None-Match` / `If-Modified-Since` from the stored `etag` / `lastModified`); a feed the server says is unchanged is written nothing. A changed feed's newest `EPISODE_LIMIT` items (the same 100) are stored: new episodes are added, and an episode whose audio URL (or any other field) changed is updated in place under the same ID. Then the podcast's details, version and `lastFetchedAt` are written. A failing feed records `lastFetchError` on its podcast (once, not every hour) and the run carries on; an unexpected failure is recorded as `failed` and makes the run fail after the others are done.
- **Latest episodes**: every episode carries `listing: 'latest'` (`amplify/data/latestEpisodes.ts`), so one index query (`listEpisodesByDate`, sorted on `publishedAt`) gives the newest across all podcasts. Undated episodes are left out of it. Episodes stored before this index existed are added to it the first time a refresh looks at them.
- The podcast screen shows when the feed last refreshed, whether the latest attempt failed, and a Refresh button. The library's Latest screen lists the 50 newest episodes across all subscriptions.
- **Unsubscribe** (`unsubscribe` mutation, `unsubscribe` function, `amplify/feeds/unsubscribe.ts`): deletes the podcast's listening states (queue places with them), then its episodes, then the podcast, then sweeps once more for any written meanwhile (a failure in that last sweep is logged, not reported, since the podcast is already gone). The podcast goes last, so one that fails part-way stays in the library and unsubscribing again finishes the job. Unsubscribing from a podcast already gone succeeds. A missing or blank podcast ID is refused before anything is listed, since without it the data API would drop the filter and match every record. The client's podcast screen asks to confirm first, then stops an episode of the podcast that is playing (so it saves no position meanwhile), and once done forgets its listening state on the device and returns to the library.
- **OPML import** (client only, `src/opml.ts`, `src/opmlImport.ts`): the library's "Import OPML file" reads every outline with an `xmlUrl` (at any depth, each feed once) and subscribes to each through the `subscribe` mutation, 4 at a time, so a long file neither holds up the app nor floods the backend. Podcasts appear as each is added; the import carries on while the listener uses other screens. A feed whose outcome hasn't arrived after 10 minutes counts as failed, so the import always finishes. It ends with a count of added, skipped (already in the library) and failed feeds, naming the failed ones. A file over 5 MB is refused unread, and one that isn't well-formed XML with an `<opml>` root is refused with an error.
- Feed URLs are secrets: handlers never log them, and unexpected errors are logged and rethrown with URLs redacted.

## Search

- **Search** (`searchPodcasts` query, `search-podcasts` function, `amplify/directory/searchPodcasts.ts`): asks the iTunes Search API (no key needed) for up to 25 podcasts matching the term, and returns each one's title, author, artwork and feed URL, in the directory's order. Results with no http or https feed are left out. A result whose feed URL is already in the library carries that podcast's ID. If the directory can't be reached or gives no usable answer, the query returns `directoryUnavailable` rather than failing.
- **Top shows** (`topPodcasts` query, `top-podcasts` function, `amplify/directory/topPodcasts.ts`): reads one of Apple's podcast charts (no key needed), for one genre or over all, and returns up to 50 podcasts, most popular first, in the same shape as a search. The chart names its podcasts without their feeds, so they are then looked up in one request: two requests to the directory for each chart, which is kept for an hour while the function stays warm. What is in the library is checked every time. The charts are the US ones (`CHART_COUNTRY`). The genres are Apple's top-level podcast genres, listed in `amplify/directory/genres.ts` and as the schema's `DirectoryGenre` enum, and named for the listener in `src/SearchScreen.tsx`. The chart endpoint (`/us/rss/toppodcasts/…/json`) is Apple's old RSS generator, which still answers but is no longer documented; if it goes, the query returns `directoryUnavailable` and search carries on working.
- The client's Search screen (`src/SearchScreen.tsx`, the Search tab) opens on the top shows over all, with a row of genres to browse. A search shows its results in place of the chart, and clearing the search goes back to the chart last browsed. Subscribing to a show from either goes through the same `subscribe` mutation as a pasted URL, with the result's feed URL, which the listener never sees. Results in the library show "Subscribed" and open the podcast.
- **Episode search** (client, `src/PodcastScreen.tsx`): the podcast screen's "Search episodes" box filters the list as it is typed to the titles with every word. A word matches from the start of a word, in any order, ignoring case, accents and apostrophes (`amplify/feeds/matchWords.ts`, shared with the backend). It searches only what the library has, the feed's newest 100 episodes, so it works offline. The words are kept while the listener visits one of the podcast's episodes.
- **Older episodes** (`searchEpisodes` query, `search-episodes` function, `amplify/feeds/searchEpisodes.ts`): "Search older episodes" under the list (or the keyboard's search key) fetches the podcast's feed afresh and searches all of it, titles and show notes (markup left out), returning the newest 50 matches without their notes, and whether there were more. Nothing is stored, so a feed of thousands still keeps only its newest. A feed that can't be fetched returns `feedUnavailable` rather than failing. It finds only what the feed still lists: some publishers trim theirs.
- **Keeping one** (`keepEpisode` mutation, `keep-episode` function, `amplify/feeds/keepEpisode.ts`): "Add" on a match fetches the feed again and stores that one episode, show notes included, under the same ID an ingest would give it. It is then an episode like any other (it plays, resumes, queues, downloads, and goes when the podcast is unsubscribed), listed with the podcast's episodes by date. Refreshes never remove it, but they look only at the feed's newest 100, so a later change to an older episode (a moved audio file, say) is not picked up.

## Offline

- **App shell** (`src/appShell.ts`, built to `/sw.js` from `src/serviceWorker.ts` by the plugin in `vite.config.ts`): a service worker, registered in production builds only, stores the page, every built script and style, and the files in `public/` when it installs. Pages come from the network while it answers in time and from the stored shell when it fails or keeps the page waiting two seconds (as on a phone just woken); the other shell files always come from the store. Each build's shell has its own version, and a new worker drops the old one's files.
- **Local copy** (`src/localCopy.ts`): the data API as the UI sees it keeps the last podcasts, latest episodes, and each opened podcast's episodes and listening state, plus the queue, in device storage (`localStorage`, under `tincan.device.`). Each list shows the copy at once, then the backend's answer. With no network the copy stands, and the list starts observing again once the browser says it is online. Signing out clears it.
- **Unsynced changes** (`src/listening.ts`): a position, played state or queue change that can't be saved waits on the device, through relaunches, and is sent again when the network comes back. An episode's changes go one at a time, oldest first, so a later one can't make an earlier one lose. Each save carries when the change was made (`changedAt` on `EpisodeState`); the update is conditional, so the backend keeps it only if it holds no change made later. The most recent change wins, by the devices' clocks, even when an older one made offline arrives after it (see `docs/adr/0001-most-recent-listening-change-wins.md`).
- **Sign-in**: a session that has expired with no network to renew it opens the app on the local copy, with no sign-in prompt; downloaded episodes play. Once online it is renewed, or, if it can't be, the app asks to sign in again and syncs once signed in.
- While offline the app says so, and episodes that aren't downloaded show as not available.
- **Download fallback** (`stageDownload` mutation, `stage-download` function, `amplify/downloads/stageDownload.ts`): when a publisher's host blocks direct download (no CORS), the client (`src/downloads.ts`) asks the backend for a temporary copy and shows "Preparing download…". The mutation returns at once (invoked asynchronously); the function streams the episode's own enclosure (http or https only) into a private S3 bucket in 8 MB parts, never holding it whole, and records a presigned link (1 hour) on a `DownloadStaging` record. The client watches that record by subscription, and reads it every 10 seconds in case an update is missed. A copy cut short by the host is not kept. The client then downloads, resumes and verifies the copy as it would the original; while its link works, a resume goes straight to the copy, and a link refused early is replaced by a fresh copy without asking. The bucket (made in `amplify/backend.ts`) blocks public access and allows the app's origins (production and `localhost:5173`) by CORS. The same function runs hourly and deletes copies over 23 hours old, so none outlasts a day; a 1-day lifecycle rule is the backstop. Staging records expire after a day. The client gives up after 16 minutes without an answer.

## In the background

iOS suspends an installed web app soon after it goes to the background unless it is playing, drops its network, and may close it outright and load it afresh when the listener comes back. None of that can be stopped from a web page; the app is built to lose nothing by it.

- **Playing on after a pause** (`src/player.ts`): a file paused with the app in the background for a minute or more is loaded afresh, at the same place, when played again, as iOS lets go of its connection there. One played again that has not moved four seconds later is loaded afresh too, whoever pressed play.
- **A file that fails**: one that had been playing keeps its place and is tried again after 1, 4 and 10 seconds, at once if the network or the listener comes back first, and is shown as failed only after that. One that fails while paused is loaded again when next played. Play on the lock screen tries a failed episode again.
- **The place** (`src/keptPlace.ts`): while an episode plays, where it has got to is kept on the device every five seconds, between the saves to the backend (one a minute). If the app is closed while playing, the next launch saves that place, as the change made when it was kept.
- **The screen** (`src/SignedInApp.tsx`): the screens the listener is on are kept while the app is hidden. A launch that follows, with the app never having shown again, opens on them; any other opens on the library.
- **Behind a locked screen**: the OS media controls are told the position only when the OS would otherwise have it wrong (play, pause, a seek, a change of speed, drift), and the app draws nothing of the position moving on until it shows again.
- **The playback log** (`src/playbackLog.ts`, Settings): what the audio element, the page and the player did lately, for working out what went wrong on a lock screen. It keeps 300 lines, each written to the device as it is recorded. Every line ends with the episode loaded, by its ID, as the player engine told it (`ep=none` when none is; no feed or enclosure URL goes in), and, where the browser has an audio session, that session's state as the line is written (`unknown` when the browser gives none). A `stalled` line straight after another for the same episode is not added: the one before gains a count and the time of the latest. The player writes a line of its own for a pause nobody asked for (neither the app nor an OS control), as it does for each rescue. At each launch it says how the run before ended (the page told it was going; ended without a word, with when and where it was last known to be playing; or paused or with nothing loaded), from that run's last line and the place it kept, and whether the screens were restored from a run iOS closed.

## Pipeline

There is one environment: `main` is production. Development uses the sandbox above. Work lands by pull request; nothing is committed to `main` directly.

- **CI** (GitHub Actions, `.github/workflows/ci.yml`): on every pull request and every push to `main`, runs `npm ci`, fails if that rewrote `package-lock.json`, then runs `npm run check` (lint, typecheck, tests) and `npm run build`. Any failure marks the check red.
- **CD** (AWS Amplify Hosting, `amplify.yml`): Amplify Hosting is connected to this repo's `main` branch. Every push to `main` (a merged pull request) starts a build that:
  1. runs the same lockfile check, `npm run check` and a trial `npm run build`. If either fails, the build stops and **nothing is deployed**, backend or frontend;
  2. deploys the backend (`npx ampx pipeline-deploy`, CloudFormation), which writes `amplify_outputs.json` for this build;
  3. builds the frontend against it and publishes `dist/`.

  Only `main` is connected. Do not connect other branches or turn on pull-request previews: each connected branch deploys its own backend.

  Build logs: AWS console → Amplify → TinCan → `main` → Deployments.

No secrets or personal details live in the repo; the alert address is an Amplify environment variable (see Alerts). Amplify reaches GitHub through its GitHub App, and builds run as the IAM role `AmplifyBackendDeploy-TinCan` (AWS managed policy `AmplifyBackendDeployFullAccess`).

## Alerts

Defined in `amplify/alerts/alerts.ts`, added to the backend at the end of `amplify/backend.ts`, and deployed by the pipeline with the rest of the backend. Both alerts email the owner through one SNS topic (`TinCan alerts`) with one email subscription.

- **Cost**: an AWS Budget emails when the account's actual spend this month passes **5 US dollars**. It watches the whole account, not only TinCan's resources.
- **Failures**: one CloudWatch alarm per backend function emails when it fails **2 or more times within 3 hours** (the function's `Errors` metric, in fixed 3-hour windows, so the hourly refresh failing three runs in a row always alerts). Every function made with `defineFunction` gets one (whether listed in `defineBackend` or only referenced by the data schema), so a function added later is covered with no further change. Amplify's own internal functions are not watched. The email names the function; its logs are in CloudWatch.

Configuration, read when the backend is synthesized (for the pipeline: AWS console → Amplify → TinCan → Hosting → Environment variables (older consoles: App settings → Environment variables), then redeploy `main`):

| Variable | Required | What |
| --- | --- | --- |
| `TINCAN_ALERT_EMAIL` | yes, for the pipeline | Address the alerts go to. Never committed. A pipeline deploy without it fails, so production never runs unwatched. |
| `TINCAN_MONTHLY_BUDGET_USD` | no | Cost alert threshold in US dollars. Default `5`. |

AWS emails a confirmation to `TINCAN_ALERT_EMAIL` after the first deploy that sets it (and again whenever the address changes). Nothing is delivered until the owner clicks **Confirm subscription** in it.

To change the failure threshold, edit `FAILURE_ALERT` (`failures`, `withinHours`) in `amplify/alerts/alerts.ts` and merge.

A sandbox gets no alerts unless `TINCAN_ALERT_EMAIL` is set in the shell that runs `npm run sandbox`; if it is, the sandbox gets its own copy of both alerts (a second budget on the same account).

## Create the owner's account in production

Same as for the sandbox, against the production user pool. Fetch the production outputs into a temporary folder (not the repo root, which holds the sandbox's):

```sh
APP_ID=d1s9jkcv1hp6j9
npx ampx generate outputs --app-id "$APP_ID" --branch main --out-dir /tmp/tincan-prod
POOL=$(node -p 'require("/tmp/tincan-prod/amplify_outputs.json").auth.user_pool_id')
```

Then run the `read`/`aws cognito-idp` commands from "Create the owner's account" above.

## Roll back to a previous commit

**Lasting rollback (preferred):** revert the bad commit(s) through a pull request. Merging it redeploys backend and frontend through the normal, checked pipeline.

```sh
git switch -c revert-<sha> origin/main
git revert <sha>              # a merged PR: git revert -m 1 <merge-sha>
git push -u origin HEAD && gh pr create --fill
```

**Immediate rollback:** redeploy a known-good commit while the revert is reviewed. It runs the same checks, then deploys that commit's backend and frontend. The next push to `main` deploys `main` again, so follow up with the revert above.

```sh
APP_ID=d1s9jkcv1hp6j9
aws amplify list-jobs --app-id "$APP_ID" --branch-name main --max-items 10 \
  --query 'jobSummaries[].[jobId,status,commitId,commitMessage]' --output table
aws amplify start-job --app-id "$APP_ID" --branch-name main --job-type RELEASE \
  --commit-id <good-sha> --commit-message "Roll back to <good-sha>"
```

The same is in the console: Amplify → TinCan → `main` → Deployments → pick a successful deployment → **Redeploy this version**.

Rolling back the backend reverts its CloudFormation resources. It does not restore data: if the bad commit removed a table or field, the data in it is gone.

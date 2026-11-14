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
- **backend** (`amplify/**/*.test.ts`, node): invokes function handlers with an event. Real network access is refused by `amplify/test/setup.ts`. Tests fake outbound HTTP with `fakeHttp` and the data store with `fakeFeedStore` (both in `amplify/test/fakes.ts`; the fake store also plays the request table's stream), and use fixture feeds from `amplify/test/fixtures/`. The fake HTTP answers conditional requests with 304 as a real server would. Handlers are built by factories in `amplify/feeds/` and `amplify/directory/` that take the store; `amplify/functions/*/handler.ts` wires in the real one (`amplifyFeedStore.ts`, the AppSync data API).

`src/installable.test.ts` (client project) checks what a browser reads to install the app to a home screen: the manifest, the `<head>` tags and the icon files in `public/`.

## Feeds

Subscribing returns at once and finishes in the background; the client learns the outcome through data subscriptions.

- **Subscribe** (`subscribe` mutation, `amplify/feeds/subscribe.ts`): refuses URLs that are not http or https, says if the feed is already in the library, and otherwise records a pending `SubscribeRequest` and returns it. Requests expire after a day (DynamoDB time to live).
- **Ingest** (`ingest-feed` function, `amplify/feeds/ingestFeed.ts`): triggered by the `SubscribeRequest` table's stream for each new request (wired in `amplify/backend.ts`, up to 4 requests at once). It fetches and parses the feed. A bad feed marks the request `unreachable`, `notAFeed` or `failed`, and nothing is added to the library. A good feed adds the podcast, marks the request `subscribed`, then ingests the newest `FIRST_INGEST_EPISODE_LIMIT` episodes (100; set in `amplify/functions/ingest-feed/resource.ts`). Episode IDs derive from the podcast and the item's GUID (or enclosure URL), so ingesting the same feed again creates no duplicates.
- The client (`src/LibraryScreen.tsx`) shows "Checking the feed…" while the request is pending, then opens the podcast or shows the error.
- **Refresh** (`refresh-feeds` function, `amplify/feeds/refreshFeeds.ts`): EventBridge Scheduler runs it every hour for every podcast, and the `refreshPodcast` mutation runs it for one podcast (invoked asynchronously, so the mutation returns at once). Each feed is fetched with a conditional GET (`If-None-Match` / `If-Modified-Since` from the stored `etag` / `lastModified`); a feed the server says is unchanged is written nothing. A changed feed's newest `EPISODE_LIMIT` items (the same 100) are stored: new episodes are added, and an episode whose audio URL (or any other field) changed is updated in place under the same ID. Then the podcast's details, version and `lastFetchedAt` are written. A failing feed records `lastFetchError` on its podcast (once, not every hour) and the run carries on; an unexpected failure is recorded as `failed` and makes the run fail after the others are done.
- **Latest episodes**: every episode carries `listing: 'latest'` (`amplify/data/latestEpisodes.ts`), so one index query (`listEpisodesByDate`, sorted on `publishedAt`) gives the newest across all podcasts. Undated episodes are left out of it. Episodes stored before this index existed are added to it the first time a refresh looks at them.
- The podcast screen shows when the feed last refreshed, whether the latest attempt failed, and a Refresh button. The library's Latest screen lists the 50 newest episodes across all subscriptions.
- **Unsubscribe** (`unsubscribe` mutation, `unsubscribe` function, `amplify/feeds/unsubscribe.ts`): deletes the podcast's listening states (queue places with them), then its episodes, then the podcast, then sweeps once more for any written meanwhile (a failure in that last sweep is logged, not reported, since the podcast is already gone). The podcast goes last, so one that fails part-way stays in the library and unsubscribing again finishes the job. Unsubscribing from a podcast already gone succeeds. The client's podcast screen asks to confirm first, then stops an episode of the podcast that is playing (so it saves no position meanwhile), and once done forgets its listening state on the device and returns to the library.
- **OPML import** (client only, `src/opml.ts`, `src/opmlImport.ts`): the library's "Import OPML file" reads every outline with an `xmlUrl` (at any depth, each feed once) and subscribes to each through the `subscribe` mutation, 4 at a time, so a long file neither holds up the app nor floods the backend. Podcasts appear as each is added; the import carries on while the listener uses other screens. A feed whose outcome hasn't arrived after 10 minutes counts as failed, so the import always finishes. It ends with a count of added, skipped (already in the library) and failed feeds, naming the failed ones. A file that isn't well-formed XML with an `<opml>` root is refused with an error.
- Feed URLs are secrets: handlers never log them, and unexpected errors are logged and rethrown with URLs redacted.

## Search

- **Search** (`searchPodcasts` query, `search-podcasts` function, `amplify/directory/searchPodcasts.ts`): asks the iTunes Search API (no key needed) for up to 25 podcasts matching the term, and returns each one's title, author, artwork and feed URL, in the directory's order. Results with no http or https feed are left out. A result whose feed URL is already in the library carries that podcast's ID. If the directory can't be reached or gives no usable answer, the query returns `directoryUnavailable` rather than failing.
- The client's Search screen (`src/SearchScreen.tsx`, from the library's Search button) lists the results. Subscribing to one goes through the same `subscribe` mutation as a pasted URL, with the result's feed URL, which the listener never sees. Results in the library show "Subscribed" and open the podcast.

## Pipeline

There is one environment: `main` is production. Development uses the sandbox above. Work lands by pull request; nothing is committed to `main` directly.

- **CI** (GitHub Actions, `.github/workflows/ci.yml`): on every pull request and every push to `main`, runs `npm ci`, fails if that rewrote `package-lock.json`, then runs `npm run check` (lint, typecheck, tests) and `npm run build`. Any failure marks the check red.
- **CD** (AWS Amplify Hosting, `amplify.yml`): Amplify Hosting is connected to this repo's `main` branch. Every push to `main` (a merged pull request) starts a build that:
  1. runs the same lockfile check, `npm run check` and a trial `npm run build`. If either fails, the build stops and **nothing is deployed**, backend or frontend;
  2. deploys the backend (`npx ampx pipeline-deploy`, CloudFormation), which writes `amplify_outputs.json` for this build;
  3. builds the frontend against it and publishes `dist/`.

  Only `main` is connected. Do not connect other branches or turn on pull-request previews: each connected branch deploys its own backend.

  Build logs: AWS console → Amplify → TinCan → `main` → Deployments.

No secrets live in the repo. Amplify reaches GitHub through its GitHub App, and builds run as the IAM role `AmplifyBackendDeploy-TinCan` (AWS managed policy `AmplifyBackendDeployFullAccess`).

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

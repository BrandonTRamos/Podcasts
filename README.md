# TinCan

A single-user podcast web app. React + TypeScript client (Vite), AWS Amplify Gen 2 backend (Cognito, AppSync + DynamoDB). See `.scratch/tincan-podcast-app/spec.md`.

**Live:** _pending: set once the Amplify Hosting app is connected (ticket 02)._

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
- **backend** (`amplify/**/*.test.ts`, node): invokes function handlers with an event. Real network access is refused by `amplify/test/setup.ts`; a test fakes outbound HTTP with `vi.stubGlobal('fetch', ...)`.

`src/installable.test.ts` (client project) checks what a browser reads to install the app to a home screen: the manifest, the `<head>` tags and the icon files in `public/`.

## Pipeline

There is one environment: `main` is production. Development uses the sandbox above. Work lands by pull request; nothing is committed to `main` directly.

- **CI** (GitHub Actions, `.github/workflows/ci.yml`): on every push and every pull request, runs `npm ci`, `npm run check` (lint, typecheck, tests) and `npm run build`. Any failure marks the check red.
- **CD** (AWS Amplify Hosting, `amplify.yml`): Amplify Hosting is connected to this repo's `main` branch. Every push to `main` (a merged pull request) starts a build that:
  1. runs `npm run check` and a trial `npm run build`. If either fails, the build stops and **nothing is deployed**, backend or frontend;
  2. deploys the backend (`npx ampx pipeline-deploy`, CloudFormation), which writes `amplify_outputs.json` for this build;
  3. builds the frontend against it and publishes `dist/`.

  Only `main` is connected. Do not connect other branches or turn on pull-request previews: each connected branch deploys its own backend.

  Build logs: AWS console → Amplify → TinCan → `main` → Deployments.

No secrets live in the repo. Amplify reaches GitHub through its GitHub App, and builds run as the IAM role `AmplifyBackendDeploy-TinCan` (AWS managed policy `AmplifyBackendDeployFullAccess`).

## Create the owner's account in production

Same as for the sandbox, against the production user pool. Fetch the production outputs into a temporary folder (not the repo root, which holds the sandbox's):

```sh
APP_ID=$(aws amplify list-apps --query "apps[?name=='TinCan'].appId" --output text)
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
APP_ID=$(aws amplify list-apps --query "apps[?name=='TinCan'].appId" --output text)
aws amplify list-jobs --app-id "$APP_ID" --branch-name main --max-items 10 \
  --query 'jobSummaries[].[jobId,status,commitId,commitMessage]' --output table
aws amplify start-job --app-id "$APP_ID" --branch-name main --job-type RELEASE \
  --commit-id <good-sha> --commit-message "Roll back to <good-sha>"
```

The same is in the console: Amplify → TinCan → `main` → Deployments → pick a successful deployment → **Redeploy this version**.

Rolling back the backend reverts its CloudFormation resources. It does not restore data: if the bad commit removed a table or field, the data in it is gone.

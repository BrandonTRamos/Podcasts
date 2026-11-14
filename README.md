# TinCan

A single-user podcast web app. React + TypeScript client (Vite), AWS Amplify Gen 2 backend (Cognito, AppSync + DynamoDB). See `.scratch/tincan-podcast-app/spec.md`.

## Prerequisites

- Node 22 and npm
- AWS credentials for your account configured on this machine (`aws sts get-caller-identity` should succeed)

```sh
npm install
```

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

- **client** (`src/**/*.test.tsx`, jsdom): renders `<App>` and drives it as a user would with Testing Library. The UI talks to the backend only through the `Services` interface in `src/services.ts`; tests pass in-memory fakes from `src/test/fakes.ts`, and production passes `amplifyServices()`.
- **backend** (`amplify/**/*.test.ts`, node): invokes function handlers with an event. Real network access is refused by `amplify/test/setup.ts`; a test fakes outbound HTTP with `vi.stubGlobal('fetch', ...)`.

# 02: CI/CD pipeline

**What to build:** Every push and pull request is checked automatically, and every merge to `main` deploys the whole app to production. The owner can open TinCan at a live HTTPS address, sign in, and install it to a home screen. (Spec: Delivery section; story 41.)

**Blocked by:** 01

**Status:** ready-for-agent

**Human step:** authorising the hosting service's connection to the GitHub repo in the AWS console, and creating the owner's account in production. Stop and say exactly what is needed when you reach these.

- [x] Lint, typecheck and tests run on every push and every pull request, and a failure marks the check red
- [ ] A push to `main` deploys both backend and frontend to production
- [x] A commit that fails the checks is not deployed
- [ ] The app is reachable at a live HTTPS URL and sign-in works there
- [ ] The app is installable: name and short name are "TinCan", with a tin-can-and-string icon
- [ ] Launched from a home screen, it opens standalone without browser chrome
- [x] No secrets or credentials are committed to the repo
- [x] The README records the live URL, how the pipeline works and how to roll back to a previous commit

## Comments

**2026-11-14 (agent):** Code and config done on branch `ticket/02-ci-cd-pipeline`. Stopped at the human step.

- CI verified: the branch's run is green, and a throwaway branch with a deliberately failing test went red at "Lint, typecheck, test" (run 43613014241; branch since deleted).
- Deploy gate: `amplify.yml` runs `npm run check` and a trial build before `ampx pipeline-deploy`, so a failing commit deploys neither half. Not yet exercised live: there is no Amplify app yet.
- Installability: `src/installable.test.ts` covers the manifest (name and short name "TinCan", `display: standalone`), the iOS meta tags and the icon sizes.
- Prepared: IAM role `AmplifyBackendDeploy-TinCan` (AWS managed policy `AmplifyBackendDeployFullAccess`) for Amplify builds.
- **Blocked on the owner:** connect the repo in the Amplify console (see the PR description). Then the agent sets the build spec, deploys `main`, fills in the live URL, and the owner creates the production account and signs in. The remaining criteria stay unticked until verified live.

**2026-11-14 (agent):** The owner connected the repo. Amplify app `TinCan` (`d1s9jkcv1hp6j9`, us-east-1), branch `main` (production), auto-build on, pull-request previews off, service role `AmplifyBackendDeploy-TinCan`. Live: https://main.d1s9jkcv1hp6j9.amplifyapp.com

- Job 1 (the console's first build, of `main` at 8da9310, ticket 01 code, console default spec) deployed the backend stack and the frontend. The live bundle points at the production user pool. Admin-only sign-up is on, and the pool has 0 users.
- Deploy gate verified on Amplify's own build image. Amplify clones only the connected branch, so a release of an off-branch commit fails at clone (jobs 2 and 3 on `main`, harmless). Instead, the failing-test probe commit was connected as a temporary Amplify branch with auto-build off. Its build ran `nvm install` (Node 22 from `.nvmrc`) and `npm ci`, then failed at `npm run check`. `pipeline-deploy` never ran, and no stack was created. The temporary Amplify branch and GitHub branch are deleted. Production was unchanged: same stack, same page.
- README now has the live URL and the app id. A second, empty app also named `TinCan` (no branches) exists from the console, so the README uses the id rather than looking the app up by name.
- Still open:
  - "push to `main` deploys both": the merge of this PR is the first push-triggered build through `amplify.yml`.
  - Sign-in at the live URL: needs the owner's production account.
  - Installable and standalone: the PWA files reach production only with the merge; standalone needs an iPhone.

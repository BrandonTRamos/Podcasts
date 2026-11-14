# 02: CI/CD pipeline

**What to build:** Every push and pull request is checked automatically, and every merge to `main` deploys the whole app to production. The owner can open TinCan at a live HTTPS address, sign in, and install it to a home screen. (Spec: Delivery section; story 41.)

**Blocked by:** 01

**Status:** ready-for-agent

**Human step:** authorising the hosting service's connection to the GitHub repo in the AWS console, and creating the owner's account in production. Stop and say exactly what is needed when you reach these.

- [x] Lint, typecheck and tests run on every push and every pull request, and a failure marks the check red
- [ ] A push to `main` deploys both backend and frontend to production
- [ ] A commit that fails the checks is not deployed
- [ ] The app is reachable at a live HTTPS URL and sign-in works there
- [ ] The app is installable: name and short name are "TinCan", with a tin-can-and-string icon
- [ ] Launched from a home screen, it opens standalone without browser chrome
- [x] No secrets or credentials are committed to the repo
- [ ] The README records the live URL, how the pipeline works and how to roll back to a previous commit

## Comments

**2026-11-14 (agent):** Code and config done on branch `ticket/02-ci-cd-pipeline`. Stopped at the human step.

- CI verified: the branch's run is green, and a throwaway branch with a deliberately failing test went red at "Lint, typecheck, test" (run 43613014241; branch since deleted).
- Deploy gate: `amplify.yml` runs `npm run check` and a trial build before `ampx pipeline-deploy`, so a failing commit deploys neither half. Not yet exercised live: there is no Amplify app yet.
- Installability: `src/installable.test.ts` covers the manifest (name and short name "TinCan", `display: standalone`), the iOS meta tags and the icon sizes.
- Prepared: IAM role `AmplifyBackendDeploy-TinCan` (AWS managed policy `AmplifyBackendDeployFullAccess`) for Amplify builds.
- **Blocked on the owner:** connect the repo in the Amplify console (see the PR description). Then the agent sets the build spec, deploys `main`, fills in the live URL, and the owner creates the production account and signs in. The remaining criteria stay unticked until verified live.

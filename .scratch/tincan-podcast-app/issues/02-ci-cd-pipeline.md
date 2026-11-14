# 02: CI/CD pipeline

**What to build:** Every push and pull request is checked automatically, and every merge to `main` deploys the whole app to production. The owner can open TinCan at a live HTTPS address, sign in, and install it to a home screen. (Spec: Delivery section; story 41.)

**Blocked by:** 01

**Status:** ready-for-agent

**Human step:** authorising the hosting service's connection to the GitHub repo in the AWS console, and creating the owner's account in production. Stop and say exactly what is needed when you reach these.

- [ ] Lint, typecheck and tests run on every push and every pull request, and a failure marks the check red
- [ ] A push to `main` deploys both backend and frontend to production
- [ ] A commit that fails the checks is not deployed
- [ ] The app is reachable at a live HTTPS URL and sign-in works there
- [ ] The app is installable: name and short name are "TinCan", with a tin-can-and-string icon
- [ ] Launched from a home screen, it opens standalone without browser chrome
- [ ] No secrets or credentials are committed to the repo
- [ ] The README records the live URL, how the pipeline works and how to roll back to a previous commit

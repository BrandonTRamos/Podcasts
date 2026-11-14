# 01: Walking skeleton

**What to build:** The owner runs TinCan locally, signs in with their one account, and lands on an empty library. They can sign out. The backend runs in a personal cloud sandbox. The project has lint, typecheck and a test setup at both seams from the spec, so every later ticket has somewhere to put its tests. (Spec stories 1–4.)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Human step:** needs AWS credentials configured on this machine, and the owner's account created in the sandbox. If either is missing, stop and say exactly what is needed.

- [ ] A sign-in screen is shown to a signed-out visitor
- [ ] Valid credentials lead to an empty library screen
- [ ] There is no sign-up option in the UI, and self-sign-up is disabled in the backend
- [ ] The session survives a page reload
- [ ] Signing out returns to the sign-in screen
- [ ] The data API rejects unauthenticated requests
- [ ] Lint, typecheck and test commands exist and pass
- [ ] A client-seam test drives the UI through sign-in to the empty library, faking only the data API
- [ ] The backend test setup is in place so ticket 03 can add handler tests without further setup
- [ ] The README explains how to run the app locally, start the sandbox and run the checks

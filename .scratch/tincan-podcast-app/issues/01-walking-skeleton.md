# 01: Walking skeleton

**What to build:** The owner runs TinCan locally, signs in with their one account, and lands on an empty library. They can sign out. The backend runs in a personal cloud sandbox. The project has lint, typecheck and a test setup at both seams from the spec, so every later ticket has somewhere to put its tests. (Spec stories 1–4.)

**Blocked by:** None (can start immediately)

**Status:** done

**Human step:** needs AWS credentials configured on this machine, and the owner's account created in the sandbox. If either is missing, stop and say exactly what is needed.

- [x] A sign-in screen is shown to a signed-out visitor
- [x] Valid credentials lead to an empty library screen
- [x] There is no sign-up option in the UI, and self-sign-up is disabled in the backend
- [x] The session survives a page reload
- [x] Signing out returns to the sign-in screen
- [x] The data API rejects unauthenticated requests
- [x] Lint, typecheck and test commands exist and pass
- [x] A client-seam test drives the UI through sign-in to the empty library, faking sign-in and the data API
- [x] The backend test setup is in place so ticket 03 can add handler tests without further setup
- [x] The README explains how to run the app locally, start the sandbox and run the checks

## Comments

**2026-11-14 (agent):** Code, sandbox and checks done on branch `ticket/01-walking-skeleton`. Stopped at the human step.

- Sandbox deployed. Verified live: Cognito refuses sign-up ("SignUp is not permitted for this user pool"), the identity pool allows no guest identities, and AppSync returns `UnauthorizedException` with no token or a bogus one.
- **Blocked on the owner:** the sandbox user pool has no users. Create the owner's account (README, "Create the owner's account"), then sign in at `npm run dev`, reload, and sign out. Tick the three unticked criteria once that works.
- **Deviation:** the client-seam test fakes auth as well as the data API, through the `Services` interface in `src/services.ts`. Using real Amplify Auth in jsdom would mean faking Cognito's SRP exchange on the wire. Suggest the spec says "only the backend (auth and data API)" instead.

**2026-11-14 (agent):** The owner created the sandbox account and confirmed in the running app that sign-in reaches the empty library, the session survives a reload, and sign-out returns to sign-in. Those three are ticked. The client-seam criterion is unticked: the test fakes auth as well as the data API, so it does not meet "faking only the data API" as written. The owner still has to decide on the deviation, so the status stays `ready-for-agent`.

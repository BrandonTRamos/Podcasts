# 15: Stay signed in on the iPhone

**What to build:** On the iPhone app, signing in once is enough. The sign-in tokens are kept in native storage that iOS does not clear, so losing web storage never signs the owner out. (Spec: Sign-in and local data; stories 11 to 13, 66.)

**Blocked by:** 05

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] On the iPhone app, sign-in tokens are kept in native storage, the keychain for preference, reached through the native bridge
- [ ] The owner is still signed in after a relaunch, after an update from TestFlight, and after web storage has been emptied
- [ ] Signing out removes the tokens from the phone
- [ ] With no network and an expired session, the app still opens to the library and plays stored episodes, as now
- [ ] The web app's sign-in is unchanged
- [ ] Which storage was used, and why if not the keychain, is recorded under `## Comments`
- [ ] Tests drive the whole app over the fake native bridge: signed in after a relaunch with web storage emptied; signed out after signing out
- [ ] On the phone: signed in after a force-quit and after installing a newer build. Result recorded under `## Comments`

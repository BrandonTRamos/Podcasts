# 01: iPhone pipeline skeleton

**What to build:** The existing web app, unchanged in what it does, bundled inside a native shell, built and signed in the cloud with no Mac, and installed on the owner's iPhone through TestFlight. No native audio or downloads yet: playback is still the web player. This proves the toolchain end to end and is kept. (Spec: Shape, Delivery; stories 1 to 4.)

**Blocked by:** none

**Status:** ready-for-agent

**Human steps:** in Apple's developer and App Store Connect portals: accept any pending agreements, register the bundle ID, create the app record, create the App Store Connect API key, create the signing certificate and profile, add the owner as an internal tester. On the phone: install TestFlight and the build. In GitHub: create the `iphone-release` environment and put the secrets in it. Stop and say exactly what is needed at each. A script that walks the owner through them is welcome.

- [ ] The repo has a native iPhone project: name TinCan, bundle ID `com.brandontramos.tincan`, the tin-can icon, iPhone only, minimum iOS 27
- [ ] The iPhone build bundles the web code and leaves out the service worker, the home-screen install pieces and the new-version banner; the web build is unchanged
- [ ] Every pull request gets an unsigned compile-only iPhone build that uses no secrets, and a compile failure marks it red
- [ ] A push to `main` produces a signed build and uploads it to TestFlight
- [ ] The owner can start a signed build by hand from `main` or a `ticket/*` branch; nothing on `pull_request` can reach the secrets
- [ ] A scheduled build keeps a TestFlight build inside the 90-day expiry
- [ ] Signing secrets are in the `iphone-release` environment, limited to `main` and `ticket/*`; nothing Apple-related is committed
- [ ] The owner installs the build from TestFlight on the iPhone, opens it, signs in and sees the library
- [ ] The web app's deploy still works and `npm run check` is green
- [ ] The README records how the iPhone pipeline works, what was done by hand, and how to renew the certificate and key when they expire
- [ ] Recorded under `## Comments`: whether the native project can be synced on Linux or only on the runner, how the certificate was made without a Mac, how long a clean build takes, and how long from push to installable on the phone

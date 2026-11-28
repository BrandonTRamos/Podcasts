# TinCan: iPhone app

Status: ready-for-agent

Tickets 01, 03 and 12 can start now. Everything from 05 on is gated on ticket 02: see "Order of work".

Vocabulary: see `CONTEXT.md` (**Web app**, **iPhone app**, **Installed web app**, **Listening state**, **Listening change**, **Playback log**). ADR 1 (the most recent listening change wins) applies unchanged.

## Problem Statement

I listen mostly on my iPhone, and there TinCan is an installed web app. iOS decides when a web page may play, load and stay alive in the background. Tickets 19 to 26 of the first spec were all spent working round that: downloads that do not finish, episodes paused while loading, the page closed when other installed web apps are swiped away, playback ending with nothing logged. A web page cannot fix these.

I have joined the Apple Developer Program as an individual. I want TinCan on my iPhone as a real app, so that playback and downloads are as reliable there as in any podcast app.

This reverses one line of the first spec's Out of Scope ("wrapping it in a native shell"). The rest of that spec stands.

## Solution

The iPhone app shows the same screens as the web app, from the same code, inside a native shell. Two things are different on the iPhone: audio is played by native code, and downloads are fetched and kept by native code. Everything else (library, search, queue, show notes, settings, sign-in, sync) is the existing app.

The web app stays as my desktop client. Both talk to the same backend, and my listening state follows me between them as it does now.

The app is for my phone only. It is built in the cloud, because I have no Mac, and reaches my phone through TestFlight.

The first version does what TinCan does today and nothing more. It is done when the checks the installed web app could not pass reliably pass on the iPhone app, on my phone.

## User Stories

### Getting it onto the phone

1. As the owner, I want the iPhone app built and signed in the cloud, so that I need no Mac.
2. As the owner, I want every merge to `main` to build the iPhone app and deliver it to my phone, so that both clients move together without my doing anything.
3. As the owner, I want to build a ticket branch and install it on my phone before it is merged, so that native code is tried on a real device first.
4. As the owner, I want every pull request to compile the iPhone app, so that a Swift mistake shows before merge and not on my phone.
5. As the owner, I want the app to keep opening past TestFlight's 90-day build expiry without my remembering, so that it never stops working on a morning I want it.
6. As the owner, I want my Apple signing credentials out of reach of anyone else's code, so that the public repo cannot be used to sign as me.
7. As the owner, I want nothing Apple-related committed to the repo, so that a key cannot leak through its history.
8. As the owner, I want the manual Apple steps written down, with how to renew what expires, so that I can repeat them in a year.
9. As the owner, I want the app named TinCan with the tin-can icon on my home screen, so that it is the same app I know.
10. As the owner, I want the build to cost nothing beyond the developer programme fee, so that TinCan still costs close to nothing to run.

### Signing in

11. As the owner, I want to sign in with my one account as now, so that there is nothing new to set up.
12. As the owner, I want to stay signed in across launches, updates and weeks of not opening the app, so that iOS clearing web storage never signs me out.
13. As the owner, I want to sign out, so that I can remove access from the phone.

### The same app

14. As a listener, I want every screen the web app has (library, latest, podcast, episode, queue, search, downloads, settings), so that nothing is missing on the phone.
15. As a listener, I want subscribing, searching, categories, favourites, show notes and chapters to work as they do in the web app, so that I do not learn a second app.
16. As a listener, I want a change to the web app to reach the iPhone app with the same merge, so that the two never drift apart.
17. As a listener, I want the app to open and show my library with no network, so that I can reach my downloads on a flight.
18. As a listener, I want the app to open at once from its own files, so that a slow network never holds up launch.
19. As a desktop listener, I want the web app to work exactly as it does today, so that the iPhone app costs me nothing there.

### Playback

20. As a listener, I want to tap an episode and have it stream, so that listening starts as it does now.
21. As a listener, I want an episode to keep playing with the phone locked for as long as it runs, so that I can listen with the phone in my pocket.
22. As a listener, I want pressing play and locking the phone at once to still start the episode, so that I need not watch it load.
23. As a listener, I want an episode paused for a long time with the phone locked to play on at once from the lock screen, so that a long pause costs nothing.
24. As a listener, I want swiping other apps away to leave TinCan playing, so that tidying the app switcher does not stop my podcast.
25. As a listener, I want play, pause, seek, skip back and skip forward in the app to act at once, so that the controls feel as they do now.
26. As a listener, I want any speed from 0.5x to 3x, on streams and on downloaded episodes, so that nothing is lost against the web app.
27. As a listener, I want my speed and skip intervals remembered, so that I do not set them every episode.
28. As a listener, I want an episode to resume where I left off, so that I never hunt for my place.
29. As a listener, I want an episode shown as loading until sound comes out, so that I know it is on its way.
30. As a listener, I want a stream that drops to pick up again by itself when the network returns, keeping my place, so that a tunnel does not end the episode.
31. As a listener, I want a clear message when an episode's file cannot be played, so that I know it is the publisher's file and not my app.
32. As a listener, I want the mini player and the now-playing screen to show the true position after the phone has been locked, so that what I see matches what I heard.

### Queue

33. As a listener, I want the next queued episode to start by itself with the phone locked, every time, so that the queue never stalls.
34. As a listener, I want the queue to run through several episodes in a row while locked, so that a long drive needs no touching.
35. As a listener, I want a queue change made while the app is open to take effect for locked playback at once, so that the phone plays what I lined up.
36. As a listener, I want skipping to the next episode to keep my place in the one I left, so that I can come back to it.
37. As a listener, I want my queue the same on the phone and the desktop, so that it is one queue.

### Lock screen and controls

38. As a listener, I want the lock screen to show artwork, episode title and podcast, so that I can see what is playing.
39. As a listener, I want play, pause, skip back, skip forward and a scrubber on the lock screen, so that I can control playback without unlocking.
40. As a listener, I want the lock screen's skip buttons to move by the intervals I chose in Settings, so that they match the app.
41. As a listener, I want a next button on the lock screen when something is queued, so that I can move on without unlocking.
42. As a listener, I want headphone and Bluetooth buttons to control playback, so that I can use my usual controls.
43. As a listener, I want the same controls in Control Centre, so that I can reach them from anywhere.

### Interruptions

44. As a listener, I want playback to pause for a phone call, Siri or an alarm, so that I miss nothing.
45. As a listener, I want it to carry on afterwards when iOS says it should, so that I do not have to restart it.
46. As a listener, I want playback to pause when headphones are unplugged or Bluetooth drops, so that it never spills onto the speaker.
47. As a listener, I want TinCan to play with the silent switch on, so that the switch does not mute a podcast.
48. As a listener, I want TinCan starting to stop other apps' audio, so that two things never play over each other.
49. As a listener, I want spoken directions from a maps app to pause TinCan while they speak, so that I miss neither.

### Listening state

50. As a listener, I want my position kept through an hour of locked listening, so that my place is never lost whatever iOS does to the app.
51. As a listener, I want my position kept if iOS ends the app or the battery dies mid-episode, so that the worst case costs me seconds.
52. As a listener, I want episodes that finished while the phone was locked to be marked played and to leave the queue, so that the library is right when I look.
53. As a listener, I want what I did on the phone to reach my other devices as soon as the app is able to send it, and at the latest when I next open it, so that the desktop catches up.
54. As a listener, I want a position saved on the desktop to be picked up when I open the phone, so that I carry on from the later one.
55. As a listener, I want what I listened to offline to be sent when the network returns, so that nothing is lost.
56. As a listener, I want an hour of locked listening not to be undone by an older change from another device, so that the later listening wins.

### Downloads

57. As a traveller, I want to download an episode to the phone, so that I can play it with no network.
58. As a traveller, I want a download to carry on when I lock the phone or switch apps, so that I need not hold the app open.
59. As a traveller, I want to see download progress, so that I know when it is safe to leave.
60. As a traveller, I want an interrupted download to resume by itself, so that a dropped connection wastes nothing.
61. As a traveller, I want downloads kept where iOS will not clear them, so that an episode is still there days later on the flight.
62. As a traveller, I want the downloaded badge, the downloads screen and removal to work as they do now, so that nothing has to be relearned.
63. As a traveller, I want removing a download to free the space, so that the phone does not fill.
64. As a traveller, I want a downloaded episode to play with no network, with seeking, speed and lock-screen controls, so that offline feels like streaming.
65. As a traveller, I want an episode from any host to download directly, so that no host is a special case on the phone.
66. As a traveller, I want offline playback to work even if my session has expired, so that a sign-in prompt cannot block me in the air.
67. As a listener, I want a playing episode to use its downloaded copy when it has one, so that a download is never wasted.

### Diagnosing

68. As the owner, I want the playback log to stay in Settings and be copied out as now, so that I can report a fault from the phone alone.
69. As the owner, I want the log to record what the native side saw (interruptions, output changes, stalls, errors, the app going to the background), so that a fault in my pocket leaves evidence.
70. As the owner, I want the log to say how the last run ended, including iOS ending the app, so that a silent stop is explained.
71. As the owner, I want the log to record each download starting, finishing and failing, so that a missing episode can be traced.
72. As the owner, I want every line to name the episode it is about, so that the log reads without guessing.

### Retiring the installed web app

73. As the owner, I want the installed web app to keep working until the iPhone app has passed its checks, so that I am never without a way to listen.
74. As the owner, I want the code that exists only for the installed web app on iPhone removed afterwards, so that the web app carries no workarounds nobody runs.
75. As the owner, I want episodes I had downloaded in the installed web app to be simply downloaded again, so that no migration is built for a one-off.

### Deciding whether to go on

76. As the owner, I want native audio proved on my phone before anything is built on it, so that a dead end costs two small tickets.
77. As the owner, I want to know whether writing Swift with no Mac is tolerable before committing to it, so that I can change course early.

## Implementation Decisions

### Shape

- One repo, one codebase, two clients. The iPhone app is a native shell (Capacitor) around the same built files as the web app. The native project and the Swift code live in this repo.
- The web code is bundled inside the app, not loaded from the live site.
- The iPhone build leaves out the service worker, the home-screen install pieces and the new-version banner. None of them apply inside the shell.
- Display name TinCan. Bundle ID `com.brandontramos.tincan`. The existing tin-can icon.
- iPhone only, iOS 27 as the minimum. No iPad layout.
- The backend is unchanged: no new data models, functions or API fields.

### Seams

- **The services the app is given** stay the one place where a client differs. Today they hand the app a raw audio element and the browser's media-session controls. They change to hand it a **player** and a **downloads** service instead, each with one interface and two implementations: the web's, built from what exists, and the iPhone's, built on native code. Screens cannot tell which they have.
- **The native bridge** is the one new seam: a single interface through which the iPhone implementations reach native code. It covers audio, downloads, the stored listening changes, playback-log lines and sign-in token storage. Nothing else in the app touches native code.
- The app asks which client it is only where the services are assembled, and for the three pieces the iPhone build leaves out. No platform checks in screens.

### Player

- The player's interface changes in one way that both implementations follow: instead of being asked for the next episode at the moment one ends, it is told the upcoming queue whenever that changes. The web's player keeps that list and takes from it; the iPhone's hands it to native code.
- The web's player keeps all its current behaviour and its browser workarounds. None of them move to the iPhone's.
- Lock-screen controls belong to the web's player on the web, as now, and to native code on the iPhone.
- The iPhone's player reports the same state to the screens as the web's: episode, position, length, playing, loading, failed, speed, skip intervals.

### Native audio

- TinCan owns its native audio code: a small Swift plugin in this repo around Apple's queue player. No community or paid audio plugin. Playback is the whole reason for this effort, so it is not left to a dependency that cannot be steered.
- Native code holds the current episode and the upcoming queue, and advances by itself. It never waits for JavaScript.
- Speed 0.5x to 3x, on remote files and stored ones alike.
- Lock screen and remote commands: play, pause, skip back and forward by the intervals from Settings, next when something is queued, seek. Artwork, episode title, podcast title.
- Audio session: spoken-audio playback, not mixed with other audio, ignores the silent switch.
- Interruptions: pause, and resume only when iOS says to. Output lost (headphones, Bluetooth): pause. No rewind on resume.
- A queue change made on another device while the phone is locked is not seen until the app's JavaScript next runs. Accepted.

### Listening changes while locked

- Assume JavaScript in the shell is paused whenever the app is in the background, whatever the spike measures. Nothing that must happen while locked may depend on it.
- Native code writes each listening change to durable storage on the phone as it happens, with the time it happened: position at intervals and at every pause, episode finished, next episode started.
- Whenever JavaScript runs, the iPhone's player takes those changes and passes them to the listening store, each with its own time. The listening store already accepts a change reported late with the time it was made, and ADR 1 already orders such changes correctly. Nothing new on the backend.
- A finished episode is marked played and leaves the queue through that same path, exactly as it does on the web.
- Native code does not talk to the backend. If the delay before the desktop catches up proves annoying, that is a later ticket.

### Native downloads

- Background transfers by iOS, which carry on while the app is suspended.
- Start with an existing Capacitor download plugin behind the downloads service. Write our own only if it fails on the phone: the Swift written without a compiler goes to audio first.
- Files are kept in the app's own support directory: not visible in the Files app, not in a cache iOS may clear, not backed up to iCloud.
- Native audio is given the stored file's location directly.
- The download fallback for blocked hosts is not used on the iPhone: native requests are not subject to the browser rule that made it necessary. It stays for the web app.
- Force-quitting the app cancels transfers in flight. They resume on the next open. Accepted.
- Which episodes are downloaded stays device-local, as now. Episodes downloaded in the installed web app are not carried over.

### Sign-in and local data

- Same single Cognito account, same password sign-in.
- Sign-in tokens are kept in native storage iOS does not clear (the keychain for preference), not in web storage.
- The cached library that makes offline launch work stays in web storage: it can be rebuilt.
- Offline playback with an expired session still works, as now.

### Playback log

- Stays, and stays the main way to diagnose the iPhone app: there is no Mac to attach to the phone.
- Native code writes into the same log, including lines for what happened while JavaScript was paused. Copied from Settings as now.
- Part of the first version, not an extra.

### Delivery

- Builds run on GitHub Actions macOS runners. The repo stays public, which makes them free.
- Pull requests: an unsigned compile-only build with no secrets.
- Signed builds: on push to `main`, on a schedule, and when the owner starts one by hand from `main` or a `ticket/*` branch. Never on `pull_request`. Outsiders can neither push branches to this repo nor start a workflow by hand, so no outside code reaches signing.
- Signing secrets live in a GitHub environment, `iphone-release`, limited to `main` and `ticket/*`. The App Store Connect API key has the narrowest role that can upload builds.
- Delivery to the phone is TestFlight internal testing: no App Review, no device registration. The scheduled build keeps one inside the 90-day expiry.
- The build number comes from the workflow run, so every upload is accepted without editing a file.
- How the signing certificate and profile are first made without a Mac is settled in ticket 01. Preference: the key and signing request made with `openssl` on the owner's machine, the rest by hand in Apple's portal, walked through by a script. Fallback: `fastlane match`.

### Day-to-day development

- Screens and logic are developed in the browser on Linux exactly as now, against the web's player and downloads.
- Native behaviour is tried on the phone from a TestFlight build of the ticket branch. Each Swift change costs a cloud build.
- Pointing a phone build at the dev server on the local network is allowed as a convenience and never committed.

### Order of work

1. **Pipeline skeleton** (ticket 01): the existing web app, bundled in a shell, signed in the cloud, on the phone through TestFlight. Kept.
2. **Audio spike** (ticket 02): a first minimal cut of the Swift audio plugin behind a bare test screen. It measures whether native audio plays and advances for an hour locked, whether a stored file plays at 3x, whether JavaScript runs while locked, and whether writing Swift through cloud builds is tolerable. This is a gate.
3. **If the spike passes**: ADR 2 records the shell-over-rewrite decision with what was measured, and tickets 05 to 17 are revised wherever a measurement contradicts them. They were written before the spike ran.
4. **If it fails**: the tickets not yet done from 05 on are set to `wontfix`. The fallback is rewriting the screens in React Native, and that is a new discussion.
5. **Web-only prefactors** (03, 04, 12): the services hand the app a player and a downloads service, and the player is told the upcoming queue. Nothing changes for the listener. They need neither the pipeline nor the spike, so they can be done while tickets 01 and 02 wait on the owner, and they keep their value if the spike fails.
6. **Native playback** (05 to 11): play an episode, native lines in the playback log, lock-screen controls, interruptions, position kept while locked, the queue advancing while locked, finished episodes marked played.
7. **Native downloads** (13, 14) and **staying signed in** (15).
8. **On-device check** (16), by the owner. Passing it is what makes the first version done.
9. **Cleanup, last** (17): remove what existed only for the installed web app on iPhone.

Each ticket names the tickets that block it. The next ticket is the lowest-numbered one whose blockers are all done, and the numbers are already in an order that satisfies every blocker:

| Ticket | Blocked by |
|---|---|
| 01 iPhone pipeline skeleton | none |
| 02 Native audio spike | 01 |
| 03 Services hand the app a player | none |
| 04 The player is told the upcoming queue | 03 |
| 05 Play an episode with native audio | 03 |
| 06 Native lines in the playback log | 05 |
| 07 Lock-screen controls | 05 |
| 08 Interruptions and lost output | 05, 06 |
| 09 Position kept through locked listening | 05 |
| 10 Queue advances while locked | 04, 05, 07 |
| 11 Episodes finished while locked are played | 09, 10 |
| 12 Services hand the app a downloads service | none |
| 13 Download in the background, play offline | 05, 06, 12 |
| 14 Download management on the iPhone | 13 |
| 15 Stay signed in on the iPhone | 05 |
| 16 iPhone on-device check (owner) | 08, 11, 14, 15 |
| 17 Remove what only the installed web app needed | 16 |

## Testing Decisions

### What makes a good test here

- A test drives the whole app as the listener does (tap, read the screen) and checks what leaves at the edges: what is saved to the backend, and what is asked of native code. It does not look inside the player, the listening store or any hook.
- A test of the iPhone app differs from one of the web app only in the services it is given. If a test has to know how the iPhone's player is built, the seam is in the wrong place.

### Where the tests sit

- **The app, given services.** This is the existing seam and stays the main one. The web app's tests keep passing with the web's player and downloads built over the existing fake audio element, fake media session, fake files and fake network. Moving the services from "audio element" to "player" must not change what any of those tests assert.
- **The app, given iPhone services over a fake native bridge.** One new fake. Tests cover: play, pause, seek, speed and skip reach native code; state reported by native code shows on screen; the upcoming queue is handed over whenever it changes; stored listening changes are taken and saved with their own times, a finished episode becoming played and leaving the queue; a late change loses to a newer one from another device; downloads start, show progress, finish, resume and are removed; a stored copy is played in place of the stream; native lines appear in the playback log; sign-in survives a relaunch with web storage emptied.
- **Swift, compiled.** Every pull request compiles the iPhone app.
- **Swift, unit tested.** Logic that can be separated from Apple's audio classes (queue order, the stored listening changes) is tested on the macOS runner. Code that only calls Apple's classes is not unit tested.
- **The phone.** What only a real iPhone can show is checked by the owner, as a `ready-for-human` ticket with a checklist and results recorded under `## Comments`.

### Prior art

- The playback, background, queue, downloads, download-management and offline tests of the web app: each renders the whole app with the shared fakes and asserts on the screen and on what the fake backend was sent. The iPhone tests follow the same form.
- The shared fakes module: the fake native bridge sits beside the fake audio element and fake device files, and is driven the same way (the test makes it report an event, then reads the screen).
- Tickets 08, 17 and 26 of the first spec: the form for an on-device check.

### The on-device check

- Ticket 26 of the first spec, carried over: play then lock at once; an hour locked; a long pause then play from the lock screen; other apps swiped away; the log saying how the last run ended; every line naming its episode.
- Added: the queue advancing three times in a row while locked; 3x on a stream and on a download; a call, an alarm and unplugged headphones; a download finishing with the phone locked; downloads still present after several days; airplane mode from a cold start; the desktop showing the phone's position after the app is opened.
- The first version is done when this passes.

## Out of Scope

- Anything TinCan does not do today: CarPlay, automatic download of new episodes, notifications, widgets, Siri, sleep timer, rewind after a long pause
- The public App Store, other testers, other people's devices
- iPad, Apple Watch, Android
- A native look: the screens stay the web app's
- Native code saving to the backend by itself
- Updating the web code inside the app over the air, without a new build
- Carrying downloads over from the installed web app
- Changing the backend
- Making the repo private

## Further Notes

- **Cost**: the Apple Developer Program fee, yearly. Nothing else: public-repo macOS runners and TestFlight are free, and no plugin is paid for.
- **Biggest risk**: writing Swift with no local compiler and no debugger. The spike exists to measure it before anything depends on it.
- **Research** (2026-11-28, not all verified on a device):
  - Plain web audio inside a shell is no better in the background than the installed web app. Audio has to be fully native.
  - Maintainers of Capacitor and of audio plugins say JavaScript in the shell is paused in the background, even while native audio plays. Nobody has published a measurement on current iOS.
  - No free audio plugin fits: one advances natively but changes almost daily and is unproven on stored files and above 2x; another needs JavaScript to advance.
  - The fallback is weaker than it looks: Expo's own audio stops at 2x, and the usual alternative is now commercially licensed, free for personal use on terms not checked.
  - Not verified: whether the shell's project sync runs on Linux or must run on the macOS runner; whether Apple accepts a signing request made with `openssl`; how long a clean build takes.
- **Decided by the owner in discussion**: the goal, no Mac, web app stays, phone only, no new features, keeping the installed web app until replaced, preferring the shell, bundling, the device, the name and bundle ID, interruption behaviour, the playback log, the public repo and its guards, the spike gate, owning the audio plugin, and recording listening changes natively.
- **Taken from the agent's recommendations without discussion**, open to change as they come up: the seams, the queue hand-over, starting downloads with an existing plugin, where files are kept, TestFlight as the install route, how signing is first set up, token storage, the testing split, the order of work, and signed builds from `ticket/*` branches.
- That last one loosens what was agreed (signing on `main` only). Without it, Swift could be tried on the phone only after merging it, and every merge also deploys the web app.
- Ticket 17 of the first spec (the installed web app's offline check) still has one item open, downloads present after several days. It was left as it is; the same check is in this spec's on-device check.

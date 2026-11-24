# TinCan: personal podcast app

Status: ready-for-agent

## Problem Statement

I want to listen to podcasts on my own app instead of someone else's. I listen mostly by streaming on my iPhone, also on desktop, and occasionally offline (flights). I want my subscriptions, queue and place in each episode to follow me between devices, and I want the whole thing to cost close to nothing to run, since I am the only user.

## Solution

TinCan is a single-user podcast web app, installable to the home screen as a PWA. I search for or paste a podcast feed, subscribe, and new episodes show up on their own. Episodes stream straight from the publisher's host. I can queue episodes, change speed, skip back and forward, and control playback from the lock screen. My position in every episode is saved and synced. Before a flight I can download episodes to the device and play them with no network.

The backend is serverless on AWS Amplify. It stores no audio: only feeds, episode metadata and my listening state.

## User Stories

### Access

1. As the owner, I want to sign in with my one account, so that only I can use my app.
2. As the owner, I want sign-up disabled, so that nobody else can create an account.
3. As the owner, I want to stay signed in across app launches, so that I am not asked for a password every time.
4. As the owner, I want to sign out, so that I can remove access from a device.

### Finding and subscribing

5. As a listener, I want to search for a podcast by name, so that I can find shows without knowing their feed URL.
6. As a listener, I want to see title, artwork and author in search results, so that I can pick the right show.
7. As a listener, I want to subscribe from a search result, so that adding a show is one action.
8. As a listener, I want to subscribe by pasting a feed URL, so that I can add shows that are not in the directory, including private feeds.
9. As a listener, I want to import an OPML file, so that I can bring my subscriptions from another app.
10. As a listener, I want a clear error when a feed URL is invalid or unreachable, so that I know the subscription did not work.
11. As a listener, I want subscribing to return immediately and episodes to appear as they are ingested, so that I am not left waiting on a large feed.
12. As a listener, I want to be told when I am already subscribed to a show, so that I do not create duplicates.
13. As a listener, I want to unsubscribe from a show, so that it and its episodes leave my library.

### Library and episodes

14. As a listener, I want to see all my subscribed podcasts with artwork, so that I can browse my library.
15. As a listener, I want to open a podcast and see its episodes newest first, so that I can find what to play.
16. As a listener, I want a combined list of the latest episodes across all my subscriptions, so that I can see what is new in one place.
17. As a listener, I want to see each episode's title, date, duration and played state, so that I can choose quickly.
18. As a listener, I want to read an episode's show notes, so that I can see what it covers and follow its links.
19. As a listener, I want to filter to unplayed episodes, so that finished ones do not get in the way.
20. As a listener, I want to see how far through a partly played episode I am, so that I can pick up unfinished ones.
21. As a listener, I want new episodes to appear without my doing anything, so that the library stays current.
22. As a listener, I want to refresh a podcast on demand, so that I can get an episode that has just been published.
23. As a listener, I want to see when a feed last refreshed and whether it failed, so that I know if a show has stopped updating.
24. As a listener, I want to mark an episode played or unplayed by hand, so that I can correct its state.

### Playback

25. As a listener, I want to tap an episode and have it stream, so that I can listen without downloading first.
26. As a listener, I want play, pause and a seek bar, so that I can control playback.
27. As a listener, I want skip-back and skip-forward buttons, so that I can replay a sentence or jump an ad.
28. As a listener, I want to change playback speed, so that I can listen faster or slower.
29. As a listener, I want my speed setting remembered, so that I do not set it every episode.
30. As a listener, I want an episode to resume where I left off, so that I never hunt for my place.
31. As a listener, I want my position to follow me to another device, so that I can start on desktop and continue on my phone.
32. As a listener, I want an episode marked played when it finishes, so that my library reflects what I have heard.
33. As a listener, I want a persistent mini player while I browse, so that I can control playback from any screen.
34. As a listener, I want a now-playing screen with artwork and full controls, so that I have a focused view while listening.
35. As a listener, I want a clear message when an episode fails to load, so that I know it is the publisher's file and not my app.

### Queue

36. As a listener, I want to add an episode to the end of my queue, so that I can line up what to hear.
37. As a listener, I want to add an episode to play next, so that it jumps the line.
38. As a listener, I want to reorder and remove queued episodes, so that I can change my mind.
39. As a listener, I want the next queued episode to start when one ends, so that listening continues hands-free.
40. As a listener, I want my queue synced across devices, so that it is the same everywhere.

### iPhone and lock screen

41. As an iPhone listener, I want to install TinCan to my home screen, so that it opens like an app.
42. As an iPhone listener, I want playback to continue with the screen locked, so that I can listen with the phone in my pocket.
43. As an iPhone listener, I want lock-screen controls with artwork, title, play/pause and skip, so that I can control playback without unlocking.
44. As an iPhone listener, I want the next queued episode to start with the screen locked, so that the queue does not stall.
45. As a listener, I want headphone and Bluetooth buttons to control playback, so that I can use my usual controls.

### Offline

46. As a traveller, I want to download an episode to my device, so that I can play it with no network.
47. As a traveller, I want to see download progress, so that I know when it is safe to leave.
48. As a traveller, I want an interrupted download to resume, so that locking the phone does not waste what was fetched.
49. As a traveller, I want a clear "downloaded" badge on episodes, so that I can check before boarding.
50. As a traveller, I want that badge re-checked at launch, so that a download cleared by the OS does not surprise me mid-flight.
51. As a traveller, I want the app to open and show my library offline, so that I can reach my downloads.
52. As a traveller, I want downloaded episodes to play offline with seeking and lock-screen controls, so that offline feels like streaming.
53. As a traveller, I want offline playback to work even if my session has expired, so that a sign-in prompt cannot block me in the air.
54. As a traveller, I want positions and played state from offline listening to sync when I am back online, so that nothing is lost.
55. As a traveller, I want downloads to work for any episode, including hosts that block direct browser downloads, so that I do not have to care where a show is hosted.
56. As a listener, I want a downloads screen showing what is stored and how much space it uses, so that I can manage storage.
57. As a listener, I want to delete a download, so that I can free space.
58. As a listener, I want the player to use the downloaded copy when one exists, so that I save data and avoid buffering.

### Running it

59. As the owner, I want the app to cost roughly nothing per month, so that I can keep it running indefinitely.
60. As the owner, I want my private feed URLs kept secret, so that paid-feed tokens do not leak.

### In the background on iPhone

Added 2026-11-24, from the playback log of 2026-11-21 to 2026-11-24 (see Further Notes).

61. As an iPhone listener, I want an episode I paused a long time ago to play on at once when its file is still loaded, so that pressing play is not followed by seconds of loading.
62. As an iPhone listener, I want an episode played on after a long pause to be loaded afresh only when it turns out to be stuck, so that the rescue still happens when iOS has let go of the file.
63. As an iPhone listener, I want an episode I pressed play on to start even if I lock the phone before it has loaded, so that I do not find silence in my pocket.
64. As an iPhone listener, I want the app to show that an episode is not playing yet while its file loads, so that I know not to put the phone away.
65. As an iPhone listener, I want an episode iOS paused while it was loading to show as waiting, not as paused by me, so that I can tell what happened when I come back.
66. As an iPhone listener, I want that episode to start as soon as iOS allows it, without my pressing play again, so that coming back to the app is enough.
67. As an iPhone listener, I want play on the lock screen to start that episode, so that I need not unlock the phone.
68. As an iPhone listener, I want the episode I was last on to start within a moment of pressing play at launch, so that the wait before the first sound is short.
69. As a listener, I want an episode with a stored copy to play from that copy even if the copy arrived after the app opened, so that a quicker start costs me no data.
70. As the owner, I want every line of the playback log to name the episode, so that I can tell one episode's events from another's.
71. As the owner, I want every line to carry the state of Safari's audio session, so that a change of session says what it changed to.
72. As the owner, I want the log to say at launch how the last run ended (closed by iOS or by me with the page told, or ended without a word, and when it was last known to be playing), so that a silent stop is not just a gap.
73. As the owner, I want the log to say at launch whether the screens were restored from a run iOS closed, so that I can tell a relaunch from a fresh start.
74. As the owner, I want repeats of an event that means nothing by itself (a stream's loading stalling while it plays on) folded into one line with a count, so that they do not push the useful lines out of the log.
75. As the owner, I want the log to say when iOS paused an episode that nobody paused, so that I can find those moments without reading every line.

## Implementation Decisions

### Shape

- Single-user, personal app. No multi-tenancy.
- Web client only, a single-page app installable as a PWA. Display name and short name: "TinCan". Icon: a tin can with a trailing string. Resource prefix: `tincan`.
- Backend on AWS Amplify Gen 2: Auth (Cognito), Data (AppSync + DynamoDB), Functions (Lambda), Hosting.
- The app stores no audio. Episodes stream from the publisher's enclosure URL. The only audio that ever touches our AWS account is a temporary copy for the offline-download fallback.
- No transcoding, no HLS, no CDN of our own.

### Auth

- One Cognito account. Self-sign-up disabled.
- Every data model and function is restricted to the signed-in user. No per-owner rules.

### Data model

- `Podcast`: feed URL, title, author, artwork URL, ETag / last-modified, last fetched time, last fetch error.
- `Episode`: stable ID derived from podcast + GUID (falling back to enclosure URL when a feed has no GUID), podcast reference, title, publish date, duration, enclosure URL, enclosure type, show notes.
- `EpisodeState`: position in seconds, played flag, queue order (absent when not queued), updated time.
- Download staging status (for the fallback path): episode reference, status, temporary object key.
- Which episodes are downloaded is device-local state, not synced.

### Backend modules

- **Feed parser**: RSS XML in, normalised podcast and episode records out. Tolerates missing durations, missing GUIDs, the iTunes namespace and malformed dates.
- **Feed refresher**: fetches a feed with a conditional GET, parses it, upserts episodes idempotently, updates an episode whose enclosure URL changed, and records fetch errors per podcast without stopping the run. Runs hourly for all subscriptions via EventBridge Scheduler, and on demand for one podcast.
- **First ingest cap**: on first subscribe, ingest only the most recent N episodes (default 100, configurable), since some feeds carry thousands.
- **Directory search**: proxies a public podcast directory search and returns title, author, artwork and feed URL.
- **Download stager**: copies an episode's enclosure to a private temporary S3 bucket (1-day lifecycle, CORS for the app origin) by streaming, then exposes a short-lived presigned URL.
- Feeds are fetched server-side because most feeds send no CORS headers.

### API contract

Exposed to the client as custom operations on the data API:

- search podcasts by term
- subscribe by feed URL
- refresh one podcast
- unsubscribe (removes the podcast, its episodes and their state)
- request download staging for an episode

Subscribe, refresh and staging are asynchronous: the operation returns at once, the work runs in the background, and the client learns the outcome through data subscriptions. This keeps large feeds and large audio files clear of the API's request timeout.

### Client modules

- **Library**: subscriptions, episode lists and listening state. Keeps a local copy so the library renders offline, and queues writes made offline to push later. Conflicts resolve last-write-wins.
- **Player engine**: owns the queue, source selection (local copy first, otherwise stream), position persistence, speed, played state and lock-screen integration.
- **Download manager**: stores episode files on the device keyed by episode ID, and handles progress, resume, verification and deletion.
- **UI**: sign-in, library, podcast detail, episode detail, latest episodes, queue, now playing with mini player, search/add, downloads.

### Playback

- A plain HTML audio element. Not the Web Audio API, which iOS suspends in the background.
- Media Session API for lock-screen artwork, title, play/pause, skip and next.
- Skip back 15 seconds, forward 30 seconds.
- Speed presets, with the chosen speed persisted.
- Position is saved on pause, on episode end, when the app is backgrounded, and at most every 60 seconds while playing. The 60-second floor is a cost decision as well as a design one.
- An episode is marked played when playback reaches the end.
- Auto-advance sets the next episode's source synchronously in the audio element's ended handler, because iOS throttles scripts when locked and an awaited call there can stall the queue. Enclosure URLs are stable, so no URL needs fetching at that moment.

### In the background on iPhone

Stories 61 to 75. All of it is in the client: the player engine, the playback log, and the mini player and now-playing screen.

- **Playing on after a long pause.** Today a file paused in the background for a minute or more is always loaded afresh when played again. That changes: the player engine first asks the audio element whether it still holds enough of the file to play. If it does, the file is played on as it is. If it does not, it is loaded afresh at once, as now. The existing check that loads afresh a file that has not moved four seconds after play stays as the safety net, whoever pressed play.
- **Paused by iOS while loading.** iOS pauses a file that has not yet produced sound when the app is hidden, and starts it again by itself when the app shows. The player engine tells this apart from a pause the listener asked for: the pause arrives with the app hidden, without the player or an OS control having asked for it, on a file that has not got going. The episode is then waiting to play, not paused:
  - the player's state says so, and the mini player and now-playing screen show it as loading, not as paused;
  - once the file can play, the player engine tries to play it again, once. If iOS refuses, it stays waiting;
  - it plays when the app shows again, whether iOS or the player engine starts it;
  - play on the lock screen plays it; pause there, or in the app, makes it an ordinary pause;
  - the long-pause rule above does not count time spent waiting.
- **Not playing yet.** From play being pressed until the position first moves, the mini player and now-playing screen show the episode as loading. This uses what the audio element already reports; nothing new is stored.
- **The last episode at launch.** Today the episode cued at launch loads nothing until it is played, so that it comes from the stored copy if one has turned up since. That changes: the cued episode's file is loaded at launch, paused at its saved place, from the stored copy if there is one and otherwise the stream, asking the browser for no more than the file's metadata. When it is played, the player engine checks again for a stored copy and switches to it if one has appeared. Nothing is saved, and nothing shows as failed, for a cued file that fails to load before it is played: it is loaded again when played, as now.
- **The playback log.**
  - Each line names the episode loaded, by its ID. The log is told the episode by the player engine; it does not read it from the audio element. An ID is not a secret; feed and enclosure URLs still never go in the log.
  - The audio session's state is read when each line is written and is always in the line where the browser has an audio session, as `unknown` when the browser gives none. It never printed in the log this came from.
  - At launch, one line says how the last run ended, worked out from what the last run left on the device: the last line it logged, and the place it kept while playing. Either the page was told it was going, or it ended without a word, with when it was last known to be playing and where.
  - At launch, one line says whether the screens were restored.
  - A line that repeats the one before it, for an event in a short fixed list (stalled, to begin with), is not added; the line before it gains a count and the time of the latest. Its first occurrence is always logged.
  - One line marks a pause nobody asked for, written by the player engine as its other rescue lines are.
  - The log stays at 300 lines, written to the device as each line is recorded.
- **What does not change:** the saved position, the place kept every few seconds while playing, the tries at a file that fails, and the restoring of screens after iOS closes the app.

### Offline

- Downloads go to the Origin Private File System, written as chunks arrive, never held as one in-memory blob.
- Download path: try a direct fetch from the publisher. If the host blocks it (no CORS), fall back to the download stager and fetch from the temporary bucket.
- Downloads are resumable using range requests and atomic: an episode counts as downloaded only once the whole file is written and its size verified.
- A screen wake lock is held while downloads run. Persistent storage is requested from the browser.
- At launch the app verifies that each recorded download still exists and corrects the badges.
- A service worker caches the app shell so the app opens offline.
- Local playback never depends on a valid session.

### Security

- Show notes are untrusted HTML from feeds and are sanitised before display.
- Server-side fetches (feeds, enclosures) accept only http and https URLs.
- Feed URLs are treated as secrets: readable only by the signed-in user and not written to logs.
- The temporary download bucket is private; access is by presigned URL only.

### Delivery

- One environment: `main` is production. No staging, since there is one user. Development uses a personal cloud sandbox.
- CI: lint, typecheck and tests run on every push and pull request (GitHub Actions).
- CD: the hosting service is connected to the GitHub repo. A merge to `main` deploys backend and frontend, gated on the same checks, so a failing commit is never deployed.
- Work lands by pull request, one per ticket. Nothing is committed to `main` directly.
- Alerts: the owner is emailed when monthly AWS spend passes a small budget, and when a backend function fails repeatedly.
- No secrets or personal details (including the owner's email) are committed to the repo.

## Testing Decisions

A good test here asserts on behaviour visible from outside a module and survives a rewrite of its internals. No test reaches into private state or asserts on which internal function was called.

Two seams, one per deployable. Both are new, since the repo has no code yet.

1. **Backend, at the function handler.** Each handler (feed refresher, directory search, download stager, subscribe/unsubscribe) is invoked with an event. Only outbound HTTP and the data store are faked. Assertions are on the resulting records and return values. Feed parsing is covered through the refresher using fixture feeds shaped like real ones: missing durations, missing or duplicate GUIDs, a feed with thousands of episodes, an unchanged feed (304), a feed that errors, a changed enclosure URL.
2. **Client, at the UI.** The app is rendered and driven as a user would. Only the data API, the audio element and device file storage are faked. Covers subscribing, browsing, playing, resume position, speed, queue and auto-advance, played state, download lifecycle (progress, interruption and resume, verification, deletion, eviction detected at launch), local-over-stream source choice, and offline behaviour including queued writes.

No prior art exists in the repo. These first tests set the pattern.

**Manual check on a real iPhone**, since it cannot be automated and is the main platform risk:

- playback continues with the screen locked
- lock-screen controls and artwork work
- the queue auto-advances with the screen locked
- a download completes with the app in the foreground and resumes after an interruption
- a downloaded episode plays in airplane mode, with seeking
- downloads are still present after several days

**In the background on iPhone (stories 61 to 75).** No new seam. Both seams already exist and have prior art:

- **Client, at the UI**, for everything the listener sees or hears: the app is rendered and driven as a user would, with the audio element, the page's visibility and the OS media controls faked. The existing background tests are the pattern (an episode paused while the app is in the background; a file that fails while playing; an app iOS closed while it played). New cases: a long pause with the file still loaded plays straight on; a long pause with the file gone loads afresh; a pause that arrives as the app is hidden, on a file still loading, shows as loading and plays when the app shows again; play and pause on the lock screen from that state; the cued episode's file loads at launch and still plays from a stored copy that appeared since.
- **The playback log, at its own interface**, for what is written: a fake audio element and a store of text, asserting on the lines. The existing log tests are the pattern. New cases: the episode ID and session state on each line; the two launch lines, for a run that ended with the page told and one that ended without a word; repeats folded into a count.

The audio element fake must be able to do what iOS did in the log: pause a file by itself as the page is hidden, and play it again as the page shows. Tests assert on what the listener sees and what the log says, never on the player engine's own timers or flags.

**Manual check on a real iPhone**, for what no fake can show:

- press play on a stream and lock the phone at once: does the second try at playing, made while hidden, start it, or does iOS refuse? If iOS refuses, that try is removed and the episode waits for the app to show or for play on the lock screen
- with the app just launched and nothing tapped, does iOS load the cued file at all? If it loads nothing before a tap, the load at launch is removed and the spec's earlier behaviour stays
- an episode paused for ten minutes with the phone locked plays on from the lock screen, with sound
- the log's launch line is right after swiping the app away, and after iOS closes it

## Out of Scope

- More than one user, sign-up, sharing or social features
- Uploading or hosting my own audio; music library features and playlists beyond the single queue
- Transcoding, HLS, adaptive bitrate, a CDN
- A native iOS or Android app; CarPlay and Android Auto
- Background downloads and automatic download of new episodes
- Push notifications for new episodes
- Chapters, transcripts, video podcasts
- Sleep timer, silence trimming, volume boost
- Listening statistics
- App store distribution
- Keeping the app alive when iOS closes it, and starting playback again without a tap after it has been closed. Neither can be done from a web page.
- Running TinCan as a Safari tab instead of an installed app, or wrapping it in a native shell, to escape other installed web apps being swiped away

## Further Notes

- **Priority order**: streaming on iPhone is the core use. Offline is occasional and best-effort; an OS-evicted download means re-downloading, which is acceptable.
- **Biggest risk**: locked-screen auto-advance on iOS. Prove it on a real iPhone early. If it cannot be made reliable, that is the one finding that would justify a native client; the backend would carry over unchanged.
- **Download caveat**: iOS has no background downloads for web apps. A download must finish with the app open; the wake lock and resume behaviour exist to make that tolerable.
- **Dynamic ad insertion**: publishers can serve a different-length file for the same episode, so a resumed position may land a few seconds off. Accepted.
- **Seeking** relies on the publisher's host supporting range requests, which nearly all do.
- **Cost target**: about $0 per month. No audio storage or egress; feed polling (about 36k function runs a month for 50 podcasts), the database and the API sit inside free tiers or cost pennies. Figures came from memory of AWS list prices and were not verified.
- **Assumptions made without discussion**, cheap to change:
  - client framework: React with TypeScript
  - directory: iTunes Search API (no key needed); Podcast Index is the alternative
  - first-ingest cap of 100 episodes
  - skip intervals of 15 seconds back and 30 forward
- **Background playback on iPhone, from the playback log of 2026-11-21 to 2026-11-24** (stories 61 to 75):
  - Playback itself was sound. The position moved at the chosen speed through every stretch in the background, and through every `stalled` event, which only says the stream's loading paused.
  - Twice, play was pressed and the app hidden one to three seconds later, before the file had loaded. iOS paused the file in the same instant, and it stayed silent for 7 and 14 seconds until the app was shown again, when iOS started it by itself. Streams took 1.5 to 3.6 seconds to load. One of the two was the app's own doing: the file was still loaded, and the long-pause rule threw it away.
  - Six times the page was closed while it played in the background. The owner had swiped other installed web apps away in the app switcher. iOS appears to close TinCan along with them; this was seen on the phone and fits the log, but no Apple or WebKit account of it was found. The app cannot prevent it. The place kept on the device meant each relaunch picked up where it was. Leaving other installed web apps in the switcher while listening avoids it. Worth reporting to Apple: play audio in one installed web app, swipe another away.
  - Once, playback ended with nothing logged at all. iOS killed or froze the app outright, cause unknown.
  - The log could not say which episode a line was about, what the audio session's state was, or how a run had ended. Story 70 onwards exists for that.
- The name TinCan was not checked against existing apps or trademarks. That only matters if the app is ever published.

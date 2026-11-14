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
- The name TinCan was not checked against existing apps or trademarks. That only matters if the app is ever published.

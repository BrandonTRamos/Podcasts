# 16: iPhone on-device check

**What to build:** Nothing is built. The owner checks the iPhone app on the iPhone, from the TestFlight build of `main`, and copies the playback log from Settings after each check. Passing this is what makes the first version done. (Spec: The on-device check.)

**Blocked by:** 08, 11, 14, 15

**Status:** ready-for-human

Playback:

- [ ] Play pressed and the phone locked at once: the episode starts by itself
- [ ] An episode plays for an hour with the phone locked
- [ ] An episode paused for ten minutes with the phone locked plays on at once from the lock screen
- [ ] With TinCan playing, swiping other apps away leaves it playing
- [ ] 3x and 0.5x work on a stream
- [ ] The lock screen shows artwork and titles, and play, pause, skip, next and the scrubber work from it
- [ ] Headphone or Bluetooth buttons control playback

Queue and listening state:

- [ ] The queue advances three times in a row with the phone locked
- [ ] Afterwards the finished episodes are played and out of the queue, in the app and in the web app
- [ ] After an hour locked, the app shows the right position, and the web app shows it once the app has been opened
- [ ] After swiping TinCan away mid-episode, reopening it finds the place

Interruptions:

- [ ] A phone call pauses playback, and it carries on afterwards
- [ ] An alarm pauses playback, and it carries on afterwards
- [ ] Unplugging headphones pauses playback
- [ ] The silent switch does not mute playback

Downloads and offline:

- [ ] A download finishes with the phone locked
- [ ] In airplane mode, from a cold start, the app opens and shows the library
- [ ] In airplane mode a downloaded episode plays at 3x, with seeking and lock-screen controls
- [ ] What was listened to offline shows in the web app after reconnecting
- [ ] Downloads are still present after several days
- [ ] Removing a download frees the space

The app:

- [ ] Still signed in after a week without opening it
- [ ] A merge to `main` reaches the phone through TestFlight with nothing done by hand
- [ ] The log's lines name the episode, cover the locked stretches, and say how the last run ended

Recording:

- [ ] Results are recorded under a `## Comments` heading in this file
- [ ] Each failure is written up as a new ticket

# 08: iPhone streaming check

**What to build:** Nothing is built. The owner tests streaming on a real iPhone against the production URL. This is the spec's biggest risk, checked as early as the features allow. (Spec stories 41–45; spec "Manual check on a real iPhone".)

**Blocked by:** 02, 07

**Status:** done

- [x] TinCan installs to the home screen and opens standalone
- [x] Playback continues with the screen locked for at least 10 minutes
- [x] The lock screen shows artwork and title, and play, pause and skip work from it
- [x] The queue advances to the next episode with the screen locked, at least twice in a row
- [x] Headphone or Bluetooth buttons control playback
- [x] After force-quitting the app, an episode resumes from where it was
- [x] Results are recorded under a `## Comments` heading in this file
- [x] Each failure is written up as a new ticket
- [x] If locked-screen auto-advance cannot be made reliable, that is flagged for a decision on a native client

## Comments

- **2026-11-15: tested on Brandon's iPhone. All checks passed.**
  - Installs to the home screen and opens standalone: pass
  - Playback continues with the screen locked for at least 10 minutes: pass
  - Lock screen shows artwork and title; play, pause and skip work from it: pass
  - Queue advances with the screen locked, at least twice in a row: pass
  - Headphone or Bluetooth buttons control playback: pass
  - Resumes from where it was after force-quitting: pass
- No failures, so no new tickets. Locked-screen auto-advance worked, so nothing is flagged for a native client.

# 17: iPhone offline check

**What to build:** Nothing is built. The owner tests downloads and offline listening on a real iPhone against the production URL, with TinCan installed to the home screen. (Spec stories 46–58; spec "Manual check on a real iPhone".)

**Blocked by:** 02, 14, 15, 16

**Status:** ready-for-human

- [x] A download completes with the app open in the foreground
- [x] Locking the phone mid-download, then returning, resumes the download
- [x] In airplane mode the app opens and the library is visible
- [x] In airplane mode a downloaded episode plays, with seeking and lock-screen controls
- [x] An episode from a host that blocks direct download still downloads
- [x] Position from offline listening shows up on another device after reconnecting
- [ ] Downloads are still present after several days
- [x] Deleting a download frees the space
- [x] Results are recorded under a `## Comments` heading in this file
- [x] Each failure is written up as a new ticket

## Comments

- **2026-11-15: tested on Brandon's iPhone.**
  - Download completes with the app open in the foreground: pass (on retry, see below)
  - Locking mid-download, then returning, resumes the download: pass
  - In airplane mode the app opens and the library is visible: pass
  - In airplane mode a downloaded episode plays, with seeking and lock-screen controls: pass
  - Episode from a host that blocks direct download still downloads: pass
  - Position from offline listening shows up on another device after reconnecting: pass
  - Downloads are still present after several days: pending, needs several days to pass
  - Deleting a download frees the space: pass
- The first foreground download attempt (about 12:26 UTC) failed with "This episode couldn't be downloaded." Written up as ticket 19 and fixed in PR 18 (merge `c647e06`, live 12:51 UTC). The retry at 13:01 UTC succeeded.
- Left `ready-for-human` until the days-later check is done.

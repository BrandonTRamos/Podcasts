# 17: iPhone offline check

**What to build:** Nothing is built. The owner tests downloads and offline listening on a real iPhone against the production URL, with TinCan installed to the home screen. (Spec stories 46–58; spec "Manual check on a real iPhone".)

**Blocked by:** 02, 14, 15, 16

**Status:** ready-for-human

- [ ] A download completes with the app open in the foreground
- [ ] Locking the phone mid-download, then returning, resumes the download
- [ ] In airplane mode the app opens and the library is visible
- [ ] In airplane mode a downloaded episode plays, with seeking and lock-screen controls
- [ ] An episode from a host that blocks direct download still downloads
- [ ] Position from offline listening shows up on another device after reconnecting
- [ ] Downloads are still present after several days
- [ ] Deleting a download frees the space
- [ ] Results are recorded under a `## Comments` heading in this file
- [ ] Each failure is written up as a new ticket

# 16: Download fallback for blocked hosts

**What to build:** Downloading works for every episode. When a publisher's host blocks direct download, the app quietly goes another way, through a short-lived private copy, and the listener does nothing different. (Spec story 55.)

**Blocked by:** 13

**Status:** ready-for-agent

- [ ] When direct download is blocked, the app falls back automatically, with no extra action from the listener
- [ ] The request to prepare a copy returns immediately, and the app learns when the copy is ready without the listener waiting on a single long request
- [ ] The listener sees that the episode is being prepared, then normal download progress
- [ ] Once prepared, the download resumes and verifies exactly as in ticket 13
- [ ] The temporary copy is private and reachable only through a short-lived link
- [ ] Temporary copies are deleted automatically within a day
- [ ] Only http and https audio URLs are fetched
- [ ] An episode of several hundred megabytes is prepared without timing out and without being held whole in memory
- [ ] A failure to prepare shows a clear message
- [ ] Backend-seam tests invoke the staging handler with HTTP and storage faked; client-seam tests cover the fallback path

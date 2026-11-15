# 16: Download fallback for blocked hosts

**What to build:** Downloading works for every episode. When a publisher's host blocks direct download, the app quietly goes another way, through a short-lived private copy, and the listener does nothing different. (Spec story 55.)

**Blocked by:** 13

**Status:** done

- [x] When direct download is blocked, the app falls back automatically, with no extra action from the listener
- [x] The request to prepare a copy returns immediately, and the app learns when the copy is ready without the listener waiting on a single long request
- [x] The listener sees that the episode is being prepared, then normal download progress
- [x] Once prepared, the download resumes and verifies exactly as in ticket 13
- [x] The temporary copy is private and reachable only through a short-lived link
- [x] Temporary copies are deleted automatically within a day
- [x] Only http and https audio URLs are fetched
- [x] An episode of several hundred megabytes is prepared without timing out and without being held whole in memory
- [x] A failure to prepare shows a clear message
- [x] Backend-seam tests invoke the staging handler with HTTP and storage faked; client-seam tests cover the fallback path

## Comments

Notes after PR 16, for the iPhone check in ticket 17:

- **Not yet run against AWS.** Backend tests cover the stager at its handler with HTTP, the data store and the bucket faked, and a local CDK synth checks the wiring. The real S3 upload (`s3StagingBucket.ts`, 8 MB parts, 2 in flight) and the CORS rules first run when the merge deploys. Worth one try on a host that blocks direct download, once deployed.
- **Deleted within a day** comes from the stager's hourly run, which deletes copies over 23 hours old. The bucket's 1-day lifecycle rule is only a backstop: S3 rounds it to the following midnight UTC, so on its own it can take nearly two days.
- **CORS allows only** `https://main.d1s9jkcv1hp6j9.amplifyapp.com` and `http://localhost:5173` (`amplify/backend.ts`). A download from any other origin falls back, then can't read the copy, and shows "couldn't be downloaded".
- **Presigned links** are signed with the function's temporary credentials, and can stop working before their recorded hour is up. A resume that finds its link refused (403) quietly prepares a fresh copy.
- Links are kept in memory only, so a resume after a relaunch prepares a new copy and resumes from it with a range request. As in ticket 13, the only check that it is the same file is its total size.
- A host slower than about 0.5 MB/s can't finish a 400 MB file within the stager's 14-minute fetch limit (Lambda's maximum is 15). The listener then sees "couldn't be prepared".

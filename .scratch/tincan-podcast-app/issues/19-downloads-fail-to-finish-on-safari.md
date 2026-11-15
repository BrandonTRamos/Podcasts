# 19: Downloads fail to finish on Safari

**What to build:** On an iPhone, a download that has fetched the whole file finishes and shows as downloaded, rather than ending in "This episode couldn't be downloaded." (Spec stories 46, 49, 55.)

**Found by:** 17 (iPhone offline check, 2026-11-15)

**Blocked by:** 13, 16

**Status:** done

- [x] Once every byte of a download is stored, the file is moved to its final name with the call Safari supports, `move(destination, newName)`, not `move(newName)`, which Safari doesn't have
- [x] The file tests' stand-in for the OPFS has Safari's two-argument `move` and rejects a name alone with Safari's TypeError; the rename test fails against the old code and passes with the fix
- [x] Browsers without `move` still rename by copying, as before
- [x] A download left with its whole file stored under the part-file name, as on the phone, finishes when the listener taps Try again
- [x] Nothing changes for the stager, the staging bucket or the data API

## Cause

On the live app, the episode "What Jensen Huang's Resignation Will Mean for A.I." (The Daily, published 2026-11-12, 25 min) showed "This episode couldn't be downloaded." around 12:27 UTC on 2026-11-15.

What the evidence shows:

- **Episode:** podcast "The Daily". The enclosure is `audio/mpeg`, and the feed declares no length. The URL goes through a chain of tracking redirects: `dts.podtrac.com` → `pdst.fm` → `pfx.vpixl.com` → `pscrb.fm` → `prefix-v4.pscrb.fm` → `tracking.swap.fm` → `nyt.simplecastaudio.com` (302, then 206). Range requests work, and the file is 27,982,519 bytes with dynamic ads.
- **Direct download is blocked by CORS:** `pfx.vpixl.com` sends its 302 without `Access-Control-Allow-Origin`, and every other hop allows the origin. A headless browser on the live origin got `TypeError: Failed to fetch` for the CORS request and an opaque answer for the `no-cors` probe. So the app correctly treated the host as blocking and asked the backend for a copy (ticket 16).
- **Staging worked:** one `DownloadStaging` record was created at 12:26:04 and became `ready` at 12:26:08. The stager Lambda ran at 12:26:03 for 3.98 s with no error. The copy in S3 is 23,694,262 bytes, `audio/mpeg`. The bucket's CORS rule allows the live origin, `GET`/`HEAD` and the `Range` header. It was the first staged download since ticket 16 merged.
- **The staged copy can be downloaded:** from the live origin, the presigned link answered 200 with `Access-Control-Allow-Origin` set to the site, and its 23,694,262 bytes read in full. A Range preflight is allowed, and a range past the end gets a 416 with CORS headers.
- **The failure is on the device, at the last step.** "This episode couldn't be downloaded." is the `other` failure: `transfer` threw an error other than `QuotaExceededError`. After the last byte is stored, the OPFS worker (`src/opfsFiles.ts`) renamed the part file with `handle.move(newName)`. WebKit's `FileSystemHandle` has only `move(FileSystemHandle destination, USVString newName)` (WebKit `Source/WebCore/Modules/filesystem/FileSystemHandle.idl`). Called with a name alone, Safari rejects it with a TypeError. Chrome and Firefox also accept `move(newName)`, which is why the tests and desktop browsers never showed it. This breaks every download in Safari, direct or staged, once the whole file has arrived. The part file is left at full size.

The fix is to call `move(directory, newName)`, which every browser that has `move` supports. On Try again, the existing resume logic asks the copy for the bytes after the stored part, gets a 416 or a different size, starts again from zero and finishes. The copy's link lasts an hour; after that, a new copy is prepared first.

## Comments

- Seen with read-only checks only: data reads, CloudWatch logs, S3 `head-object` and `get-bucket-cors`, and probes of the enclosure and the staged copy with the site's origin. No AWS changes.
- Real WebKit couldn't run here (the local WPE build has no OPFS). The signature comes from WebKit's IDL and is reproduced in the stand-in. Confirming on the iPhone belongs to ticket 17's re-run once this deploys: tap Try again on the episode.

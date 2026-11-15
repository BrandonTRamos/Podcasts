# 13: Download an episode

**What to build:** The listener downloads an episode to their device, watches it progress, and sees a badge once it is safely stored. From then on the player uses the stored copy. An interrupted download picks up where it stopped. This ticket covers publishers that allow direct download; the rest are ticket 16. (Spec stories 46, 47, 48, 49, 58.)

**Blocked by:** 04

**Status:** done

- [x] An episode has a download action, and progress is shown while it runs
- [x] The file is stored on the device, keyed by episode
- [x] Audio is written to storage as it arrives, never held whole in memory
- [x] A download interrupted partway resumes from where it stopped
- [x] An episode is marked downloaded only once the whole file is stored and its size verified
- [x] A partial download never shows as downloaded
- [x] Downloaded episodes carry a badge in episode lists
- [x] The player uses the stored copy when one exists and streams otherwise
- [x] Seeking works when playing a stored copy
- [x] The screen is kept awake while downloads run and released afterwards
- [x] The app asks the browser for persistent storage
- [x] When a publisher blocks direct download, the listener sees a clear message that this episode cannot be downloaded yet
- [x] Client-seam tests cover progress, interruption and resume, verification and source choice, with device storage and the network faked

## Comments

Known limits after PR 13, for ticket 15 and the iPhone check in ticket 17:

- **Saving downloads needs iOS/Safari 15.2 or later.** Files are written through OPFS sync access handles in a dedicated module worker (`src/opfsWorker.ts`), with each chunk flushed before the next. A page killed mid-download (iOS reclaiming a suspended app) keeps everything flushed so far, and resume starts there. Where the browser lacks `FileSystemHandle.move()`, the worker renames a finished file by copying it in 1 MB blocks.
- **The screen wake lock needs iOS 18.4 or later in a home-screen web app.** Earlier versions refuse it or ignore it. The download still runs, but the screen may lock and interrupt it, and it then resumes from where it stopped.
- **Playback object URLs are never revoked.** One is made per stored copy, at launch and when a download finishes. They point at the file on disk, so they cost little memory, but ticket 15's deletion must revoke an episode's URL when it deletes the file.
- A resume can't verify a file whose host sends no `Content-Length`. The only check is that what was stored matches what was received.

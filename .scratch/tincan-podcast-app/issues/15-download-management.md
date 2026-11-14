# 15: Download management

**What to build:** The listener has one screen showing what is stored on the device and how much space it takes, and can delete downloads to free space. Badges are trustworthy: if the OS cleared a download, the app notices at launch. (Spec stories 50, 56, 57.)

**Blocked by:** 12, 13

**Status:** ready-for-agent

- [ ] A downloads screen lists downloaded episodes with the size of each
- [ ] The screen shows the total space used
- [ ] Deleting a download frees the space and clears its badge
- [ ] Downloads in progress are shown and can be cancelled
- [ ] At launch, every recorded download is checked against device storage
- [ ] A download that has gone missing loses its badge, and the listener can see that it was lost
- [ ] Unsubscribing from a podcast removes that podcast's downloads
- [ ] Client-seam tests cover deletion, cancellation and a download that disappeared between launches

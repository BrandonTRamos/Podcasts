# 04: The player is told the upcoming queue

**What to build:** A prefactor, in the web app only. Today the player asks for the next episode at the moment one ends. After this, the player is told the upcoming queue whenever it changes, and takes from what it was last told. Nothing changes for the listener. Native code cannot ask JavaScript for the next episode while the phone is locked, so the iPhone's player needs the queue ahead of time; this gives both players the same interface. (Spec: Player.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] The player is told the upcoming queue whenever it changes: an episode added, removed or reordered here, or a change arriving from another device
- [ ] Each entry carries what is needed to play it without asking again: the episode, where it starts from, and its stored copy if it has one
- [ ] When an episode ends, the web's player plays the first of what it was last told, within the same moment as now, so the queue still advances with the app hidden
- [ ] Skipping to the next episode takes from the same list and keeps the place in the one left
- [ ] The next control on the lock screen is offered exactly when the list is not empty
- [ ] An episode that ends is marked played and leaves the queue, as now
- [ ] The existing queue and background tests assert what they asserted before
- [ ] `npm run check` is green

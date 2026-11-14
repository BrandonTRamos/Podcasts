# 07: Queue with auto-advance

**What to build:** The listener lines up episodes in a queue, reorders it, and listening carries on from one episode to the next without touching the device. The queue is the same on every device. (Spec stories 36, 37, 38, 39, 40, 44.)

**Blocked by:** 05, 06

**Status:** done

- [x] An episode can be added to the end of the queue
- [x] An episode can be added to play next
- [x] A queue screen shows the order, and episodes can be reordered and removed
- [x] When an episode ends, the next queued episode starts by itself and leaves the queue
- [x] When the queue is empty, playback stops at the end of the episode
- [x] The queue is the same when the app is opened on a second device
- [x] The "next" action on the OS media controls skips to the next queued episode
- [x] The next episode's source is set synchronously when the current one ends, with nothing awaited first (the spec explains why: iOS throttles scripts when locked)
- [x] Client-seam tests cover queue editing and auto-advance, including that advancing needs no network call

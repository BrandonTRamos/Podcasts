# 06: Playback speed and lock-screen controls

**What to build:** The listener can change playback speed and have it remembered. The phone's lock screen, the OS media controls and headphone buttons all show what is playing and control it. (Spec stories 28, 29, 42, 43, 45.)

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] The listener can pick a playback speed from presets, and it applies immediately
- [ ] The chosen speed persists across episodes and app relaunch
- [ ] The OS media controls show episode title, podcast name and artwork
- [ ] Play, pause, skip back 15 seconds and skip forward 30 seconds work from the OS media controls
- [ ] Headphone and Bluetooth play/pause buttons control playback
- [ ] The OS media controls show the current position and duration
- [ ] Client-seam tests assert on the metadata and control handlers through a fake of the media-session interface

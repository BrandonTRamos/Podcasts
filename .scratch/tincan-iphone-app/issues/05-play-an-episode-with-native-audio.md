# 05: Play an episode with native audio

**What to build:** On the iPhone app, tapping an episode streams it through native audio, and every control in the app works on it. It keeps playing with the phone locked. This is the first real slice: it brings in the native bridge, the iPhone's player, and the Swift audio plugin grown from the spike. The queue, the lock screen, interruptions and recording while locked come in later tickets. (Spec: Seams, Player, Native audio; stories 20, 21, 25 to 32.)

**Blocked by:** 03

**Status:** ready-for-agent

**Human step:** the owner installs a build of this branch from TestFlight and tries it on the iPhone. Stop and say exactly what to try.

- [ ] The iPhone app's services hand the app a player built on native code; the web app's are unchanged
- [ ] All native code is reached through one native bridge, and the shared fakes have a fake of it
- [ ] Tapping an episode streams it through native audio, from its saved position
- [ ] Play, pause, seek, skip back and skip forward by the intervals from Settings, and any speed from 0.5x to 3x, act at once
- [ ] The screens show what the web app's show: episode, position, length, playing, loading until sound comes out, and the existing message when the file cannot be played
- [ ] Speed and skip intervals are remembered between launches
- [ ] The position is saved on pause, when another episode replaces this one, when the app goes to the background, and at intervals while the app is open
- [ ] A position saved on another device is taken up when this episode is loaded and paused, as on the web
- [ ] A stream that drops picks up again when the network returns, keeping the place
- [ ] Playback continues with the app in the background and the phone locked, and on return the screens show the true position at once
- [ ] The spike's test screen is gone
- [ ] Tests drive the whole app over the fake native bridge: controls reach native code, what native code reports shows on screen, saves reach the backend
- [ ] Swift logic that can be separated from Apple's audio classes has unit tests that run on the macOS runner
- [ ] On the phone: an episode plays for ten minutes locked, and each control in the app works. Result recorded under `## Comments`

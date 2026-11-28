# 03: Services hand the app a player

**What to build:** A prefactor, in the web app only. Today the services the app is given hand it a raw audio element and the browser's media-session controls, and the app builds its player from them. After this, the services hand the app a player. The web's player is the existing one, built where the services are assembled. Nothing changes for the listener. This is what lets the iPhone app be given a different player later. (Spec: Seams, Player.)

**Blocked by:** None (can start immediately). It is web only and needs neither the pipeline nor the spike.

**Status:** ready-for-agent

- [ ] The app receives a player from its services and no longer sees an audio element or media-session controls
- [ ] The web's player is built from the audio element and the media-session controls at the one place the web app's services are assembled
- [ ] Everything the listener can see or do is unchanged: playback, speed and skip intervals remembered, lock-screen and keyboard controls, the playback log's lines
- [ ] No screen checks which client it is running in
- [ ] Every existing test asserts what it asserted before; only how a test builds its services changes
- [ ] The shared fakes offer one way to build the web's services over the fake audio element and fake media session, and the tests use it
- [ ] `npm run check` is green

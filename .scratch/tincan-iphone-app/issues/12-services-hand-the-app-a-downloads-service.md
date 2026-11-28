# 12: Services hand the app a downloads service

**What to build:** A prefactor, in the web app only. Today the app builds its downloads from the device's files and network. After this, the services hand the app a downloads service. The web's is the existing one, built where the services are assembled. Nothing changes for the listener. This is what lets the iPhone app be given native downloads later. (Spec: Seams.)

**Blocked by:** None (can start immediately). It is web only and needs neither the pipeline nor the spike.

**Status:** ready-for-agent

- [ ] The app receives a downloads service from its services and no longer builds one from the device's files and network
- [ ] The service covers what the screens need: start, progress, cancel, resume, remove, what is stored and how much space it takes, and the stored copy to play
- [ ] The web's downloads service is built at the one place the web app's services are assembled
- [ ] Everything the listener can see or do is unchanged: downloading, progress, the badge, the downloads screen, removal, the fallback for blocked hosts, offline playback
- [ ] No screen checks which client it is running in
- [ ] Every existing test asserts what it asserted before; only how a test builds its services changes
- [ ] `npm run check` is green

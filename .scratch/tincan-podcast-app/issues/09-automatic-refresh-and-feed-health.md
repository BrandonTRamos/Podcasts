# 09: Automatic refresh and feed health

**What to build:** New episodes turn up without the listener doing anything. They can also refresh a podcast on demand, see when each feed last refreshed and whether it failed, and browse one list of the latest episodes across all subscriptions. (Spec stories 16, 21, 22, 23.)

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Every subscribed feed is refreshed hourly with no action from the listener
- [ ] New episodes appear in the app without a manual reload
- [ ] An unchanged feed is detected with a conditional request and causes no writes
- [ ] An episode whose audio URL changed in the feed is updated, not duplicated
- [ ] One failing feed does not stop the others, and the failure is recorded against that podcast
- [ ] A podcast screen shows when it last refreshed and whether the last attempt failed
- [ ] A podcast can be refreshed on demand
- [ ] A latest-episodes screen lists episodes from all subscriptions, newest first
- [ ] Backend-seam tests cover an unchanged feed, a failing feed, a changed audio URL and a feed with thousands of episodes
- [ ] Client-seam tests cover manual refresh, the health display and the latest-episodes list

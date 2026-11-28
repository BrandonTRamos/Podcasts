# TinCan

A podcast player for one person, the owner, whose subscriptions, queue and place in each episode follow them between their devices.

## Language

### Clients

**Web app**:
TinCan running in a desktop browser. The owner's client for listening at a computer.
_Avoid_: Site, desktop app, PWA

**iPhone app**:
TinCan as an app built for iOS and installed on the owner's own iPhone, not offered to anyone else. The owner's client for listening on the phone.
_Avoid_: Native app, mobile app, iOS app

**Installed web app**:
The **Web app** added to the iPhone's home screen. Retired on the iPhone in favour of the **iPhone app**.
_Avoid_: PWA, home-screen app

### Listening

**Listening state**:
The listener's place in one episode: the position reached, whether it is played, and its place in the queue if it has one.
_Avoid_: Progress, playback state

**Listening change**:
One change the listener makes to an episode's **Listening state**, carrying the time they made it by their device's clock. It may reach the backend long after it was made.
_Avoid_: Update, save, sync event

**Playback log**:
A device's own record of what happened during playback, which the owner copies out of Settings to find the cause of a fault.
_Avoid_: Debug log, diagnostics

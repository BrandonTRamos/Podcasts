# 1. The most recent listening change wins, per episode, by the devices' clocks

Status: accepted (ticket 14, offline launch)

## Context

Listening state (position, played, queue place) can be changed on a device with no network and reach the backend hours later. The data API's own `updatedAt` is the time a save arrived, so ordering by it would let an old offline change overwrite a newer one made elsewhere meanwhile. The spec asks that conflicts resolve last-write-wins.

## Decision

- Every save carries `changedAt`: when the listener made the change, by the device's clock.
- The backend applies a save only if the `changedAt` it holds for the episode is not later (a conditional update; a state with none takes any change).
- The unit is the episode's whole state: a losing save is dropped entirely, even fields the winner left alone. A winning save still changes only the fields it names.
- A device keeps unsent changes and sends them again until the backend answers; the answer, won or lost, replaces them.

## Consequences

- Correct ordering depends on the devices' clocks agreeing roughly. Phones and computers set theirs from the network, so for one listener this is accepted.
- A change made offline can be lost to a later one from another device that touched a different field (say, "played" marked offline, then only a position saved elsewhere). Accepted as simpler than per-field times. Revisit with a time per field if it bites.

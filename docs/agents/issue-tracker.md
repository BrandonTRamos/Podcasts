# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## When the user says "next ticket"

Each ticket carries a `**Status:**` line and a `**Blocked by:**` line.

- **Next ticket**: scan `.scratch/<feature-slug>/issues/` and take the lowest-numbered file whose status is `ready-for-agent` and whose blockers all have status `done`. If several features have open tickets and the user named none, ask which.
- **Read state from `origin/main`**: a ticket counts as done only when `done` is on `origin/main`, which means its pull request has merged.
- **One ticket per session**: implement that ticket only, then stop. Do not start the following one.
- **Skip `ready-for-human` tickets**: they need the owner. Say when one has become unblocked.
- **If none qualifies**: say so and list what is blocking the remaining tickets. Do not pick a blocked one.
- `done` is a completion state, not a triage label, so it is not listed in `triage-labels.md`.

## Working a ticket

- **Branch**: work on a new branch off `origin/main` named `ticket/<NN>-<slug>`. Never commit to `main`.
- **On completion**: tick the ticket's acceptance criteria, set its status to `done`, and commit the ticket file together with the code.
- **Pull request**: push the branch and open a pull request titled `<NN>: <ticket title>`. Do not merge it. Merging is what makes the ticket done.
- **Human steps**: when a step needs the owner (credentials, console access, a physical device), stop and say exactly what is needed. Do not work around it.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

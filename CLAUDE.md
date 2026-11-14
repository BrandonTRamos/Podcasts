# CLAUDE.md

## Communication

All communication with the user must be concise. Sacrifice grammar for concision.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

When asked to implement a ticket or the "next ticket", read that file first: it defines which ticket is next, the branch and pull request each ticket needs, and how a ticket becomes done. Never commit ticket work to `main`.

### Triage labels

The five default triage labels, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

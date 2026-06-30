> **Org rules:** read `CLAUDE.md` in `agentic-yankiz/agents-mgmt` — applies here unless explicitly overridden below.

# CLAUDE.md — workout-program project

Guidance for AI assistants working in this project. This is a **docs-only project**
(Markdown training plan + knowledge base) for **Shaked** (see `athlete-profile.md`).
Goals: one-arm pull-up, planche, fat loss without cardio. 4 days/week, 2 bouldering,
plus a shoulder-physio block for a flagged left front-shoulder issue.

## How to respond
- **Be short and clear.** Give the answer directly — no walls of text, no restating the
  question, no filler. Prefer a few tight lines or a small table over prose.
- **Before replying, ask yourself: is this accurate, and is it needed?** Cut anything you
  can't stand behind or that the user didn't ask for.

## Read order for a new session
1. `athlete-profile.md` — who this is for and the hard constraints.
2. `knowledge/training-principles.md` — how the program is built and progressed.
3. The relevant goal file in `knowledge/` for the change you're making.
4. `PLAN.md` — the human-facing plan you may be asked to update or render.

## Helpers
- **Agents** (`.claude/agents/`): `workout-coach`, `physio-advisor`, `progress-tracker`.
- **Skills** (`.claude/skills/`): `show-weekly-plan`, `log-workout`, `advance-week`,
  `pro-trainer` (evidence + logged-results coaching), `grill-me` (stress-test a plan/decision),
  `kanban` (show GitHub issue backlog as a kanban board).
- Run Claude from inside `workout-program/` so these are picked up.

## Backlog
- `docs/TASK-training-feedback-loop.md` — feedback loop. **GitHub-Actions automation parked
  (2026-06-15);** the loop now runs via the Claude session (agents + skills), with PRs
  created and adversarially reviewed by Claude agents. See the doc's *Current direction*.
- `docs/TASK-github-pages-site.md` — **superseded by local Tailscale serving** in `site/`.

## The web site (`site/`)
Static render of `PLAN.md` (the source of truth). It is served locally with Caddy at
`/fitness/` and exposed through Tailscale. The launchd service in
`site/bin/local-sync-serve.sh` fast-forwards to `origin/main`, rebuilds, and keeps the
server running after login/restart. The GitHub workflow only validates lint/build; it does
not deploy anywhere. Read-only — `PLAN.md` always wins.

## Rules for editing
1. **`PLAN.md` stays human-readable** — tables, short lines, video links. Deep explanation
   goes in `knowledge/`, linked from the plan.
2. **Safety first on the shoulder.** Any change adding anterior-shoulder/biceps load
   (planche lean, lock-offs) keeps the conservative ramp + prehab block. Defer to
   `physio-advisor` and keep the medical disclaimer when unsure.
3. **Respect constraints:** 4 (sometimes 5) days, 2 bouldering, **no cardio**; fat loss via
   nutrition. No running/biking.
4. **Keep the structure:** 4 loading weeks + deload; Week 4 is the peak.
5. **Videos must be real & reputable** (prefer Hooper's Beta + established calisthenics
   channels). Keep the video title next to each link.
6. **Update `tracking/` and baselines**, not just the plan, when progressing a cycle.
7. Follow the root `../CLAUDE.md` (branch discipline, minimal changes, no secrets).

## Not medical advice
General fitness programming. The shoulder issue is undiagnosed — always keep the disclaimer
and "see a physiotherapist" guidance in `knowledge/shoulder-physio.md`.

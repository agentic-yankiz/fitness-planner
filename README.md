# 🏋️ Workout Program — Shaked

A personalized, strength-first training program targeting **one-arm pull-up**,
**planche**, and **fat loss without cardio** — built around 4 days/week (2 of them
indoor bouldering) and an integrated **shoulder physio** block.

## 👉 Just want to train?
Open **[`PLAN.md`](PLAN.md)** — that's the clean, printable weekly plan with tables
(exercise · sets/reps · time · rest · video links) and how each week gets harder.

## What's in here
| Path | What it is |
|---|---|
| **[`PLAN.md`](PLAN.md)** | The human-facing plan. Start here to train. |
| [`athlete-profile.md`](athlete-profile.md) | Shaked's stats, goals, constraints, injury flags. |
| [`knowledge/`](knowledge/) | The "why" + full progressions + every video, for deeper dives and for agents. |
| [`knowledge/training-principles.md`](knowledge/training-principles.md) | Periodization, overload, autoregulation, how to evolve the plan. |
| [`knowledge/one-arm-pullup.md`](knowledge/one-arm-pullup.md) | Full OAP progression ladder. |
| [`knowledge/planche.md`](knowledge/planche.md) | Full planche progression ladder. |
| [`knowledge/shoulder-physio.md`](knowledge/shoulder-physio.md) | Front-shoulder prehab/rehab + when to see a physio. |
| [`knowledge/fat-loss-nutrition.md`](knowledge/fat-loss-nutrition.md) | Diet-led fat loss, no cardio. |
| [`knowledge/exercise-library.md`](knowledge/exercise-library.md) | Every exercise + learning video in one table. |
| [`tracking/`](tracking/) | Weekly log template — fill it in; next cycle starts from real numbers. |
| [`site/`](site/) | The web version of the plan — light UI, current-week + progress, served locally through Tailscale at `/fitness/`. |
| [`.claude/`](.claude/) | Helper **agents** and **skills** for future AI sessions (see below). |
| [`docs/`](docs/) | Backlog specs for future agents (e.g. the training feedback-loop task). |

## The program in one breath
- **4-week wave:** each week harder, **Week 4 peak**, **Week 5 deload**, then repeat with
  higher baselines.
- **Week:** Mon boulder · Tue pull/OAP · Thu boulder · Fri push/planche · *(opt. Sat finisher)*.
- **Every session:** 8-min wrist+shoulder warm-up, and a shoulder-prehab block on lift days.
- **Fat loss:** small calorie deficit + ~150–185 g protein/day + ~8–10k steps. No running.

## 🤖 For future AI sessions
This folder ships its own helpers under [`.claude/`](.claude/):
- **Agents** (`.claude/agents/`): `workout-coach`, `physio-advisor`, `progress-tracker`.
- **Skills** (`.claude/skills/`): `show-weekly-plan`, `log-workout`, `advance-week`.

Run Claude from inside `workout-program/` (or point it here) so these are discovered.
See [`CLAUDE.md`](CLAUDE.md) for how agents should work in this project.

---
*General fitness programming, not medical advice. The shoulder is a flagged, undiagnosed
issue — see [`knowledge/shoulder-physio.md`](knowledge/shoulder-physio.md) and get a real
assessment from a physiotherapist.*

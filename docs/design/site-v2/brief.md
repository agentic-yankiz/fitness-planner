# Site v2 — Product Brief (PM)

_Status: draft for Shaked's approval (issue #24). Docs only — no code._

## One-liner

Turn the read-only PLAN.md render into a **mobile-first gym companion**: the one
screen Shaked opens mid-session to see today's work, mark it done, log a couple of
real numbers, and glance at whether he's been consistent.

## Who / where / how (the only user)

- **User:** Shaked. Exactly one. No accounts, no multi-user, ever (non-goal).
- **Device:** his phone. **Design at 390px width first.** Desktop is a widened
  version of the same layout, not a separate design.
- **Context:** standing at a bouldering wall or between sets — **chalky fingers,
  one hand free, phone propped on the mat, read at arm's length.** Big tap targets,
  high contrast, no precision gestures, minimal typing.
- **Network:** tailnet-only (`HOST/fitness/`), never Funnel. Sometimes off-tailnet
  or the Node server is down → must degrade to the static read-only plan.

## Jobs to be done

| # | Job (Shaked's words) | Success looks like |
|---|---|---|
| J1 | "What am I doing **today**?" | Today's session is the default screen, full detail, in **≤2 taps** from cold open (ideally 0 — it's the landing screen). |
| J2 | "I trained — **mark it done**." | One thumb tap on a big Done button; instant confirmed state; survives refresh. |
| J3 | "**Log the real numbers** fast." | Optional quick-log (top-set load, RPE, shoulder pain 0–10) in a few taps, no keyboard gymnastics. |
| J4 | "Am I **being consistent**?" | Streak + this-week/-month adherence and a calendar, glanceable in one screen. |
| J5 | "What's the **rest of the week** / where am I in the wave?" | Week overview + current wave-week/deload badge without leaving the app. |

## Success criteria

- **Today in ≤2 taps**, and the Done button is **visible without scrolling** on a
  390px phone (satisfies #17-AC1).
- **Mark-done round-trips in one tap** and is correct after refresh (#17-AC2/AC3),
  idempotent (#17-AC4/AC5).
- **Glanceable at arm's length:** primary state (trained? which day? deload?)
  readable without zooming; tap targets **≥44×44px** (Apple HIG min), ideally 48.
- **Never a dead end:** every edge state (rest day, deload, missed days, zero data,
  server down, off-tailnet) shows a clear, calm message — never a spinner-forever or
  raw error.
- **PLAN.md stays the source of truth.** The site renders it; it never edits it.
- **Visual continuity:** extends the existing `styles.css` tokens (warm paper, calm
  green, amber deload). Stays light and readable; no dark mode (by design).

## Scope

**In scope for v2**

- Four screens: **Today** (default), **Week**, **Stats**, **Log entry**.
- Done button with persisted, idempotent state (#17).
- Adherence stats: streak, longest streak, this-week/-month rate, calendar (#18).
- Quick-log of a few numbers per session (extends the runtime state; the durable
  training log stays in `tracking/*.md` / PR-based export per #28).
- Read-only static fallback when the server is unreachable.

**Non-goals (explicit)**

- **Multi-user / auth UI.** Tailnet + Shaked-only is the security model; no login screen.
- **Editing the plan from the UI.** `PLAN.md` is authored in the repo and is the
  source of truth; the site is read-only against it. No exercise CRUD, no drag-reorder.
- **Building a full workout tracker** (per-set timers, rep counters, plate math). Quick-log
  captures a few decision-relevant numbers, not a set-by-set journal.
- **Offline-first PWA / installability.** Nice-to-have, not v2. Static fallback is the
  resilience story, not a service worker.
- **Notifications / Telegram** — that's #27, out of scope here (this spec just avoids
  blocking it).
- **Charts beyond a sparkline/calendar.** Keep it glanceable, not a dashboard.

## Constraints inherited from the platform

- Frontend is **vanilla** — no framework (matches the "no framework, no runtime
  third-party requests" ethos of `build.mjs`). Client JS is progressive enhancement.
- Runtime state comes from the Node/SQLite server (#16). Contracts of #16/#17/#18 are
  **authoritative**; this spec owns the UX around them.
- `trainingDays` (JS day indices, `0=Sun`) in `config.json` is the single source for
  "which days are training days" — shared by Stats (#18) and the today-highlight (#15).

## Risks / how we mitigate

| Risk | Mitigation |
|---|---|
| Server down mid-session → app looks broken | Static read-only plan always renders; runtime widgets fail soft to a "state unavailable" note. |
| Chalky-finger mis-taps on the Done button | Large target, generous hit area, confirmed state is unmistakable and reversible via undo. |
| Marking wrong day / fat-finger | Done is date-scoped to today (server-derived); an **Undo** window covers mistakes. |
| Stats mislabel rest vs missed | Only `trainingDays` count as "missed"; rest days are neutral (#18-AC3). |
| Scope creep into a full tracker | Non-goals above are the guardrail; quick-log stays to ~3 fields. |

## Definition of done for this brief

- Jobs, success criteria, and non-goals agreed with Shaked.
- Every #17/#18 acceptance criterion has a home in `wireframes.md` (traceability table there).
- Feeds `ia-and-flows.md` → `wireframes.md` → `components.md`.

# TASK (backlog): GitHub-powered training feedback loop

> **Status:** **PARKED (2026-06-15).** The GitHub-Actions automation below is **not**
> being built for now — see *Current direction*. Kept as a reference for if/when we
> revisit unattended automation.
> **Owner of this project:** Shaked. **Scope:** `workout-program/`.

## Current direction (2026-06-15)
Shaked redirected this loop away from GitHub Actions:
- **No GitHub-Actions automation for now** — the feedback-loop automation below is not being
  built. The site is also local-only now: a launchd service on the laptop pulls `main`,
  rebuilds, and serves through Tailscale; GitHub Actions only validates lint/build.
- **The loop runs through the Claude session**, using the existing `.claude/` agents and
  skills (`log-workout`, `advance-week`, `progress-tracker`, `workout-coach`). Shaked
  communicates logs/feedback in-session; Claude parses, updates `tracking/`, and proposes
  progression.
- **Changes ship as PRs created fully by Claude agents**, and once a PR exists an
  **adversarial reviewer** agent reviews it before it's considered done.
- **Model:** `claude-sonnet-4-6` by default; opt up to Opus for end-of-block deload
  re-baselining.

Everything below is the original (now parked) GitHub-Actions spec.

---

## Goal

Close the loop between **doing** training and **adjusting** the program, with as little
manual effort from Shaked as possible:

1. **Capture** — let Shaked drop training data into GitHub from his phone/desktop.
2. **Process** — a GitHub Action runs on each new entry to parse and store it.
3. **Learn & suggest** — the Action calls the **Claude API** to read the new data against
   the program, then proposes progression adjustments.

This automates what the `log-workout` + `advance-week` skills do today by hand.

---

## Recommended architecture

```
 Shaked                GitHub                         GitHub Actions                 Claude API
 ───────               ──────                         ──────────────                 ──────────
 fills "Workout Log"   issue opened/edited            on: issues (labeled            sonnet/opus:
 issue form       ──▶  (label: workout-log)     ──▶   workout-log)             ──▶   read log + PLAN.md
 from phone                                           1. parse issue body →          + principles + recent
                                                         append to tracking/         logs → return:
                                                      2. call Claude                  - parsed/cleaned log
                                                      3. post analysis back     ◀──   - per-exercise
                                                  ◀── as an issue comment             advance/hold/regress
                                                      4. (optional) open a PR          + reasons
                                                         updating tracking/ +
                                                         baselines
```

### 1. Data entry — use **Issue Forms**, not the Wiki
- Add `.github/ISSUE_TEMPLATE/workout-log.yml` — a structured **issue form** (dropdowns +
  number/text fields) mirroring `tracking/log-template.md`: week/block, bodyweight, sleep,
  shoulder pain (0–10), and per-exercise load×reps/time + RPE + notes.
- Filing the form auto-applies the **`workout-log`** label — that label is the trigger gate.
- **Why issues over wiki:** issues fire `on: issues` workflow events and carry structured
  form data; the wiki has no reliable native Action trigger and no form schema. Keep the
  wiki only if Shaked wants long-form notes; it is not part of the automation path.

### 2. Processing — one **scoped** workflow
- Add `.github/workflows/workout-program.yml` (the project has none today — it is docs-only).
- Trigger: `on: issues: { types: [opened, edited, labeled] }`, then **guard the job** with
  `if: contains(github.event.issue.labels.*.name, 'workout-log')`.
- Steps: checkout → parse the issue body into a row → append to the right `tracking/week-*.md`
  (create it from `tracking/log-template.md` if missing) → call Claude (next step).
- **Monorepo-convention note:** the isolation rule in the root `CLAUDE.md` is about `paths:`
  filters on **push/PR** so one project's *code* changes don't trigger another's build. This
  workflow is **issue-triggered**, not push-triggered, so the `paths:` filter does not apply
  in the same way — the **label guard is the isolation mechanism** here. Document this in the
  workflow header so it isn't "fixed" by a future agent into a paths filter that breaks it.
  (If you *also* want CI on pushes to `workout-program/**`, that is a separate, paths-scoped
  job/workflow — keep the two triggers cleanly separated.)

### 3. Learn & suggest — **Claude API**
- A small script (`workout-program/automation/analyze.{ts,py}`) sends Claude:
  - the new parsed log,
  - `PLAN.md`, `knowledge/training-principles.md`, `athlete-profile.md`,
  - the last few `tracking/week-*.md` files (recent history).
- Ask Claude to apply the **`advance-week` rules** (it already encodes the progression logic):
  per-exercise **advance / hold / regress** with a one-line reason, plus a **shoulder-pain
  gate** (never advance anterior-shoulder load if pain is trending up).
- **Model:** default to `claude-sonnet-4-6` (cheap, fast, plenty for this); allow opting up to
  Opus for end-of-block deload re-baselining. Pin the model id in one config constant.
- **Output two artifacts:**
  1. a **comment** on the issue with the human-readable summary (always), and
  2. **optionally** a **PR** that edits `tracking/` + baselines in `PLAN.md`/`athlete-profile.md`
     — so changes still go through review, never straight to `main` (root rule #10).

---

## Files to create (suggested)

| Path | Purpose |
|---|---|
| `.github/ISSUE_TEMPLATE/workout-log.yml` | Structured workout-log issue form (sets `workout-log` label) |
| `.github/workflows/workout-program.yml` | Issue-triggered, label-guarded automation workflow |
| `workout-program/automation/analyze.*` | Script: build the prompt, call Claude, format output |
| `workout-program/automation/parse-issue.*` | Parse issue-form body → a `tracking/` row |
| `workout-program/automation/README.md` | How the loop works, how to run it locally |

## Security & secrets
- `ANTHROPIC_API_KEY` lives in **repo/environment secrets** — never commit it (root rule #7).
- Give the workflow **least-privilege** `permissions:` (`issues: write` for comments;
  `contents: write` + `pull-requests: write` **only** if it opens the optional PR).
- The issue body is **untrusted input** — treat it as data in the Claude prompt (it can't be
  allowed to redirect the model's instructions); validate/parse before appending to files.
- Gate on the `workout-log` label so random issues never burn API calls.

## Acceptance criteria
- [ ] Filing the "Workout Log" issue form creates a labeled issue with structured fields.
- [ ] The workflow runs only for `workout-log` issues and appends a clean row to `tracking/`.
- [ ] Claude posts an issue comment with per-exercise advance/hold/regress + reasons, honoring
      the shoulder-pain gate.
- [ ] Suggestions that change the plan/baselines arrive as a **PR**, not a direct push.
- [ ] No secret is committed; the workflow uses least-privilege permissions.
- [ ] Workflow header documents the label-guard isolation (so it's not "fixed" into a paths filter).

## Open decisions (superseded — see *Current direction* above)
> Resolved 2026-06-15: loop runs via the Claude session (not Actions); PRs are
> agent-created + adversarially reviewed (no self-merge); model = Sonnet default,
> Opus for deload. The items below stand only if the Actions approach is revisited.

1. **Feedback delivery:** issue **comment only**, or comment **+ auto-PR** that edits the files?
2. **Autonomy:** suggest-only, or let the auto-PR self-merge on green? (Default: suggest-only.)
3. **Storage of truth:** keep `tracking/week-*.md` as the canonical log (recommended), vs. the
   issues themselves being the store.
4. **Model tier & budget:** Sonnet default vs Opus for deload re-baselining; any monthly cap.
5. **Stack:** Node+TS (matches `telegram-claude-bot`) or Python for the automation script.

## Out of scope (for the first version)
- Charts/dashboards, wearable/Apple-Health import, Telegram or app front-ends.
- Auto-merging program changes without review.
- Replacing the `.claude/` skills — this **wraps** the same logic for unattended runs.

## Related
- Skills that already encode this logic: `.claude/skills/log-workout`, `.claude/skills/advance-week`.
- Progression rules the analyzer must follow: `knowledge/training-principles.md`.
- Log shape to mirror in the issue form: `tracking/log-template.md`.

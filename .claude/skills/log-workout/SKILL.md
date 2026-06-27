---
name: log-workout
description: Record one of Shaked's completed training sessions into tracking/. Use when he says "log my workout", "I did Tuesday", "save today's session", and wants loads/reps/times/RPE/shoulder-pain captured for progression decisions later.
---

# Log Workout

Capture a completed session into `tracking/` using the standard schema so it can drive
progression decisions.

## Steps
1. Read `tracking/log-template.md` for the schema. Check `tracking/` for an existing file
   for the current week (`week-YYYY-MM-DD.md`).
2. Collect from Shaked (ask only for what's missing): which day (Pull/Push/Boulder),
   exercises with **actual load × reps or hold time**, **RPE**, **left-shoulder pain (0–10)**,
   and the weekly check-ins (bodyweight, sleep, protein, steps) if it's the first session
   of the week.
3. Create or update `tracking/week-YYYY-MM-DD.md` from the template, filling the matching
   rows. Keep formatting consistent with the template.
4. If it's a **deload week (Week 5)**, also capture the benchmark re-tests.

## Output rules
- Confirm what was saved in 2–3 lines (day, key numbers, any pain flag).
- If **front-shoulder pain ≥ 4/10** or trending up, flag it and suggest reviewing with the
  `physio-advisor` agent before next session.
- Don't make a progression decision here — that's the `advance-week` skill /
  `progress-tracker` agent. Just record cleanly.

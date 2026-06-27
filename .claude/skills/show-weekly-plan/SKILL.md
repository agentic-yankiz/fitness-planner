---
name: show-weekly-plan
description: Render Shaked's workout for a given week as a clean, human-readable view (the day-by-day tables, scaled to the right week of the 4-week wave). Use when Shaked asks "what's my plan this week", "show me Tuesday", "what do I do for week 3", or wants a printable/at-a-glance version.
---

# Show Weekly Plan

Produce a clean, glanceable view of Shaked's training for the requested week — not a wall
of text. Source of truth is `PLAN.md`.

## Steps
1. Read `PLAN.md`.
2. Determine which week is asked for (1–4 loading, or 5 = deload). Default: ask which week,
   or if a log exists in `tracking/`, infer the current week.
3. Apply the **"How each week gets harder"** table from `PLAN.md` to scale the main lifts
   (load, hold time, assistance, sets) for that week. Boulder days and the prehab block
   stay the same across weeks.
4. Render the requested scope:
   - A whole week → the at-a-glance table + each training day's table.
   - One day → just that day's table, scaled to the week.

## Output rules
- Keep it **clean and short**: tables with `Exercise · Sets×Reps/Time · Rest · Video`.
- Include the warm-up reminder and the shoulder-prehab block on lift days.
- Keep the real video links from `PLAN.md`.
- End with the one-line **pain-first rule** and the current week's RPE target.
- Do **not** dump the knowledge files — link to them only if asked for the "why".

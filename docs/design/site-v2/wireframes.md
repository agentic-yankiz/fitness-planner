# Site v2 — Wireframes (UI)

_ASCII wireframes per screen, at **390px phone width**. Each element is annotated with
the #17/#18 acceptance criterion it satisfies, in `[·· AC ··]` tags. Component names in
**bold** are defined in `components.md`._

Legend: `▓` = accent-green fill · `b` = amber deload · `[ ]` = tap target · `≈44px` min.

---

## 1. TODAY (default screen — training day)

```
┌────────────────────────────────────────────┐
│  Shaked's Strength Plan                     │  ← TopBar (title only; no menu)
├────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐│
│  │ Block 1 · Week 3 of 4        LOADING   ││  ← WaveHero (green)
│  │ RPE 8–9 · pull-up +5 kg · hang +5 kg   ││    levers for the week
│  └────────────────────────────────────────┘│
│                                              │
│  TODAY · Tuesday                             │  ← DayHeading (accent, today)
│  💪 Strength A — Pull                        │
│                                              │
│  ┌────────────────────────────────────────┐│
│  │  ✓  MARK TRAINED                       ▓││  ← DoneButton (state A: actionable)
│  └────────────────────────────────────────┘│    full-width, ~56px  [·· 17-AC1 ··]
│  ⟳ log-state loaded from server              │    (above the fold, no scroll)
│  ┌──────────────┐                            │
│  │  Log numbers │  secondary, opens sheet    │  ← LogButton  (J3)
│  └──────────────┘                            │
│                                              │
│  Exercises                                   │
│  ┌────────────────────────────────────────┐│
│  │ Weighted pull-up      4×4–5   3min  ▶  ││  ← ExerciseRow (▶ = video link)
│  │ Archer pull-up        4×3–4/s 2–3m  ▶  ││    tap ▶ → opens video
│  │ One-arm negatives     3×2/s   2–3m  ▶  ││
│  │ One-arm lock-off      3×5–8s  2min  ▶  ││
│  │ Repeaters 14mm        3×(7/3) 2–3m  ▶  ││
│  │ Planche lean          3×10–15s 90s  ▶  ││
│  │ Hammer curls          3×10–12 90s   ▶  ││
│  │ Shoulder prehab       ~8 min        ▶  ││  ← prehab always shown (safety)
│  └────────────────────────────────────────┘│
│  › 8-min warm-up (wrists + shoulders)        │
│                                              │
│  footer: v abc1234 · source PLAN.md · →Stats │  ← Footer (SSR stats link kept)
├────────────────────────────────────────────┤
│   ▓Today        Week         Stats           │  ← TabBar (fixed, thumb zone)
└────────────────────────────────────────────┘
```

### DoneButton — all states

```
A. ACTIONABLE (done=false)            B. SAVING (optimistic)
┌────────────────────────────────┐   ┌────────────────────────────────┐
│  ✓  MARK TRAINED              ▓ │   │  ✓  TRAINED ✓   saving…      ▓ │
└────────────────────────────────┘   └────────────────────────────────┘
   green fill, tappable                 instantly flipped; subtle pulse

C. CONFIRMED (done=true)              D. CONFIRMED + UNDO window (few s)
┌────────────────────────────────┐   ┌────────────────────────────────┐
│  ✓  TRAINED · 18:42          ▓ │   │  ✓ TRAINED · 18:42   [ Undo ]  │
└────────────────────────────────┘   └────────────────────────────────┘
   solid green, check, logged time     Undo reverts (local) before it settles
   [·· 17-AC2 confirmed state ··]       [·· 17-AC4 re-tap = 200 no-op ··]

E. READ-ONLY (server down / off-tailnet)   F. REST DAY (no button at all)
┌────────────────────────────────┐   (button replaced by RestCard — see §Rest)
│  state unavailable · read-only │
│  ⟳ retry                        │
└────────────────────────────────┘
   muted, inert, explains why
```

- On load, `GET /fitness/done/today` picks A vs C. **[·· 17-AC3 refresh persists ··]**
- Re-tapping in state C/D → `POST /fitness/done` → 200, stays C. **[·· 17-AC4 · 17-AC5 no dupes ··]**
- Button sits directly under the hero → **visible without scrolling at 390px. [·· 17-AC1 ··]**

---

## 2. TODAY — edge variants

### Rest day (Wed / Sun)

```
├────────────────────────────────────────────┤
│  TODAY · Wednesday                           │
│  ┌────────────────────────────────────────┐│
│  │  😌  Rest day                           ││  ← RestCard (no Done button:
│  │  Walk · mobility · sleep.               ││    nothing to mark done today)
│  │  Next: Thu 🧗 Boulder (volume/technique)││
│  └────────────────────────────────────────┘│
│  › See the full week ↓                       │
```

### Deload week (week ≥ 5)

```
│  ┌────────────────────────────────────────┐│
│  │ Block 1 · Week 5 (deload)     RECOVER  b││  ← WaveHero.deload (amber)
│  │ RPE 5–6 · load −20% · half the sets    ││
│  └────────────────────────────────────────┘│
│  ...DoneButton + exercises render at deload  │
│     scaling; amber accents instead of green  │
```

### Zero data (fresh DB, server up)

```
│  ┌────────────────────────────────────────┐│
│  │  ✓  MARK TRAINED                      ▓ ││  actionable, same as normal
│  └────────────────────────────────────────┘│
│  First session? Tap Done and your streak     │  ← subtle hint, one line
│  starts today.                               │
```

---

## 3. WEEK screen

```
┌────────────────────────────────────────────┐
│  This week · Block 1 · Week 3 of 4          │
├────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐│
│  │ Mon 🧗 Boulder — limit         ✓ done  ││  ← DayCard (past, done tick)
│  ├────────────────────────────────────────┤│
│  │ Tue 💪 Strength A — Pull    ▓ TODAY ✓  ││  ← DayCard.today (+done)
│  ├────────────────────────────────────────┤│
│  │ Wed 😌 Rest                    —        ││    rest → neutral, no tick expected
│  ├────────────────────────────────────────┤│
│  │ Thu 🧗 Boulder — volume        · today+ ││    upcoming training day
│  ├────────────────────────────────────────┤│
│  │ Fri 💪 Strength B — Push       ·        ││
│  ├────────────────────────────────────────┤│
│  │ Sat ⭐ Optional day 5          (opt)    ││    optional → not a "miss" if skipped
│  ├────────────────────────────────────────┤│
│  │ Sun 😌 Rest                    —        ││
│  └────────────────────────────────────────┘│
│  Tap a day to see its exercises ↓            │
├────────────────────────────────────────────┤
│   Today       ▓Week        Stats             │
└────────────────────────────────────────────┘
```

- A **missed** past training day shows a muted "missed" mark instead of ✓ done (mirrors
  the Stats colouring; keeps Week and Stats consistent).
- Tapping a day expands its **ExerciseRow** table (same rows as Today).

---

## 4. STATS screen

```
┌────────────────────────────────────────────┐
│  Stats · training adherence                 │
├────────────────────────────────────────────┤
│  ┌──────────┬──────────┬──────────┬────────┐│
│  │  🔥 5    │  best 12 │  wk 3/4  │ mo 11/14││  ← StatSummary row  [·· 18-AC4 ··]
│  │  streak  │  longest │  75%     │  79%    ││    current · longest · week% · month%
│  └──────────┴──────────┴──────────┴────────┘│
│                                              │
│  Last 30 days                                │  ← StreakCalendar  [·· 18-AC2/AC3 ··]
│        M  T  W  T  F  S  S                    │
│   wk1  ▓  ▓  ·  ▓  ▓  ·  ·                    │   ▓ green = trained
│   wk2  ▓  ▓  ·  ✗  ▓  ·  ·                    │   ✗ red   = missed (past train day)
│   wk3  ▓  ▓  ·  ▓  ▓  ·  ·                    │   · white = rest day (neutral)
│   wk4  ▓  ▓  ·  ▢  ▢  ·  ·                    │   ▢ grey  = future training day
│        └ Wed & Sun always neutral (rest) ┘   │
│                                              │
│  legend  ▓ trained  ✗ missed  ▢ upcoming  · rest│
│                                              │
│  ← source: sessions DB · trainingDays config │
├────────────────────────────────────────────┤
│   Today        Week       ▓Stats             │
└────────────────────────────────────────────┘
```

### Stats — empty state (zero rows)

```
│  ┌────────────────────────────────────────┐│
│  │  No sessions logged yet.               ││  ← StatsEmpty  [·· 18-AC5 ··]
│  │  Tap "Mark trained" on a training day  ││
│  │  and your streak starts here. 🔥        ││
│  └────────────────────────────────────────┘│
│  (calendar still drawn, all rest=·,          │
│   future train days=▢ — no red yet)          │
```

### Stats — server down

```
│  Stats need the live server, and it's        │
│  offline right now. The plan above is still  │
│  current. ⟳ retry                             │
```

> **Two renderings, one data model.** The **Stats tab** (JS) calls
> `GET /fitness/api/stats` and draws the grid client-side. The **SSR page**
> `GET /fitness/stats` (linked in the footer "→ Stats") renders the *same* summary +
> grid server-side with the full header/footer chrome — this is the #18 deliverable and
> the no-JS fallback. **[·· 18-AC1 HTML+chrome ··]** Colours identical in both:
> green=done, red=missed-past, grey=future, white=rest. **[·· 18-AC2 · 18-AC3 ··]**

---

## 5. LOG ENTRY (bottom sheet over Today)

```
┌────────────────────────────────────────────┐
│  (Today dimmed behind)                       │
│  ╭──────────────────────────────────────╮   │
│  │            ▁▁▁ grabber ▁▁▁            │   │  ← LogSheet (slides up)
│  │  Log · Tue · Strength A — Pull        │   │
│  │                                        │   │
│  │  Top set (weighted pull-up)            │   │
│  │  [ − ]   32.5 kg   [ + ]               │   │  ← Stepper (chalk-proof ± buttons)
│  │                                        │   │
│  │  RPE                                   │   │
│  │  6  7  [8]  9  10                      │   │  ← ChipRow (single-select)
│  │                                        │   │
│  │  Left shoulder pain (0–10)             │   │
│  │  [0] 1  2  3  4  5 …                    │   │  ← ChipRow, default 0 (safety flag)
│  │                                        │   │
│  │  ┌──────────────────────────────────┐ │   │
│  │  │           SAVE & MARK DONE      ▓ │ │   │  ← primary; also sets done=1
│  │  └──────────────────────────────────┘ │   │
│  │            Cancel                      │   │
│  ╰──────────────────────────────────────╯   │
└────────────────────────────────────────────┘
```

- Fields pre-scoped to today's session (top-set exercise pulled from PLAN.md today card).
- **Save** → `POST /fitness/api/log` then (if not already) `POST /fitness/done` →
  sheet closes → Today shows a "logged" chip on the DayHeading.
- Shoulder-pain field is deliberately present every session (athlete-profile safety flag);
  a value ≥4 could later surface a physio nudge (out of scope for v2, noted for #22/#27).
- Cancel writes nothing.

---

## 6. Traceability — every #17 / #18 AC has a home

| Issue | Acceptance criterion | Where in wireframes |
|---|---|---|
| #17-AC1 | Done button visible without scrolling (mobile+desktop) | §1 DoneButton sits under hero, above the fold at 390px |
| #17-AC2 | Click marks done, button shows confirmed | §1 DoneButton state C "TRAINED · HH:MM" |
| #17-AC3 | Refresh after marking shows confirmed | §1 note: `GET /fitness/done/today` picks state on load |
| #17-AC4 | Re-click already-done day → 200, not 409 | §1 DoneButton state D + note (idempotent) |
| #17-AC5 | No duplicate SQLite rows for a date | §1 note (server-derived date, idempotent POST) |
| #18-AC1 | `GET /fitness/stats` HTML with same chrome | §4 SSR page note + footer "→ Stats" link (§1 footer) |
| #18-AC2 | Train days green(done)/red(missed-past)/grey(future) | §4 StreakCalendar cells ▓ / ✗ / ▢ |
| #18-AC3 | Rest days visually distinct (white/neutral) | §4 calendar `·` cells; §2/§3 rest cards neutral |
| #18-AC4 | Summary: current streak, longest, week%, month% | §4 StatSummary row |
| #18-AC5 | Works with zero rows (empty state) | §4 Stats empty-state variant |
| #18-AC6 | `config.json` gains `trainingDays` (0=Sun) | already present `[1,2,4,5]`; §3/§4 consume it; shared with #15 highlight |

_Note: `config.json` already carries `trainingDays: [1,2,4,5]` (Mon/Tue/Thu/Fri) and
`trainingDayKeywords`, so #18-AC6 is effectively met; this spec just consumes it in Week
+ Stats and confirms it as the single source for "is today a training day"._

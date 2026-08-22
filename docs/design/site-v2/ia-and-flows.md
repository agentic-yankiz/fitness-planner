# Site v2 — Information Architecture & Flows (UX)

_Companion to `brief.md`. Screens, navigation, flows, and every edge/empty state.
Phone-first at 390px; one hand, chalky fingers, arm's length._

## 1. Screen map

```
                 ┌─────────────────────────────────────────┐
                 │  HOST/fitness/   (tailnet-only)          │
                 └─────────────────────────────────────────┘
                                   │
        ┌──────────────┬───────────┴───────┬──────────────┐
        ▼              ▼                    ▼              ▼
   ┌─────────┐   ┌─────────┐          ┌─────────┐   ┌───────────┐
   │  TODAY  │   │  WEEK   │          │  STATS  │   │ LOG ENTRY │
   │ default │   │ overview│          │adherence│   │  (modal)  │
   └─────────┘   └─────────┘          └─────────┘   └───────────┘
        └──────── bottom tab bar ──────┘                  ▲
        (Today · Week · Stats)                            │
        Log entry opens as a sheet from Today ────────────┘
```

- **4 screens.** Three are peers reachable from a **persistent bottom tab bar**
  (thumb-reachable, big targets): **Today · Week · Stats**.
- **Log entry is not a tab** — it's a **bottom sheet/modal** launched from Today
  (and reachable from a day in Week). It's an action on a session, not a place.

### Why a bottom tab bar

- One-hand reach: thumb naturally rests at the bottom of a 390px phone.
- Today is the default and the job done most often; Week/Stats are one tap away → J1
  "Today in ≤2 taps" is actually 0 taps to Today, 1 tap to the others.
- No hamburger menu (hidden nav = extra taps + precision; bad with chalk).

## 2. Navigation model

- **Landing = Today.** Cold open drops straight onto today's session.
- **Bottom tabs** persist across Today/Week/Stats; active tab highlighted with the
  accent green. Tabs are labelled **icon + text** (text matters at arm's length).
- **Log entry** slides up as a sheet over Today; dismiss returns you exactly where
  you were. The Done button lives on Today (and the sheet), not in the tab bar.
- **No deep nesting, no back-button reliance.** Everything is one tap from a tab.
- **URLs (progressive enhancement, tailnet):**
  - `/fitness/` → Today (default render of PLAN.md today-section + runtime widgets)
  - `/fitness/#week` / `/fitness/#stats` → client-switched tabs when JS is on
  - `/fitness/stats` → **server-rendered Stats HTML** (the #18 page) — also the
    **no-JS / fallback** address for Stats. Linked from the footer ("→ Stats") so the
    existing #18 acceptance criterion holds even without the tab bar.

## 3. Data sources per screen

| Screen | Static (PLAN.md, read-only) | Runtime (Node/SQLite #16) |
|---|---|---|
| Today | today's day card, exercises, videos, wave-week hero | done-state (`GET /fitness/done/today`), quick-log values |
| Week | full week tables, wave levers | per-day done ticks (from sessions) |
| Stats | which days are training days (`trainingDays`) | sessions history → streaks, rates, calendar |
| Log entry | exercise names/targets for context | writes quick-log + done |

**Authoritative runtime contracts (from #16/#17/#18 — unchanged by this spec):**

```
POST /fitness/done            → 200 { date, done: true, logged_at }   (idempotent)
GET  /fitness/done/today      → 200 { date, done: bool }
GET  /fitness/stats           → 200 text/html  (SSR stats page, full chrome)
```

**v2 additive (recommended, for the client-switched Today/Stats tabs; does not
replace the SSR page):**

```
GET  /fitness/api/stats       → 200 { currentStreak, longestStreak,
                                       weekRate, monthRate, days:[{date,state}] }
POST /fitness/api/log         → 200 { date, fields:{topSet,rpe,shoulderPain}, logged_at }
```

> If the additive JSON endpoints are not built, Today/Week degrade gracefully (done
> button still works via the #17 contract; Stats is reached via the SSR `/fitness/stats`
> link). The SSR page is always the source of truth and the fallback.

## 4. Core flows

### F1 — Open app, see today, mark done (the main loop; J1+J2)

```
Cold open → Today renders (static plan paints instantly)
          → client calls GET /fitness/done/today
             ├─ {done:false} → Done button = actionable "Mark trained"
             └─ {done:true}  → Done button = confirmed "Trained ✓ · Undo"
Tap "Mark trained"
   → optimistic: button flips to Trained ✓ immediately
   → POST /fitness/done
        ├─ 200 → keep confirmed; show brief "logged HH:MM"; reveal Undo (a few s)
        └─ error/timeout → revert button, toast "Couldn't save — tap to retry"
Refresh page → GET /fitness/done/today = {done:true} → button already confirmed
```

Idempotent: tapping an already-done day → `POST /fitness/done` returns 200 (not 409),
button stays confirmed, no duplicate row.

### F2 — Quick-log real numbers (J3)

```
On Today, tap "Log numbers" (secondary action under Done)
   → bottom sheet opens with ~3 fields, pre-scoped to today's session:
        • Top set / key load   (stepper + free number)
        • RPE                  (1–10 chip row)
        • Left shoulder pain   (0–10 chip row; default 0)
   → "Save" → POST /fitness/api/log → sheet closes, Today shows a small "logged" chip
   → Saving also marks done (done implied by logging) unless already done.
Dismiss without saving → nothing written.
```

Keep it to a few taps: chips/steppers over free text; keyboard only if he wants an
exact load. Durable per-exercise history still lives in `tracking/*.md` (#28); this
is the fast, in-the-moment capture.

### F3 — Check the rest of the week (J5)

```
Tap "Week" tab → vertical list of day cards Mon…Sun
   → current day highlighted (accent), reuses #15 today logic
   → each training day shows a done tick if recorded
   → deload week → cards carry the amber deload treatment + "recover" note
Tap a day → expands to its exercise table (or scrolls to it)
```

### F4 — Check consistency (J4)

```
Tap "Stats" tab (JS) → streak header + calendar + rates
   (no JS / fallback → footer "→ Stats" link → SSR /fitness/stats, same data)
```

## 5. Edge & empty states (must all be designed)

| State | Trigger | Today | Week | Stats |
|---|---|---|---|---|
| **Rest day** | today's `getDay()` ∉ `trainingDays` (Wed/Sun) | "Rest day 😌 — walk, mobility, sleep." No Done button (nothing to mark); optional "Log a walk" is out of scope → just a calm rest card. | day card shows "Rest"; no tick expected | rest days rendered white/neutral, never "missed" (#18-AC3) |
| **Optional day (Sat)** | `getDay()==6`, day 5 | shows the optional finisher card + "skip if only 4 days" note; Done available but not expected | shown as optional | counts only if trained; not a "miss" if skipped |
| **Deload week** | `week ≥ deloadWeek` (5) | hero uses amber deload style, "recover" phase, scaled levers; exercises shown at deload scaling note | all cards amber; "deload — recover" banner | calendar/rates unchanged; label notes deload weeks |
| **Missed day(s)** | past training day with `done=0` | n/a (Today is always today) | past day card shows a muted "missed" mark | past training days render red (#18-AC2) |
| **Zero data** | `sessions` empty (fresh DB) | Done button actionable; no "logged" chips | no ticks yet | empty-state message: "No sessions logged yet — tap Done after training and your streak starts here." (#18-AC5) |
| **Server down** | fetch fails / 5xx / timeout | static plan still renders; Done button shows "state unavailable — read-only" (disabled, muted); a "retry" affordance | ticks omitted, plan intact | tab shows "Stats need the server — it's offline right now." SSR link also dead → covered by static fallback copy |
| **Off-tailnet** | host unreachable (no response) | browser can't load the page at all → this is the **static read-only fallback**: the last-built `dist/index.html` served by Caddy with no Node. Done/quick-log/stats widgets render in their disabled "read-only" state. | plan intact, no runtime | footer link explains stats are server-only |
| **Future day (in calendar)** | training day after today | — | — | grey, not red (#18-AC2) |
| **Slow network** | fetch pending | plan painted; Done button shows a subtle loading state, not a blocking spinner | — | skeleton then data |

### Server-down / read-only fallback principle

The **static plan is always the floor.** PLAN.md → `dist/index.html` renders with zero
runtime. All runtime widgets are **progressive enhancement**: if the Node server or
tailnet is gone, the page is still a correct, readable plan. Runtime controls switch to a
clearly-labelled **read-only** appearance (visible but inert) rather than disappearing or
erroring — so Shaked always knows *why* he can't tap Done, not just that it's broken.

## 6. Accessibility / ergonomics rules (apply everywhere)

- Tap targets **≥44px**, primary actions ~48–56px tall, full-width where sensible.
- Thumb zone: primary actions (Done, tab bar, sheet Save) in the **bottom third**.
- Color is never the only signal: done/missed also carry a ✓ / label / icon (colour-blind
  and glance-safe).
- Minimum body text 16px (matches current `styles.css`); key state larger.
- Respect `prefers-reduced-motion`: optimistic flips are instant, not animated, when set.
- No hover-only affordances (touch device).

## 7. Traceability (screen ⇄ issue)

Detailed element-level mapping lives in `wireframes.md §Traceability`. Summary:

- **#17 (Done button):** Today screen (F1). AC1 visible-no-scroll, AC2 confirmed
  state, AC3 refresh-persists, AC4 idempotent, AC5 no-dupes.
- **#18 (Stats):** Stats screen + SSR `/fitness/stats` (F4). AC1 HTML+chrome,
  AC2 green/red/grey, AC3 rest neutral, AC4 summary row, AC5 empty state,
  AC6 `trainingDays` in config.

# Site v2 — Components & Visual Direction (UI)

_Component inventory + a visual language that **extends the existing `site/styles.css`
tokens** — same warm-paper, light, readable-at-arm's-length feel. No new design system;
just a small set of reusable pieces and a handful of new tokens._

## 1. Visual direction

- **Keep the current mood:** warm paper background, slate ink, one calm green accent,
  amber for deload/recover. Light only — **no dark mode** (by design, per `styles.css`).
- **Bigger, calmer, thumb-first.** The current page is a document; v2 is a *companion*.
  That means larger primary controls, a fixed bottom tab bar, and generous spacing — but
  the *same colours and type*, so it reads as the same product.
- **Glanceable state first.** The three things visible from a metre away: *which day is it,
  did I train, am I in deload*. Everything else is secondary.
- **Progressive enhancement, not SPA rewrite.** The static PLAN.md render stays the floor;
  components layer on top. If JS/server is gone, components fall back to inert/read-only.

### Existing tokens (reused as-is, from `styles.css`)

```
--bg:#faf9f6  --card:#fff  --ink:#1f2933  --muted:#6b7280  --line:#e7e5e0
--accent:#2f6f4f  --accent-soft:#eaf3ee   (green — done, today, primary)
--deload:#b45309  --deload-soft:#fdf3e7   (amber — deload/recover, missed accents)
--good:#2f6f4f  --warn:#b45309  --maxw:800px
```

### New tokens (proposed additions — small, on-theme)

```
--miss:#b4453a          /* muted brick red — "missed" cells only; softer than pure red */
--miss-soft:#f7ebe9
--upcoming:#d8d5cf       /* grey — future training day cells */
--tap-min:44px          /* min touch target (HIG) */
--tap-primary:56px      /* Done / Save button height */
--tabbar-h:60px
--sheet-radius:16px
--focus:#2f6f4f         /* visible keyboard/focus ring = accent */
```

Rationale: `--miss` is a *desaturated* red so a wall of missed days doesn't feel punishing
or clash with the calm palette; it still reads clearly as "not done" and passes contrast on
paper background.

## 2. Component inventory

| Component | Role | Key states | Tokens |
|---|---|---|---|
| **AppShell** | page frame: TopBar + scroll area + fixed TabBar | — | bg, maxw |
| **TopBar** | app title, sticky top, no menu | — | ink, line |
| **TabBar** | fixed bottom nav: Today · Week · Stats | active / inactive; each ≥`--tap-min`, icon+label | accent (active), muted (inactive), card bg, `--tabbar-h` |
| **WaveHero** | current block/week + levers | loading (green) / deload (amber) | reuses existing `.hero` / `.hero.deload` |
| **DayHeading** | "TODAY · Tuesday · 💪 Strength A" | today (accent) / other | accent-soft, accent |
| **DoneButton** | mark today trained | actionable / saving / confirmed / confirmed+undo / read-only / (absent on rest) | accent fill; muted when read-only; `--tap-primary` |
| **UndoLink** | revert a just-marked done | visible for a few s post-confirm | accent text |
| **LogButton** | open the log sheet | default / disabled (server down) | accent outline (secondary) |
| **ExerciseRow** | one exercise: name · sets×reps · rest · ▶ video | default; ▶ is its own ≥44px target | ink, muted, accent (link) |
| **VideoLink (▶)** | opens exercise video (new tab) | default | accent |
| **RestCard** | rest-day message + "next session" | — | muted, card |
| **DayCard** (Week) | one day summary + done tick | past-done ✓ / today / upcoming / missed / rest / optional | accent, `--miss`, `--upcoming`, muted |
| **StatSummary** | 4-up: streak · longest · week% · month% | populated / zero | ink, accent, muted |
| **StreakCalendar** | 30-day grid, weekday columns | cell: trained ▓ / missed ✗ / future ▢ / rest · | accent, `--miss`, `--upcoming`, card |
| **LogSheet** | bottom-sheet quick-log | open / closing; save / cancel | card, `--sheet-radius` |
| **Stepper** | ± numeric input (load) | default; big ± targets | line, ink, `--tap-min` |
| **ChipRow** | single-select scale (RPE, pain) | selected / unselected | accent-soft (selected), line |
| **Toast** | transient feedback ("logged 18:42", "couldn't save — retry") | success / error | card, accent / warn |
| **EmptyState** | zero-data / server-down messaging | — | muted, card |
| **Footer** | build stamp · `source PLAN.md` · "→ Stats" link | — | reuses existing `.stamp` |

### Component ⇄ issue mapping (the pieces #17/#18 asked for)

- **DoneButton + UndoLink** → #17 (all 5 ACs; see `wireframes.md §1`).
- **StreakCalendar + StatSummary + StatsEmpty(EmptyState)** → #18 (AC2–AC5).
- **Footer "→ Stats" link** → #18-AC1 (keeps the SSR page reachable).
- **DayCard / WaveHero today-state** → consume `trainingDays` (#18-AC6, shared w/ #15).

## 3. Key component specs

### DoneButton (the hero control)

- Full-width, `--tap-primary` (56px) tall, high-contrast green fill, big check glyph.
- **States** (visuals in `wireframes.md §1`): actionable → saving (optimistic flip) →
  confirmed (`TRAINED · HH:MM`) → confirmed+undo → read-only (muted, inert, "retry").
- **Optimistic:** flips on tap before the network returns; reverts + Toast on failure.
- **Idempotent** by contract (#17-AC4/AC5): re-tap posts again, server returns 200, UI
  unchanged.
- **Absent on rest days** (nothing to mark) — replaced by RestCard.

### StreakCalendar

- Weekday-column grid, most recent ~30 days; rows are weeks (Mon-first to match PLAN.md).
- Cell colour is driven by `(isTrainingDay, done, past/future)`:
  - training + done → `--accent` (▓)
  - training + past + not done → `--miss` (✗)
  - training + future → `--upcoming` (▢)
  - rest day → `--card`/white (·), no fill — never counts as missed (#18-AC3)
- Each cell also carries a glyph/aria-label (not colour-only) for glance + a11y.
- Renders identically in the JS tab and the SSR `/fitness/stats` page (same class names,
  same tokens) so the two stay visually in sync.

### ChipRow / Stepper (chalk-proof input)

- Big discrete targets over sliders/free-text; a slip of a chalky finger lands on an
  adjacent value, not a wrong order of magnitude.
- Stepper keeps a raw number field for exact loads, but ± buttons do the common case.

## 4. Type & spacing

- Body 16px/1.6 (unchanged). Primary state (day name, streak number) 1.15–1.5rem.
- Touch spacing: ≥8px between adjacent targets; tab bar items ≥64px wide.
- Reuse existing table styling for ExerciseRow where possible (the `.plan table` rules);
  v2 mainly *reframes* content in cards + a tab bar, it doesn't restyle the plan tables.

## 5. Responsive / fallback behaviour

- **390px first**, scales up to the existing `--maxw:800px` centred column on desktop; the
  bottom TabBar becomes a top or inline nav on wide screens (optional — desktop is not the
  target).
- **No-JS:** TabBar/DoneButton/LogSheet degrade to plain links + the SSR pages; the plan
  and the "→ Stats" link still work.
- **Server down / off-tailnet:** runtime components render their read-only/empty variant;
  the static plan is untouched. (See `ia-and-flows.md §5`.)
- Honour `prefers-reduced-motion` (no sheet slide / optimistic pulse when set) and
  `color-scheme: light`.

## 6. What this deliberately does NOT add

- No icon-font/SVG-sprite system (emoji + a couple of inline glyphs are enough).
- No CSS framework, no component library, no build-time CSS-in-JS — plain `styles.css`
  extended with the tokens above, matching the project's no-dependency ethos.
- No new colours beyond the three additions in §1; the palette stays calm.

# TASK: auto-published site for the plan

> **Status: ✅ BUILT — on fly.io, not GitHub Pages.** The implementation lives in
> [`../site/`](../site/) with the workflow at `.github/workflows/workout-program-site.yml`.
> See [`../site/README.md`](../site/README.md) for setup. This doc is kept as the design
> rationale; the sections below describe the *original Pages plan* — read the note next.
>
> **Why fly.io instead of Pages:** the deciding requirement was **privacy** — Shaked wanted
> the page gated to himself. Login-gated GitHub Pages needs GitHub Enterprise Cloud (not a
> personal account), and Pages on a public repo would put bodyweight / shoulder-pain /
> benchmarks on the open, indexable web. fly.io (the repo's existing hosting convention, used
> by `telegram-claude-bot`) serves the same static build behind **HTTP basic auth** via Caddy —
> a private, password-gated **live URL** that opens instantly on a phone. Everything else in
> this spec carried over unchanged: light/no-dark UI, current-week hero, progress from
> `tracking/`, the version + deploy-time footer stamp, and the Telegram ping (version + URL).
>
> _Original status: proposed / not started. Owner: Shaked._

## Goal

Turn the Markdown plan into a **live web page** that updates itself — so Shaked can open
one bookmark on his phone at the gym instead of scrolling raw Markdown on GitHub.

Three things the page must do, in priority order:

1. **Show the plan** — the day-by-day training tables from `PLAN.md`, clean and glanceable.
2. **Mark the current week** — make it obvious which week of the 4-week wave he's in
   right now (and that Week 5 is a deload), with that week's loads/RPE scaled.
3. **Show progress** — a small, honest view of where the numbers are trending
   (bodyweight, key lift loads, benchmark PRs) pulled from `tracking/`.

It publishes on every push to `workout-program/` — no manual deploy step. *(Original plan;
auto-deploy on push is currently suspended — the workflow runs manual `workflow_dispatch`
only.)* This is the read-only "front door" to the same Markdown that stays the source of truth; it
complements the `show-weekly-plan` skill (which renders the same view inside a chat session).

---

## Look & feel — the non-negotiables

> Shaked asked for: **clean, light (NOT dark mode), human-readable, no junk.**

- **Light theme only.** Warm off-white "paper" background, dark slate text, **one** accent
  colour. No dark-mode toggle, no theme switcher — one calm, readable look.
- **No junk.** No cookie banner, no analytics, no ad of any kind, no sign-in, no chat widget,
  no heavyweight JS framework, no web-font download blocking the render. Use the **system font
  stack**. The whole page should be a couple of small files.
- **Readable column.** Cap content width (~`720–820px`), generous line-height and whitespace,
  real table styling (zebra rows, sticky-ish headers on the day tables).
- **Glanceable, not a wall of text.** Mirror `PLAN.md`'s own rule: tables and short lines win;
  deep "why" stays in `knowledge/` and is *linked*, not inlined.
- **Print-friendly.** A `@media print` block so the week prints onto one clean page (Shaked
  explicitly likes a printable plan — see `athlete-profile.md`).
- **Phone-first.** It will mostly be read on a phone mid-session: tap targets, no horizontal
  scroll, tables that reflow or scroll gracefully on narrow screens.
- **Accessible.** Real semantic headings, sufficient colour contrast (light theme still has to
  pass AA), `alt`/`aria` on the progress charts.

---

## Recommended architecture

```
 push to                GitHub Actions                         GitHub Pages
 workout-program/**     ───────────────                        ────────────
 (PLAN.md, tracking/,   on: push (paths-scoped):          ──▶  static site served at
  athlete-profile.md)   1. node site/build.mjs                 https://<owner>.github.io/
        │                  reads PLAN.md + tracking/*.md        monorepo/workout/
        └──────────▶        + athlete-profile.md          ◀──   (light, clean, auto-updated)
                           → site/dist/index.html (+ css)
                        2. upload-pages-artifact
                        3. deploy-pages
```

### 1. Source of truth stays Markdown
- The site is a **pure render** of files already in this project. It must add **no new
  canonical data** — if the site and `PLAN.md` ever disagree, `PLAN.md` wins.
- Build inputs: `PLAN.md` (the plan + the "how each week gets harder" wave table),
  `tracking/week-*.md` (progress), `athlete-profile.md` (goals/benchmarks for the header).

### 2. Build — a tiny custom generator, not a themed SSG

> **Version stamp (required).** Every deployed page must show **which commit it was built from**
> and **when it was deployed** — so Shaked can tell at a glance whether he's looking at the
> latest plan. The workflow passes the build the short commit SHA (`${{ github.sha }}` → first
> 7 chars) and a UTC build timestamp via env; `build.mjs` reads them and renders them in a small,
> unobtrusive **footer** line, e.g. `v 97dab1c · deployed 2026-06-13 06:23 UTC`. Link the SHA to
> the commit on GitHub. Keep it quiet (small, muted) — it's provenance, not junk. Fall back to
> `dev` / "local build" when the env vars are absent (local runs).

- Add `workout-program/site/build.mjs`: **Node + `markdown-it`** (Node/TS matches
  `telegram-claude-bot`). It converts the Markdown to HTML and drops it into a single
  hand-written template with the light CSS inlined (or one `styles.css` next to it).
- **Why not Jekyll** (the GitHub Pages default): Jekyll pulls in a theme and config baggage
  and fights the "one calm custom light look, no junk" requirement. A ~100-line build script
  gives full control of the markup and CSS and stays junk-free. *(If Shaked would rather not
  own any build code, plain Jekyll with a stripped minimal layout is the fallback — call it
  out as an open decision, don't silently pick it.)*
- Output is fully static: `site/dist/index.html` + `styles.css`. No client framework. Any JS
  is a few lines of vanilla (e.g. to draw the inline-SVG sparklines) and the page must still
  read fine with JS disabled.

### 3. "Current week" — derive it, don't hardcode it
The page has to highlight the right week without Shaked editing HTML each Monday.

- **Source the current position from the logs**, which already declare it: each
  `tracking/week-*.md` opens with `# Training Log — Block ___ / Week ___`. The build reads the
  **newest** `tracking/week-*.md`, parses Block/Week, and treats that as "current".
- **Fallback / first run** (no logs yet): a single declared field — e.g. `current-week` in a
  small `workout-program/site/config.json`, or front-matter at the top of `PLAN.md` — so the
  site still knows the week before any log exists. Pick **one** mechanism and document it.
- Render it as: a **badge** in the header (`Block 2 · Week 3 of 4 · RPE 8–9 · loading`), and
  **highlight the current column** in the "How each week gets harder" table. The day tables
  show that week's *scaled* loads (apply the wave table exactly like the `show-weekly-plan`
  skill does) with a one-line note of what changed vs. base.
- Make **deload (Week 5)** visually distinct (different accent / "recover" label) so a deload
  week never looks like a missed-progress week.

### 4. "Show progress" — small and honest, no chart-library bloat
- Parse the **Body check-in** table and the **Week-5 benchmark re-test** table out of each
  `tracking/week-*.md`, ordered by date.
- Render a compact **Progress** section:
  - Bodyweight trend, left-shoulder-pain trend (0–10), key lift loads (weighted pull-up,
    14 mm max-hang load) over time.
  - Benchmark PRs from the deload re-tests (max weighted pull-up, longest lock-off / planche
    hold, hardest boulder).
- **Charts = inline SVG sparklines** drawn by the build (no Chart.js / D3 — that's exactly the
  "junk" to avoid). A small trend line + the current number is enough; a plain table is an
  acceptable first cut if sparklines slip.
- **Shoulder honesty:** show the pain trend plainly; never frame rising shoulder pain as a win.
  Keep a one-line link to `knowledge/shoulder-physio.md` and the medical disclaimer in the footer.
- If `tracking/` is empty, the section shows a friendly "no logs yet — fill `tracking/` to see
  progress" placeholder instead of an empty/broken chart.

### 5. Publish — one scoped Pages workflow
- Add `.github/workflows/workout-program-pages.yml`, **paths-scoped** exactly like every other
  project workflow (root `CLAUDE.md` isolation rule):
  ```yaml
  on:
    push:
      branches: [main]
      paths:
        - 'workout-program/**'
        - '.github/workflows/workout-program-pages.yml'
  ```
  This is a **push-triggered build**, so the standard `paths:` filter *is* the isolation
  mechanism here (unlike the issue-triggered feedback-loop spec, which is label-guarded).
- Steps: checkout → setup-node → `npm ci` (or no-deps if `markdown-it` is vendored) →
  `node site/build.mjs` → `actions/upload-pages-artifact` (path `workout-program/site/dist`) →
  `actions/deploy-pages`.
- Use the modern **GitHub Actions Pages** flow with least-privilege permissions and a
  concurrency group so overlapping pushes don't race:
  ```yaml
  permissions:
    contents: read
    pages: write
    id-token: write
  concurrency:
    group: pages
    cancel-in-progress: true
  ```
- Set `defaults.run.working-directory: workout-program` so steps run inside the project
  (root rule for project workflows).

### 6. Notify Telegram when the deploy succeeds
After `deploy-pages` reports success, post the **published URL** to Shaked's Telegram so he
gets a "your plan is live" ping instead of having to check Actions.

- Add a final step guarded by `if: success()` (and only on the real `main` deploy, not PR
  previews) that calls the Telegram Bot API:
  ```yaml
  - name: Notify Telegram
    if: success()
    env:
      TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
      TELEGRAM_CHAT_ID:   ${{ secrets.TELEGRAM_CHAT_ID }}
      PAGE_URL:           ${{ steps.deployment.outputs.page_url }}
      VERSION:            ${{ github.sha }}
    run: |
      SHORT="${VERSION:0:7}"
      WHEN="$(date -u '+%Y-%m-%d %H:%M UTC')"
      curl -fsS -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
        --data-urlencode "disable_web_page_preview=false" \
        --data-urlencode "text=🏋️ Workout plan deployed · v ${SHORT} · ${WHEN}
      ${PAGE_URL}"
  ```
- The message must carry **both the version and the link** — same `v <sha>` the page footer
  shows, so a Telegram ping and the live page can be matched to the same deploy.
- **Two secrets are needed**, not one: `TELEGRAM_BOT_TOKEN` (the BotFather token — the existing
  secret, same name `telegram-claude-bot` uses) **and** `TELEGRAM_CHAT_ID` (the destination
  chat). The token alone can't address a message; if only the token exists today, the chat id
  still has to be added (or hardcoded if Shaked is fine with it in the workflow — it's not
  sensitive). **Confirm the exact secret name** so it isn't guessed wrong — see open decisions.
- The notify step must **never fail the deploy**: the Pages publish is the real job. Either keep
  it last (so a notify failure can't unpublish anything) or add `continue-on-error: true`.
- Skip the curl quietly if `TELEGRAM_CHAT_ID`/token are unset, so a fork without the secrets
  still deploys cleanly.

---

## ⚠️ Monorepo constraint: one Pages site per repo

A repository gets **exactly one** GitHub Pages site at one URL. This monorepo has many
projects, so a future project that also wants Pages will **collide** with this one. Decide the
ownership model up front and document it in the workflow header so it isn't broken later:

- **Recommended:** publish this project into a **subpath** of the shared Pages site — build the
  artifact under `/workout/` and set the site's base path so asset/links resolve under that
  prefix (`https://<owner>.github.io/monorepo/workout/`). A future project publishes under its
  own subpath; the `concurrency: pages` group serialises deploys. *(Two workflows writing the
  same Pages site is the sharp edge — flag it.)*
- **Simpler, but exclusive:** declare that `workout-program` owns the repo's Pages site for now
  and revisit if a second project needs one.

Pin the base-path assumption in **one** config constant so it's a one-line change later.

---

## Files to create (suggested)

| Path | Purpose |
|---|---|
| `workout-program/site/build.mjs` | Read the Markdown → emit static `dist/` (plan + current week + progress) |
| `workout-program/site/template.html` | The light, junk-free page shell (or inline in `build.mjs`) |
| `workout-program/site/styles.css` | Light theme, readable column, print + mobile rules |
| `workout-program/site/config.json` | Base path + first-run `current-week` fallback, model-free config |
| `workout-program/site/README.md` | How the site builds, how to run it locally, where the data comes from |
| `.github/workflows/workout-program-pages.yml` | Paths-scoped build, deploy-to-Pages, and Telegram-notify workflow |

> Keep all site code **inside `workout-program/`** (root rule: one directory = one project;
> no source at the repo root). Only the workflow file lives under `.github/` (GitHub requires it).

## Security & cleanliness
- **Only the Telegram secrets** — the build/deploy itself needs no secret beyond the default
  `GITHUB_TOKEN` the Pages action uses. The single extra ask is the Telegram notify step, which
  reads `TELEGRAM_BOT_TOKEN` (+ `TELEGRAM_CHAT_ID`) from repo secrets — never hardcode the token.
- **Least-privilege** `permissions:` as shown (`pages: write` + `id-token: write` for deploy,
  `contents: read`). Nothing writes back to the repo.
- The data is Shaked's own committed Markdown, but treat the site as **public**: don't surface
  anything in `tracking/`/`athlete-profile.md` that shouldn't be public (it's a personal program;
  confirm he's fine with bodyweight/benchmarks being on the open web — see open decisions).
- **No third-party requests at runtime** (no CDN fonts, no analytics) — keeps it private, fast,
  and junk-free, and means no consent banner is ever needed.

## Acceptance criteria
- [ ] Pushing a change to `PLAN.md` (or `tracking/`) auto-rebuilds and redeploys the Pages site.
- [ ] The page is **light mode**, system-font, single readable column, no analytics/cookie/junk.
- [ ] It renders the day-by-day plan tables and the warm-up + shoulder-prehab blocks.
- [ ] The **current week** is unmistakable: header badge + highlighted column in the wave table,
      with that week's scaled loads/RPE; deload week looks distinct.
- [ ] A **Progress** section shows bodyweight + key-lift + shoulder-pain trends and benchmark PRs
      from `tracking/`, and degrades gracefully to a placeholder when no logs exist.
- [ ] Every deployed page shows a footer stamp with the **build commit (short SHA, linked)** and
      the **deployment date-time (UTC)**.
- [ ] Prints to one clean page and reads well on a phone.
- [ ] The Pages workflow is paths-scoped to `workout-program/**` + its own file, least-privilege,
      with a `concurrency: pages` group; its header documents the one-Pages-site constraint.
- [ ] On a successful `main` deploy, the workflow sends Shaked's Telegram a message containing
      **both the version (commit SHA) and the page link**, and a notify failure (or missing
      secret) never fails the deploy.
- [ ] `PLAN.md` stays the source of truth — the site adds no new canonical data.

## Open decisions (confirm with Shaked before building)
1. **Public vs. private:** GitHub Pages on a public repo is **public**. OK to put bodyweight,
   benchmarks, and shoulder-pain numbers on the open web? If not → private repo + Pages (needs a
   plan tier) or strip personal metrics from the published build.
2. **Current-week source:** newest `tracking/week-*.md` header (recommended) vs. an explicit
   `config.json` field vs. `PLAN.md` front-matter. Pick one.
3. **Pages ownership:** subpath model (future-proof, recommended) vs. workout-program owns the
   single Pages site for now.
4. **Progress visuals:** inline-SVG sparklines (recommended) vs. plain tables for v1.
5. **Build stack:** tiny custom `markdown-it` build (recommended, full control of the look) vs.
   stripped-down Jekyll (native to Pages, but theme baggage).
6. **Telegram notify:** confirm the **exact secret names** (`TELEGRAM_BOT_TOKEN` is assumed to
   already exist; a `TELEGRAM_CHAT_ID` for the destination chat likely still needs adding), and
   whether the chat id goes in a secret (recommended) or is hardcoded in the workflow.

## Out of scope (for the first version)
- Editing the plan or logging workouts **from** the web page (it's read-only; logging stays in
  `tracking/` / the future issue-form feedback loop).
- Auth, multi-user, or per-athlete pages — this is Shaked's single program.
- A dark mode, theme switcher, or any toggle — explicitly **not** wanted.
- Wearable/Apple-Health import, heavy chart libraries, custom domain/DNS.
- Replacing the `.claude/` skills — the site **renders** the same plan the `show-weekly-plan`
  skill produces; it doesn't replace the progression logic.

## Related
- Render logic to mirror: `.claude/skills/show-weekly-plan` (scales the wave to the current week).
- The wave/progression rules the "current week" scaling must follow: `PLAN.md` "How each week
  gets harder" + `knowledge/training-principles.md`.
- Progress data shape to parse: `tracking/log-template.md` (body check-in + benchmark re-tests).
- Sibling automation spec (issue-triggered, label-guarded): `docs/TASK-training-feedback-loop.md`
  — the two differ in trigger/isolation model; keep them straight.
</content>
</invoke>

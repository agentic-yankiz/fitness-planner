# Workout site — private, light (deploy currently manual)

A tiny static site that renders [`../PLAN.md`](../PLAN.md) (the source of truth) into a clean,
**light** (no dark mode), junk-free web page you can open on your phone. It:

- shows the day-by-day plan,
- **marks the current week** of the 4-week wave (a hero card + that week's scaled levers),
- shows **progress** parsed from [`../tracking/`](../tracking/) (bodyweight, shoulder-pain, sparklines),
- stamps every page with the **build commit + deploy time** (footer),
- deploys to **fly.io behind HTTP basic auth** (private), and **pings Telegram** with the version + URL on success.

It is read-only — it never writes back. If the site and `PLAN.md` disagree, `PLAN.md` wins.

> **Deploy is currently manual-only.** Auto-deploy on push is **suspended** — the workflow
> runs only via `workflow_dispatch`. See the header of
> [`../../.github/workflows/workout-program-site.yml`](../../.github/workflows/workout-program-site.yml)
> to re-enable the push trigger.

## How it works

```
manual run (workflow_dispatch)  →  GitHub Actions  →  flyctl deploy (remote build)  →  fly.io (Caddy + basic auth)
                                      │                                                    │
                                      └── build.mjs reads PLAN.md + tracking/      Telegram ping (version + URL)
                                          → dist/index.html (+ styles.css)
```

- `build.mjs` — the generator (Node + `markdown-it`, no framework).
- `styles.css` — the light theme (print- and mobile-friendly).
- `config.json` — title, wave length, and the **first-run** `currentWeek` fallback.
- `Dockerfile` / `Caddyfile` / `fly.toml` — build-and-serve, with basic-auth gating.
- `../../.github/workflows/workout-program-site.yml` — the deploy + notify workflow (push
  trigger currently suspended; manual `workflow_dispatch` only).

### Current week
Derived from the **newest** `../tracking/week-YYYY-MM-DD.md` (its first line declares
`Block N / Week M`). With no logs yet, it falls back to `config.json` → `currentWeek`.

## Run it locally

```bash
cd workout-program/site
npm install
npm run build        # writes ./dist
# open dist/index.html in a browser
```

`GIT_SHA` and `BUILD_TIME` are read from the environment for the footer stamp; without them
the footer shows `local build`.

## Dev server (via Tailscale)

Serve the site locally at `/fitness` path prefix (ready to access via Tailscale):

```bash
cd workout-program/site
npm install
npm run dev          # builds with /fitness base path, starts Caddy on :8080
```

Then access at:
- **Local:** `http://localhost:8080/fitness`
- **Via Tailscale:** `https://shakeds-macbook-pro-2.tail0b783.ts.net:8080/fitness` (or adjust the domain for your machine)

The dev server has **no auth** and is meant for local testing only. Production deploys to
fly.io use a separate `Caddyfile` with basic auth and are triggered manually via GitHub Actions.

## One-time deploy setup (fly.io)

```bash
# from workout-program/
flyctl apps create shaked-workout                       # or edit the name in fly.toml

# set the basic-auth credentials (private gate). Generate a bcrypt hash:
HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext 'YOUR-PASSWORD')
flyctl secrets set SITE_USER=shaked SITE_PASSWORD_HASH="$HASH" --config site/fly.toml
```

Then add these **repo secrets** in `Shaked/monorepo` → Settings → Secrets and variables → Actions:

| Secret | Purpose |
|---|---|
| `FLY_API_TOKEN` | Lets the workflow run `flyctl deploy` (`flyctl tokens create deploy`). |
| `TELEGRAM_BOT_TOKEN` | BotFather token — sends the "deployed" message. |
| `TELEGRAM_CHAT_ID` | Your chat id — *which* chat to message (the token alone can't address it). |

After that, a deploy (currently triggered manually via `workflow_dispatch` — auto-deploy on
push is suspended) rebuilds, redeploys, and (if the Telegram secrets are set) pings you with
the version + URL. The site lives at `https://shaked-workout.fly.dev/` behind the
username/password you set.

> Privacy: the page is gated by basic auth, so bodyweight / shoulder-pain / benchmarks stay
> behind the password. Set `showMetrics: false` in `config.json` if you want to drop personal
> numbers from the build entirely.

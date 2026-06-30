# TASK: local Tailscale-served workout site

> Status: current direction. The original GitHub Pages/Fly.io deployment plan is
> superseded. The site is served from Shaked's laptop through Tailscale.

## Goal

Keep the workout site available at:

```text
https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/
```

The laptop should automatically pick up changes after they land on `main`, rebuild the
static site, and keep serving it after login/restart.

## Current Architecture

```text
GitHub main
  -> macOS LaunchAgent starts site/bin/local-sync-serve.sh
  -> git fetch origin main every 60 seconds
  -> ff-only merge when the worktree is clean
  -> npm build with BASE_PATH=/fitness
  -> Caddy serves site/dist on localhost:8080/fitness/
  -> Tailscale Serve exposes /fitness over HTTPS
```

No Fly.io, GitHub Pages, or hosted deploy target is part of the path.

## Files

| Path | Purpose |
|---|---|
| `site/build.mjs` | Generates `site/dist/` from `PLAN.md` and `tracking/`. |
| `site/Caddyfile` | Local Caddy server for `/fitness/`. |
| `site/bin/local-sync-serve.sh` | Long-running sync/build/serve loop for launchd. |
| `site/bin/install-local-launchd.sh` | Installs and starts the macOS LaunchAgent. |
| `.github/workflows/workout-program-site.yml` | Validation only: lint Markdown and build the site. |

## Acceptance Criteria

- [x] No Fly.io/GitHub Pages deployment workflow remains.
- [x] The site can be served locally at `http://localhost:8080/fitness/`.
- [x] Tailscale Serve is configured by the service for `/fitness/`.
- [x] The service fetches `origin/main`, fast-forwards a clean worktree, and rebuilds.
- [x] The service is launchd-managed with `RunAtLoad` and `KeepAlive`.
- [x] GitHub Actions validate the site without deploying it.
- [x] `PLAN.md` remains the source of truth.

## Operation

Install or refresh the service:

```bash
cd site
npm run install:launchd
```

Watch logs:

```bash
tail -f ~/Library/Logs/fitness-planner/site-launchd.log
tail -f ~/Library/Logs/fitness-planner/site-launchd.err.log
```

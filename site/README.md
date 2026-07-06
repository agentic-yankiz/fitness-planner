# Workout Site - Local Tailscale Serve

A tiny static site that renders [`../PLAN.md`](../PLAN.md) into a clean, light page for
the gym. It is read-only: if the site and `PLAN.md` disagree, `PLAN.md` wins.

The canonical deploy is local-only:

```text
main changes on GitHub -> launchd service fetches origin/main -> fast-forward merge
  -> npm build -> Caddy serves ./dist on localhost:8080/fitness/
  -> Tailscale Serve exposes https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/
```

No Fly.io, GitHub Pages, or other hosted deployment is used.

For the multi-project path convention, threat model, and write-auth design, see
[`docs/infra/tailscale-serving.md`](../docs/infra/tailscale-serving.md).

## What It Shows

- day-by-day plan tables from `PLAN.md`
- current block/week from the newest `../tracking/week-YYYY-MM-DD.md`
- progress parsed from `../tracking/`
- footer stamp with the build commit and UTC build time

## Manual Local Run

```bash
cd site
npm install
npm run dev
```

Then open:

- local: `http://localhost:8080/fitness/`
- Tailscale, after serve is configured:
  `https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/`

## Always-On Setup

Install the macOS LaunchAgent from the repo root:

```bash
cd site
npm run install:launchd
```

The service:

- starts on login and restarts if it exits
- builds the site immediately
- configures Tailscale Serve for `/fitness`
- checks `origin/main` every 60 seconds
- fast-forwards only when the local worktree is clean
- rebuilds after every successful update

Logs live in `~/Library/Logs/fitness-planner/`.

Useful commands:

```bash
launchctl print gui/$(id -u)/com.shaked.fitness-planner.site
tail -f ~/Library/Logs/fitness-planner/site-launchd.log
tail -f ~/Library/Logs/fitness-planner/site-launchd.err.log
```

## Requirements

- macOS launchd
- Node/npm
- Caddy (`brew install caddy`)
- Tailscale signed in on the laptop

The script also finds the macOS Tailscale app CLI at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` when `tailscale` is not on `PATH`.

## Current Week

The build reads the newest `../tracking/week-YYYY-MM-DD.md` whose first line declares
`Block N / Week M`. With no logs yet, it falls back to `config.json`.

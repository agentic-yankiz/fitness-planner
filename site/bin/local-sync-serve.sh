#!/usr/bin/env bash
set -u

ROOT="${FITNESS_PLANNER_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SITE="$ROOT/site"
LOG_DIR="${FITNESS_SITE_LOG_DIR:-$HOME/Library/Logs/fitness-planner}"
PORT="${FITNESS_SITE_PORT:-8080}"
BASE_PATH="${FITNESS_SITE_BASE_PATH:-/fitness}"
SYNC_INTERVAL="${FITNESS_SITE_SYNC_INTERVAL:-60}"

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

find_binary() {
  local configured="$1"
  local fallback="$2"
  local name="$3"

  if [ -n "$configured" ] && [ -x "$configured" ]; then
    printf '%s\n' "$configured"
    return 0
  fi
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  if [ -n "$fallback" ] && [ -x "$fallback" ]; then
    printf '%s\n' "$fallback"
    return 0
  fi
  return 1
}

CADDY_BIN="$(find_binary "${CADDY_BIN:-}" "" caddy || true)"
TAILSCALE_BIN="$(find_binary "${TAILSCALE_BIN:-}" "/Applications/Tailscale.app/Contents/MacOS/Tailscale" tailscale || true)"
TAILSCALE_CONFIGURED=0
RESTART_CADDY_AFTER_SYNC=0

if [ -z "$CADDY_BIN" ]; then
  log "missing caddy; install with: brew install caddy"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  log "missing git"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  log "missing npm/node"
  exit 1
fi

install_dependencies() {
  if [ ! -d "$SITE/node_modules" ]; then
    log "installing site dependencies"
    (cd "$SITE" && npm install --no-audit --no-fund)
  fi
}

build_site() {
  local sha built_at
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  built_at="$(date -u '+%Y-%m-%d %H:%M UTC')"
  log "building site at ${sha:0:7}"
  (cd "$SITE" && BASE_PATH="$BASE_PATH" GIT_SHA="$sha" BUILD_TIME="$built_at" npm run build)
}

sync_main() {
  local before remote package_before package_after changed_files

  before="$(git -C "$ROOT" rev-parse HEAD)"
  if ! git -C "$ROOT" fetch --prune origin main; then
    log "git fetch failed; keeping current build"
    return 0
  fi

  remote="$(git -C "$ROOT" rev-parse origin/main)"
  if [ "$before" = "$remote" ]; then
    return 0
  fi

  if git -C "$ROOT" merge-base --is-ancestor "$remote" "$before"; then
    return 0
  fi

  if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
    log "local changes detected; skipping auto-merge from origin/main"
    return 0
  fi

  package_before="$(git -C "$ROOT" rev-parse HEAD:site/package-lock.json 2>/dev/null || true)"
  changed_files="$(git -C "$ROOT" diff --name-only "$before" "$remote")"
  log "updating ${before:0:7} -> ${remote:0:7}"
  if ! git -C "$ROOT" merge --ff-only origin/main; then
    log "fast-forward failed; keeping current build"
    return 0
  fi

  package_after="$(git -C "$ROOT" rev-parse HEAD:site/package-lock.json 2>/dev/null || true)"
  if [ "$package_before" != "$package_after" ] || [ ! -d "$SITE/node_modules" ]; then
    log "package lock changed; refreshing dependencies"
    (cd "$SITE" && npm install --no-audit --no-fund)
  fi

  build_site

  if printf '%s\n' "$changed_files" | grep -qx 'site/Caddyfile'; then
    RESTART_CADDY_AFTER_SYNC=1
  fi

  if printf '%s\n' "$changed_files" | grep -qx 'site/bin/local-sync-serve.sh'; then
    log "sync script changed; exiting so launchd restarts the updated service"
    exit 0
  fi
}

configure_tailscale_serve() {
  if [ -z "$TAILSCALE_BIN" ]; then
    log "tailscale CLI not found; Caddy is still available at http://localhost:${PORT}${BASE_PATH}/"
    return 0
  fi

  if "$TAILSCALE_BIN" serve --yes --bg --https=443 --set-path="$BASE_PATH" "http://127.0.0.1:${PORT}${BASE_PATH}" >/dev/null 2>&1; then
    TAILSCALE_CONFIGURED=1
    log "tailscale serve configured at ${BASE_PATH}/"
  else
    TAILSCALE_CONFIGURED=0
    log "tailscale serve setup failed; check that Tailscale is running and HTTPS is enabled"
  fi
}

start_caddy() {
  SITE_DIST="$SITE/dist" FITNESS_SITE_PORT="$PORT" "$CADDY_BIN" run \
    --config "$SITE/Caddyfile" \
    --adapter caddyfile &
  CADDY_PID=$!
  log "started caddy pid $CADDY_PID on localhost:${PORT}${BASE_PATH}/"
}

stop_caddy() {
  if [ -n "${CADDY_PID:-}" ] && kill -0 "$CADDY_PID" >/dev/null 2>&1; then
    kill "$CADDY_PID"
    wait "$CADDY_PID" 2>/dev/null || true
  fi
}

trap stop_caddy EXIT INT TERM

cd "$ROOT" || exit 1
install_dependencies
build_site
configure_tailscale_serve
start_caddy

while true; do
  sleep "$SYNC_INTERVAL" &
  wait $!

  if ! kill -0 "$CADDY_PID" >/dev/null 2>&1; then
    log "caddy exited; restarting"
    start_caddy
  fi

  if [ "$TAILSCALE_CONFIGURED" -ne 1 ]; then
    configure_tailscale_serve
  fi

  sync_main

  if [ "$RESTART_CADDY_AFTER_SYNC" -eq 1 ]; then
    log "caddy config changed; restarting"
    stop_caddy
    start_caddy
    configure_tailscale_serve
    RESTART_CADDY_AFTER_SYNC=0
  fi
done

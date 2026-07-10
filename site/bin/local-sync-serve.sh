#!/usr/bin/env bash
set -u

ROOT="${FITNESS_PLANNER_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SITE="$ROOT/site"
LOG_DIR="${FITNESS_SITE_LOG_DIR:-$HOME/Library/Logs/fitness-planner}"
PORT="${FITNESS_SITE_PORT:-8080}"
SERVER_PORT="${FITNESS_SERVER_PORT:-3000}"
BASE_PATH="${FITNESS_SITE_BASE_PATH:-/fitness}"
SYNC_INTERVAL="${FITNESS_SITE_SYNC_INTERVAL:-60}"
LAST_BACKUP_DAY=""

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
RESTART_SERVER_AFTER_SYNC=0

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
  # Always install at startup: near-instant no-op when current, and the only
  # reliable way to pick up dependency changes across restarts.
  log "ensuring site dependencies"
  (cd "$SITE" && npm install --no-audit --no-fund)
}

build_site() {
  local sha built_at
  sha="$(git -C "$ROOT" rev-parse HEAD)"
  built_at="$(date -u '+%Y-%m-%d %H:%M UTC')"
  log "building site at ${sha:0:7}"
  (cd "$SITE" && BASE_PATH="$BASE_PATH" GIT_SHA="$sha" BUILD_TIME="$built_at" npm run build) \
    && printf '%s' "$sha" > "$SITE/.last-built-sha"
}

# Rebuild whenever dist no longer matches HEAD — catches HEAD moved by anything
# other than sync_main (an agent, a manual pull) that would otherwise leave the
# served site silently stale.
ensure_build_current() {
  local head built
  head="$(git -C "$ROOT" rev-parse HEAD)"
  built="$(cat "$SITE/.last-built-sha" 2>/dev/null || true)"
  if [ "$built" != "$head" ]; then
    log "dist is stale (built ${built:0:7}, HEAD ${head:0:7}); rebuilding"
    build_site
    # server.mjs may have changed in the same external move — restart node too
    # (cheap: SQLite state is on disk, downtime ~1s).
    log "restarting node after stale rebuild"
    stop_server
    start_server
  fi
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

  # Track package.json: there is no committed lockfile, so it is the manifest
  # that actually signals dependency changes.
  package_before="$(git -C "$ROOT" rev-parse HEAD:site/package.json 2>/dev/null || true)"
  changed_files="$(git -C "$ROOT" diff --name-only "$before" "$remote")"
  log "updating ${before:0:7} -> ${remote:0:7}"
  if ! git -C "$ROOT" merge --ff-only origin/main; then
    log "fast-forward failed; keeping current build"
    return 0
  fi

  package_after="$(git -C "$ROOT" rev-parse HEAD:site/package.json 2>/dev/null || true)"
  if [ "$package_before" != "$package_after" ] || [ ! -d "$SITE/node_modules" ]; then
    log "package.json changed; refreshing dependencies"
    (cd "$SITE" && npm install --no-audit --no-fund)
  fi

  build_site

  if printf '%s\n' "$changed_files" | grep -qx 'site/Caddyfile'; then
    RESTART_CADDY_AFTER_SYNC=1
  fi

  if printf '%s\n' "$changed_files" | grep -qE '^site/(server\.mjs|migrate\.mjs|migrations/)'; then
    RESTART_SERVER_AFTER_SYNC=1
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

  # Tailscale Serve strips BASE_PATH before proxying, so the target must be the
  # Node server root. Pointing it at Caddy's /fitness route would strip the path
  # once in Tailscale and then ask Caddy to route a bare "/" request.
  if "$TAILSCALE_BIN" serve --yes --bg --https=443 --set-path="$BASE_PATH" "http://127.0.0.1:${SERVER_PORT}" >/dev/null 2>&1; then
    TAILSCALE_CONFIGURED=1
    log "tailscale serve configured at ${BASE_PATH}/"
  else
    TAILSCALE_CONFIGURED=0
    log "tailscale serve setup failed; check that Tailscale is running and HTTPS is enabled"
  fi
}

start_server() {
  # server.mjs runs pending migrations at boot and owns site/data/training.db.
  SERVER_PORT="$SERVER_PORT" node "$SITE/server.mjs" &
  SERVER_PID=$!
  log "started node server pid $SERVER_PID on 127.0.0.1:${SERVER_PORT}"
}

stop_server() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID"
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

start_caddy() {
  SITE_DIST="$SITE/dist" FITNESS_SITE_PORT="$PORT" FITNESS_SERVER_PORT="$SERVER_PORT" "$CADDY_BIN" run \
    --config "$SITE/Caddyfile" \
    --adapter caddyfile &
  CADDY_PID=$!
  log "started local caddy pid $CADDY_PID on localhost:${PORT}${BASE_PATH}/ -> node:${SERVER_PORT}"
}

stop_caddy() {
  if [ -n "${CADDY_PID:-}" ] && kill -0 "$CADDY_PID" >/dev/null 2>&1; then
    kill "$CADDY_PID"
    wait "$CADDY_PID" 2>/dev/null || true
  fi
}

# Nightly DB backup — runs at most once per calendar day.
maybe_backup() {
  local today
  today="$(date -u '+%Y-%m-%d')"
  if [ "$today" = "$LAST_BACKUP_DAY" ]; then
    return 0
  fi
  if [ ! -f "$SITE/data/training.db" ]; then
    return 0
  fi
  if (cd "$SITE" && node bin/backup-db.mjs >>"$LOG_DIR/site-backup.log" 2>&1); then
    LAST_BACKUP_DAY="$today"
    log "database backup written for $today"
  else
    log "database backup failed; see site-backup.log"
  fi
}

cleanup() {
  stop_caddy
  stop_server
}

trap cleanup EXIT INT TERM

cd "$ROOT" || exit 1
install_dependencies
build_site
start_server
maybe_backup
configure_tailscale_serve
start_caddy

while true; do
  sleep "$SYNC_INTERVAL" &
  wait $!

  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    log "node server exited; restarting"
    start_server
  fi

  if ! kill -0 "$CADDY_PID" >/dev/null 2>&1; then
    log "caddy exited; restarting"
    start_caddy
  fi

  if [ "$TAILSCALE_CONFIGURED" -ne 1 ]; then
    configure_tailscale_serve
  fi

  maybe_backup
  sync_main
  ensure_build_current

  if [ "$RESTART_SERVER_AFTER_SYNC" -eq 1 ]; then
    log "server code changed; restarting node"
    stop_server
    start_server
    RESTART_SERVER_AFTER_SYNC=0
  fi

  if [ "$RESTART_CADDY_AFTER_SYNC" -eq 1 ]; then
    log "caddy config changed; restarting"
    stop_caddy
    start_caddy
    configure_tailscale_serve
    RESTART_CADDY_AFTER_SYNC=0
  fi
done

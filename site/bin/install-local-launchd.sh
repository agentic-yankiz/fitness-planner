#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${FITNESS_SITE_LAUNCHD_LABEL:-com.shaked.fitness-planner.site}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/fitness-planner"
UID_VALUE="$(id -u)"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${ROOT}/site/bin/local-sync-serve.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/site-launchd.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/site-launchd.err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>FITNESS_PLANNER_ROOT</key>
    <string>${ROOT}</string>
    <key>FITNESS_SITE_BASE_PATH</key>
    <string>/fitness</string>
    <key>FITNESS_SITE_PORT</key>
    <string>8080</string>
    <key>FITNESS_SITE_SYNC_INTERVAL</key>
    <string>60</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/${UID_VALUE}" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID_VALUE}" "$PLIST"
launchctl enable "gui/${UID_VALUE}/${LABEL}"
launchctl kickstart -k "gui/${UID_VALUE}/${LABEL}"

echo "Installed and started ${LABEL}"
echo "Logs: ${LOG_DIR}/site-launchd.log"

#!/bin/bash
# Runs Arete as an always-on macOS LaunchAgent: it starts at login, restarts if
# it stops, and serves the API and the built app on http://localhost:3001.
# Reminders and the day's scoring run inside it, so nothing needs setting up
# after a reboot.
#
#   scripts/oura-app.sh install    build, then install and start the agent
#   scripts/oura-app.sh restart    rebuild and restart (after code changes)
#   scripts/oura-app.sh stop       stop it (npm run dev does this first)
#   scripts/oura-app.sh start      start it again
#   scripts/oura-app.sh logs       follow the log
#   scripts/oura-app.sh uninstall  remove the agent entirely
set -euo pipefail

LABEL="com.ozzy.oura"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$ROOT/server/logs"
DOMAIN="gui/$(id -u)"

build() {
  echo "Building the app and the server..."
  (cd "$ROOT/client" && npx vite build >/dev/null)   # type-check separately: in-progress files must not stop the app
  npm run build --prefix "$ROOT/server" >/dev/null
}

write_plist() {
  local node; node="$(command -v node)"
  mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$ROOT/server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>--env-file-if-exists=.env</string>
    <string>dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PORT</key><string>3001</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/oura.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/oura.log</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
stop()   { if loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; echo "Stopped."; fi; }
start()  { [ -f "$PLIST" ] || { echo "Not installed. Run: npm run app:install"; exit 1; }
           loaded || launchctl bootstrap "$DOMAIN" "$PLIST"; echo "Running on http://localhost:3001"; }

case "${1:-}" in
  install)   build; write_plist; stop; start ;;
  restart)   build; stop; start ;;
  start)     start ;;
  stop)      stop ;;
  logs)      tail -n 50 -f "$LOGDIR/oura.log" ;;
  uninstall) stop; rm -f "$PLIST"; echo "Removed." ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac

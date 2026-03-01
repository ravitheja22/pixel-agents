#!/usr/bin/env bash
# Pixel Agents — Install as background service
# Runs automatically at login. Open http://localhost:7375 in any browser.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$REPO_DIR/server"
WEBVIEW_DIR="$REPO_DIR/webview-ui"

# ── Detect bun ──────────────────────────────────────────────────────────────
BUN_PATH=""
for candidate in "$HOME/.bun/bin/bun" "/usr/local/bin/bun" "$(which bun 2>/dev/null || true)"; do
  if [ -x "$candidate" ]; then BUN_PATH="$candidate"; break; fi
done

if [ -z "$BUN_PATH" ]; then
  echo "→ Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  BUN_PATH="$HOME/.bun/bin/bun"
fi
echo "✓ Bun: $BUN_PATH  ($("$BUN_PATH" --version))"

# ── Install dependencies ─────────────────────────────────────────────────────
echo "→ Installing server dependencies..."
cd "$SERVER_DIR" && "$BUN_PATH" install --silent

echo "→ Installing webview dependencies..."
cd "$WEBVIEW_DIR" && npm install --silent

# ── Build the webview ────────────────────────────────────────────────────────
echo "→ Building webview..."
cd "$WEBVIEW_DIR" && node_modules/.bin/vite build --config vite.server.config.ts --logLevel warn

echo "✓ Build complete"

# ── Platform-specific service installation ───────────────────────────────────
case "$(uname)" in

  Darwin)
    PLIST_LABEL="com.pixel-agents.server"
    PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
    LOG_DIR="$HOME/Library/Logs/PixelAgents"
    mkdir -p "$LOG_DIR"

    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_PATH</string>
    <string>run</string>
    <string>$SERVER_DIR/index.ts</string>
  </array>
  <key>WorkingDirectory</key>  <string>$SERVER_DIR</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key> <string>$LOG_DIR/server-error.log</string>
</dict>
</plist>
PLIST

    # Unload old instance if running, then load fresh
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load   "$PLIST_PATH"

    echo ""
    echo "✓ Pixel Agents service installed (macOS launchd)"
    echo "  Starts automatically at login."
    echo "  Logs → $LOG_DIR/"
    echo ""
    echo "  Useful commands:"
    echo "    Stop:    launchctl unload '$PLIST_PATH'"
    echo "    Start:   launchctl load   '$PLIST_PATH'"
    echo "    Logs:    tail -f '$LOG_DIR/server.log'"
    echo ""
    sleep 1
    open "http://localhost:7375"
    ;;

  Linux)
    SERVICE_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_DIR/pixel-agents.service" <<UNIT
[Unit]
Description=Pixel Agents web dashboard
After=network.target

[Service]
ExecStart=$BUN_PATH run $SERVER_DIR/index.ts
WorkingDirectory=$SERVER_DIR
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable --now pixel-agents.service

    echo ""
    echo "✓ Pixel Agents service installed (systemd user service)"
    echo "  Starts automatically at login."
    echo ""
    echo "  Useful commands:"
    echo "    Status:  systemctl --user status pixel-agents"
    echo "    Logs:    journalctl --user -u pixel-agents -f"
    echo "    Stop:    systemctl --user stop pixel-agents"
    echo ""
    xdg-open "http://localhost:7375" 2>/dev/null || echo "  Open: http://localhost:7375"
    ;;

  *)
    echo "⚠️  Unsupported platform: $(uname)"
    echo "Start manually: cd server && bun run index.ts"
    exit 1
    ;;
esac

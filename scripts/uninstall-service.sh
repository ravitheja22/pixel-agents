#!/usr/bin/env bash
# Pixel Agents — Uninstall background service

set -euo pipefail

case "$(uname)" in
  Darwin)
    PLIST_PATH="$HOME/Library/LaunchAgents/com.pixel-agents.server.plist"
    if [ -f "$PLIST_PATH" ]; then
      launchctl unload "$PLIST_PATH" 2>/dev/null || true
      rm "$PLIST_PATH"
      echo "✓ Pixel Agents service removed (macOS)"
    else
      echo "No service found at $PLIST_PATH"
    fi
    ;;
  Linux)
    systemctl --user disable --now pixel-agents.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/pixel-agents.service"
    systemctl --user daemon-reload
    echo "✓ Pixel Agents service removed (Linux)"
    ;;
  *)
    echo "Unsupported platform: $(uname)"
    ;;
esac

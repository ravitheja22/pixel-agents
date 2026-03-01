#!/usr/bin/env bash
# Double-click this file in Finder to start Pixel Agents.
# Requires: Bun installed (https://bun.sh)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
BUN_PATH="${HOME}/.bun/bin/bun"

# ── Check bun ────────────────────────────────────────────────────────────────
if [ ! -x "$BUN_PATH" ]; then
  echo "❌ Bun not found at $BUN_PATH"
  echo "   Install it first: curl -fsSL https://bun.sh/install | bash"
  echo ""
  echo "   Or run 'npm run server:install' from the repo to set everything up."
  read -r -p "Press Enter to close..."
  exit 1
fi

# ── Check if server is already running ───────────────────────────────────────
if curl -s --max-time 1 http://localhost:7375 > /dev/null 2>&1; then
  echo "✓ Pixel Agents is already running at http://localhost:7375"
  open "http://localhost:7375"
  exit 0
fi

# ── Check public dir (must have been built at least once) ────────────────────
if [ ! -d "$SERVER_DIR/public" ]; then
  echo "→ First run: building webview (this takes ~30s)..."
  cd "$SCRIPT_DIR"
  npm run server:build
fi

# ── Start server ─────────────────────────────────────────────────────────────
echo "→ Starting Pixel Agents at http://localhost:7375"
echo "   Close this window to stop the server."
echo ""

# Open browser after 1.5s (gives server time to bind)
(sleep 1.5 && open "http://localhost:7375") &

cd "$SERVER_DIR"
"$BUN_PATH" run index.ts

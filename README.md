# Pixel Agents

A VS Code extension — and standalone web dashboard — that turns your AI coding agents into animated pixel art characters in a virtual office.

Each Claude Code terminal you open spawns a character that walks around, sits at desks, and visually reflects what the agent is doing — typing when writing code, reading when searching files, waiting when it needs your attention.

This is the source code for the free [Pixel Agents extension for VS Code](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) — you can install it directly from the marketplace with the full furniture catalog included.


![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **One agent, one character** — every Claude Code terminal gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing (writing, reading, running commands)
- **Universal dashboard** — runs as a standalone web app that tracks all Claude instances (VS Code, Claude Desktop, CLI) in one view
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Map presets** — toggle between the Office layout and a Japandi-style Zen Garden (koi pond, gravel, plants)
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **Diverse characters** — 6 diverse characters

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

---

## VS Code Extension

### Requirements

- VS Code 1.109.0 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

### Getting Started

The easiest way is to install the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) directly from the marketplace.

To build from source:

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **Pixel Agents** panel (bottom panel area alongside your terminal)
2. Click **+ Agent** to spawn a new Claude Code terminal and its character
3. Start coding with Claude — watch the character react in real time
4. Click a character to select it, then click a seat to reassign it
5. Click **Layout** to open the office editor and customize your space

---

## Web Dashboard (Standalone)

The web dashboard runs as a local server and shows **all Claude sessions** from any tool (VS Code extension, Claude Desktop, CLI in any terminal) in one unified view. Sessions started within the last hour are automatically discovered when the server starts.

### Prerequisites

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- Node.js / npm (already required for VS Code extension development)

### Option A — Background service (recommended)

Install once. The server starts automatically at login. Just open your browser.

```bash
npm run server:install
```

Then open **http://localhost:7375** in any browser. That's it — no commands to run day-to-day.

**macOS:** Registered as a launchd user agent (`~/Library/LaunchAgents/com.pixel-agents.server.plist`).
**Linux:** Registered as a systemd user service.

#### Service management

| Action | Command |
|--------|---------|
| Open app | Open `http://localhost:7375` in browser |
| Stop server | `launchctl unload ~/Library/LaunchAgents/com.pixel-agents.server.plist` |
| Start server | `launchctl load ~/Library/LaunchAgents/com.pixel-agents.server.plist` |
| View logs | `tail -f ~/Library/Logs/PixelAgents/server.log` |
| Uninstall service | `npm run server:uninstall` |
| Rebuild & reinstall | `npm run server:install` |

### Option B — Double-click launcher (no install)

Double-click **`Pixel Agents.command`** in Finder. Terminal opens, the server starts, and your browser opens automatically. Close the Terminal window to stop.

> The first run builds the webview automatically (~30s). Every run after that is instant.

### Option C — Manual start (terminal)

```bash
# First time or after code changes — build then run:
npm run server:start

# Fast restart (skip rebuild, assumes already built):
npm run server:run
```

### Uninstalling the service

```bash
npm run server:uninstall
```

Stops the server, removes the service file, and prevents it from starting at login. Your layout file (`~/.pixel-agents/layout.json`) is preserved.

### Web Dashboard Features

- **Automatic session discovery** — any Claude session active in the last hour appears on startup; new sessions appear within 1 second
- **Launch Directory** — set a default directory for new agents via Settings → Launch Directory
- **Map presets** — toggle between Office and Zen Garden layouts using the **Office / Zen** button
- **Export/Import layout** — save and load layout files directly from the browser via Settings

---

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — 7 patterns, full HSBC color control per tile
- **Walls** — auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place furniture, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — share layouts as JSON files via the Settings modal
- **Grid expansion** — click the ghost border outside the grid to grow it (up to 64×64)

### Map Presets

Click the **Office / Zen** toggle button in the toolbar to switch between:

- **Office** — the default office layout
- **Zen** — a Japandi-inspired layout with a koi pond, gravel zen garden, plants, and thinking desks

Switching saves the selected layout as your current layout. Export your custom layout first if you want to keep it.

### Office Assets

The office tileset used in this project and available via the extension is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

This is the only part of the project that is not freely available. The tileset is not included in this repository due to its license. To use Pixel Agents locally with the full set of office furniture and decorations, purchase the tileset and run the asset import pipeline:

```bash
npm run import-tileset
```

The extension will still work without the tileset — you'll get the default characters and basic layout, but the full furniture catalog requires the imported assets.

---

## How It Works

Pixel Agents watches Claude Code's JSONL transcript files (`~/.claude/projects/`) to track what each agent is doing. When an agent uses a tool (like writing a file or running a command), the server detects it and updates the character's animation. No modifications to Claude Code are needed — it's purely observational.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

---

## Tech Stack

- **VS Code Extension**: TypeScript, VS Code Webview API, esbuild
- **Web Server**: Bun, TypeScript (HTTP + WebSocket)
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** — the way agents are connected to Claude Code terminal instances is not super robust and sometimes desyncs, especially when terminals are rapidly opened/closed or restored across sessions.
- **Heuristic-based status detection** — Claude Code's JSONL transcript format does not provide clear signals for when an agent is waiting for user input or when it has finished its turn. The current detection is based on heuristics (idle timers, turn-duration events) and often misfires.
- **macOS/Linux only for web dashboard** — the `+ Agent` button in standalone mode opens Terminal.app (macOS) or xterm (Linux). Windows support for system terminal launching is limited.

## Roadmap

There are several areas where contributions would be very welcome:

- **Improve agent-terminal reliability** — more robust connection and sync between characters and Claude Code instances
- **Better status detection** — find or propose clearer signals for agent state transitions (waiting, done, permission needed)
- **Community assets** — freely usable pixel art tilesets or characters that anyone can use without purchasing third-party assets
- **Agent creation and definition** — define agents with custom skills, system prompts, names, and skins before launching them
- **Desks as directories** — click on a desk to select a working directory, drag and drop agents or click-to-assign to move them to specific desks/projects
- **Claude Code agent teams** — native support for [agent teams](https://code.claude.com/docs/en/agent-teams), visualizing multi-agent coordination and communication
- **Git worktree support** — agents working in different worktrees to avoid conflict from parallel work on the same files
- **Support for other agentic frameworks** — [OpenCode](https://github.com/nichochar/opencode), or really any kind of agentic experiment you'd want to run inside a pixel art interface

If any of these interest you, feel free to open an issue or submit a PR.

## Contributions

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for instructions on how to contribute to this project.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## License

This project is licensed under the [MIT License](LICENSE).

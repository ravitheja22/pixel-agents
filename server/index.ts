import * as fs from 'fs';
import * as path from 'path';
import type { AgentState } from './types.js';
import { loadServerState } from './agentManager.js';
import {
	loadFurnitureAssets,
	loadFloorTiles,
	loadWallTiles,
	loadCharacterSprites,
	loadDefaultLayout,
} from './assetLoader.js';
import { startWsServer } from './wsServer.js';

async function main(): Promise<void> {
	console.log('[Pixel Agents] Starting server...');

	// Resolve assets root.
	// In built mode: server/public/assets/ (Vite output landed here)
	// In dev mode: webview-ui/public/assets/
	const __dirname = import.meta.dir;
	const builtAssetsDir = path.join(__dirname, 'public', 'assets');
	const devAssetsDir = path.join(__dirname, '..', 'webview-ui', 'public', 'assets');

	let assetsRoot: string;
	if (fs.existsSync(builtAssetsDir)) {
		assetsRoot = path.join(__dirname, 'public');
		console.log('[Pixel Agents] Using built assets from:', assetsRoot);
	} else if (fs.existsSync(devAssetsDir)) {
		assetsRoot = path.join(__dirname, '..', 'webview-ui', 'public');
		console.log('[Pixel Agents] Using dev assets from:', assetsRoot);
	} else {
		assetsRoot = path.join(__dirname, 'public');
		console.warn('[Pixel Agents] ⚠️  No assets directory found. Run "npm run server:build" first.');
	}

	// Load all assets
	console.log('[Pixel Agents] Loading assets...');

	const defaultLayout = loadDefaultLayout(assetsRoot);
	const charSprites = await loadCharacterSprites(assetsRoot);
	const floorTiles = await loadFloorTiles(assetsRoot);
	const wallTiles = await loadWallTiles(assetsRoot);
	const assets = await loadFurnitureAssets(assetsRoot);

	if (charSprites) console.log(`[Pixel Agents] Loaded ${charSprites.characters.length} character sprite sets`);
	if (floorTiles) console.log(`[Pixel Agents] Loaded ${floorTiles.sprites.length} floor tile patterns`);
	if (wallTiles) console.log(`[Pixel Agents] Loaded ${wallTiles.sprites.length} wall tile sprites`);
	if (assets) console.log(`[Pixel Agents] Loaded ${assets.catalog.length} furniture assets`);

	// Load persisted state
	const state = loadServerState();

	// Initialize runtime maps
	const agents = new Map<number, AgentState>();
	const nextAgentId = { current: state.nextAgentId };
	const fileWatchers = new Map<number, import('fs').FSWatcher>();
	const pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
	const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
	const knownJsonlFiles = new Set<string>();

	// Start WebSocket server (handles agent restore + project scanning internally)
	startWsServer({
		agents,
		state,
		nextAgentId,
		fileWatchers,
		pollingTimers,
		waitingTimers,
		permissionTimers,
		jsonlPollTimers,
		knownJsonlFiles,
		defaultLayout,
		assets,
		wallTiles,
		floorTiles,
		charSprites,
		layoutWatcher: null,
	});
}

main().catch(err => {
	console.error('[Pixel Agents] Fatal error:', err);
	process.exit(1);
});

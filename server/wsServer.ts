import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ServerWebSocket } from 'bun';
import type { AgentState, ServerState, AgentSeatMeta } from './types.js';
import type { LoadedAssets, LoadedWallTiles, LoadedFloorTiles, LoadedCharacterSprites } from './assetLoader.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import type { SendFn } from './timerManager.js';
import { SERVER_PORT } from './constants.js';
import {
	launchAgent,
	removeAgent,
	restoreAgents,
	sendExistingAgents,
	persistAgentsFn,
	loadSettings,
	saveSettings,
	openExplorer,
	focusSystemTerminal,
} from './agentManager.js';
import { seedKnownFiles, startProjectScanner } from './projectScanner.js';
import { writeLayoutToFile, readLayoutFromFile, watchLayoutFile, loadLayout } from './layoutPersistence.js';

interface WsData {
	clientId: string;
}

type WsClient = ServerWebSocket<WsData>;

interface ServerResources {
	agents: Map<number, AgentState>;
	state: ServerState;
	nextAgentId: { current: number };
	fileWatchers: Map<number, fs.FSWatcher>;
	pollingTimers: Map<number, ReturnType<typeof setInterval>>;
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
	knownJsonlFiles: Set<string>;
	defaultLayout: Record<string, unknown> | null;
	assets: LoadedAssets | null;
	wallTiles: LoadedWallTiles | null;
	floorTiles: LoadedFloorTiles | null;
	charSprites: LoadedCharacterSprites | null;
	layoutWatcher: LayoutWatcher | null;
}

const clients = new Set<WsClient>();

function broadcast(msg: Record<string, unknown>): void {
	const json = JSON.stringify(msg);
	for (const ws of clients) {
		ws.send(json);
	}
}

function sendTo(ws: WsClient, msg: Record<string, unknown>): void {
	ws.send(JSON.stringify(msg));
}

function makeSendFn(): SendFn {
	return (msg: Record<string, unknown>) => broadcast(msg);
}

let res: ServerResources;

function makePersist(): () => void {
	return () => persistAgentsFn(res.agents, res.nextAgentId, res.state);
}

async function sendAssetsSequence(ws: WsClient): Promise<void> {
	// Send assets in correct load order:
	// characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded → furnitureAssetsLoaded → layoutLoaded

	if (res.charSprites) {
		sendTo(ws, {
			type: 'characterSpritesLoaded',
			characters: res.charSprites.characters,
		});
	}

	if (res.floorTiles) {
		sendTo(ws, {
			type: 'floorTilesLoaded',
			sprites: res.floorTiles.sprites,
		});
	}

	if (res.wallTiles) {
		sendTo(ws, {
			type: 'wallTilesLoaded',
			sprites: res.wallTiles.sprites,
		});
	}

	if (res.assets) {
		// Convert sprites Map to plain object for JSON serialization
		const spritesObj: Record<string, string[][]> = {};
		for (const [id, spriteData] of res.assets.sprites) {
			spritesObj[id] = spriteData;
		}
		sendTo(ws, {
			type: 'furnitureAssetsLoaded',
			catalog: res.assets.catalog,
			sprites: spritesObj,
		});
	}

	// Send layout last (builds on top of furniture catalog)
	const layout = loadLayout(res.defaultLayout);
	sendTo(ws, {
		type: 'layoutLoaded',
		layout,
	});
}

function startLayoutWatcher(): void {
	if (res.layoutWatcher) return;
	res.layoutWatcher = watchLayoutFile((layout) => {
		console.log('[Pixel Agents] External layout change — broadcasting to clients');
		broadcast({ type: 'layoutLoaded', layout });
	});
}

async function handleMessage(ws: WsClient, message: Record<string, unknown>): Promise<void> {
	const msgType = message.type as string;

	if (msgType === 'webviewReady') {
		const settings = loadSettings();
		sendTo(ws, {
			type: 'settingsLoaded',
			soundEnabled: settings.soundEnabled,
			launchDir: settings.launchDir,
		});

		sendExistingAgents(res.agents, res.state.agentSeats, (msg) => sendTo(ws, msg));

		await sendAssetsSequence(ws);

		if (!res.layoutWatcher) {
			startLayoutWatcher();
		}
	} else if (msgType === 'openClaude') {
		const settings = loadSettings();
		const cwd = (message.cwd as string | undefined) || settings.launchDir || os.homedir();
		launchAgent(
			cwd,
			res.nextAgentId,
			res.agents,
			res.knownJsonlFiles,
			res.fileWatchers,
			res.pollingTimers,
			res.waitingTimers,
			res.permissionTimers,
			res.jsonlPollTimers,
			makeSendFn(),
			makePersist(),
		);
	} else if (msgType === 'focusAgent') {
		focusSystemTerminal();
	} else if (msgType === 'closeAgent') {
		const id = message.id as number;
		removeAgent(
			id,
			res.agents,
			res.fileWatchers,
			res.pollingTimers,
			res.waitingTimers,
			res.permissionTimers,
			res.jsonlPollTimers,
			makePersist(),
		);
		broadcast({ type: 'agentClosed', id });
	} else if (msgType === 'saveAgentSeats') {
		console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
		res.state.agentSeats = message.seats as Record<string, AgentSeatMeta>;
		persistAgentsFn(res.agents, res.nextAgentId, res.state);
	} else if (msgType === 'saveLayout') {
		res.layoutWatcher?.markOwnWrite();
		writeLayoutToFile(message.layout as Record<string, unknown>);
	} else if (msgType === 'setSoundEnabled') {
		const settings = loadSettings();
		settings.soundEnabled = message.enabled as boolean;
		saveSettings(settings);
	} else if (msgType === 'setLaunchDir') {
		const settings = loadSettings();
		settings.launchDir = message.dir as string;
		saveSettings(settings);
	} else if (msgType === 'openSessionsFolder') {
		const projectsDir = path.join(os.homedir(), '.claude', 'projects');
		openExplorer(projectsDir);
	} else if (msgType === 'exportLayout') {
		// Send layout data back to browser; browser handles file save via File System Access API
		const layout = readLayoutFromFile();
		if (layout) {
			sendTo(ws, { type: 'exportLayoutData', layout });
		}
	} else if (msgType === 'importLayout') {
		// Browser sends layout data inline (read via File System Access API on the client side)
		const imported = message.layout as Record<string, unknown>;
		if (imported?.version === 1 && Array.isArray(imported.tiles)) {
			res.layoutWatcher?.markOwnWrite();
			writeLayoutToFile(imported);
			broadcast({ type: 'layoutLoaded', layout: imported });
		}
	}
}

function serveStatic(pathname: string, publicDir: string): Response {
	// Normalize path, default to index.html
	let filePath = pathname === '/' ? 'index.html' : pathname.slice(1);
	filePath = path.join(publicDir, filePath);

	// Security: prevent path traversal
	const resolved = path.resolve(filePath);
	if (!resolved.startsWith(path.resolve(publicDir))) {
		return new Response('Forbidden', { status: 403 });
	}

	try {
		if (!fs.existsSync(resolved)) {
			// SPA fallback: serve index.html for client-side routes
			const indexPath = path.join(publicDir, 'index.html');
			if (fs.existsSync(indexPath)) {
				return new Response(fs.readFileSync(indexPath), {
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}
			return new Response('Not Found', { status: 404 });
		}

		const stat = fs.statSync(resolved);
		if (stat.isDirectory()) {
			const indexPath = path.join(resolved, 'index.html');
			if (fs.existsSync(indexPath)) {
				return new Response(fs.readFileSync(indexPath), {
					headers: { 'Content-Type': 'text/html; charset=utf-8' },
				});
			}
			return new Response('Not Found', { status: 404 });
		}

		const content = fs.readFileSync(resolved);
		const contentType = getContentType(resolved);
		return new Response(content, { headers: { 'Content-Type': contentType } });
	} catch {
		return new Response('Internal Server Error', { status: 500 });
	}
}

function getContentType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const types: Record<string, string> = {
		'.html': 'text/html; charset=utf-8',
		'.js': 'application/javascript',
		'.mjs': 'application/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.ico': 'image/x-icon',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
		'.ttf': 'font/ttf',
	};
	return types[ext] || 'application/octet-stream';
}

export function startWsServer(resources: ServerResources): void {
	res = resources;
	const doPersist = makePersist();
	const sendFn = makeSendFn();

	// Restore persisted agents
	restoreAgents(
		res.nextAgentId,
		res.agents,
		res.knownJsonlFiles,
		res.fileWatchers,
		res.pollingTimers,
		res.waitingTimers,
		res.permissionTimers,
		res.jsonlPollTimers,
		res.state,
		sendFn,
		doPersist,
	);

	// Seed known files — actively-used sessions are adopted immediately; old ones just marked known
	seedKnownFiles(
		res.knownJsonlFiles,
		res.nextAgentId,
		res.agents,
		res.fileWatchers,
		res.pollingTimers,
		res.waitingTimers,
		res.permissionTimers,
		sendFn,
		doPersist,
	);

	startProjectScanner(
		res.nextAgentId,
		res.agents,
		res.knownJsonlFiles,
		res.fileWatchers,
		res.pollingTimers,
		res.waitingTimers,
		res.permissionTimers,
		sendFn,
		doPersist,
	);

	const publicDir = path.join(import.meta.dir, 'public');

	const server = Bun.serve<WsData>({
		port: SERVER_PORT,

		fetch(req, srv) {
			const url = new URL(req.url);

			if (url.pathname === '/ws') {
				const upgraded = srv.upgrade(req, {
					data: { clientId: crypto.randomUUID() },
				});
				return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
			}

			return serveStatic(url.pathname, publicDir);
		},

		websocket: {
			open(ws) {
				clients.add(ws);
				console.log(`[WS] Client connected: ${ws.data.clientId} (${clients.size} total)`);
			},

			async message(ws, data) {
				try {
					const msg = JSON.parse(data as string) as Record<string, unknown>;
					await handleMessage(ws, msg);
				} catch (err) {
					console.error('[WS] Error handling message:', err);
				}
			},

			close(ws) {
				clients.delete(ws);
				console.log(`[WS] Client disconnected: ${ws.data.clientId} (${clients.size} remaining)`);
			},
		},
	});

	console.log(`[Pixel Agents] Server running at http://localhost:${SERVER_PORT}`);
	console.log(`[Pixel Agents] Serving from: ${publicDir}`);

	if (!fs.existsSync(publicDir)) {
		console.warn(`[Pixel Agents] ⚠️  Public dir not found: ${publicDir}`);
		console.warn(`[Pixel Agents] Run "npm run server:build" from the repo root to build the webview.`);
	}

	return;
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState, PersistedAgent, AgentSeatMeta, ServerState, ServerSettings } from './types.js';
import { cancelWaitingTimer, cancelPermissionTimer, type SendFn } from './timerManager.js';
import { startFileWatching, readNewLines, stopFileWatching } from './fileWatcher.js';
import { JSONL_POLL_INTERVAL_MS, LAYOUT_FILE_DIR, STATE_FILE_NAME, SETTINGS_FILE_NAME } from './constants.js';

// ── State file paths ─────────────────────────────────────────

function getStateDir(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR);
}

function getStateFilePath(): string {
	return path.join(getStateDir(), STATE_FILE_NAME);
}

function getSettingsFilePath(): string {
	return path.join(getStateDir(), SETTINGS_FILE_NAME);
}

function ensureStateDir(): void {
	const dir = getStateDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

// ── Settings persistence ─────────────────────────────────────

export function loadSettings(): ServerSettings {
	try {
		const filePath = getSettingsFilePath();
		if (!fs.existsSync(filePath)) {
			return { soundEnabled: true, launchDir: os.homedir() };
		}
		const raw = fs.readFileSync(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as Partial<ServerSettings>;
		return {
			soundEnabled: parsed.soundEnabled !== false,
			launchDir: parsed.launchDir || os.homedir(),
		};
	} catch {
		return { soundEnabled: true, launchDir: os.homedir() };
	}
}

export function saveSettings(settings: ServerSettings): void {
	try {
		ensureStateDir();
		fs.writeFileSync(getSettingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8');
	} catch (err) {
		console.error('[Pixel Agents] Failed to save settings:', err);
	}
}

// ── Server state (agents + seats) persistence ────────────────

export function loadServerState(): ServerState {
	try {
		const filePath = getStateFilePath();
		if (!fs.existsSync(filePath)) {
			return { agents: [], agentSeats: {}, nextAgentId: 1 };
		}
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw) as ServerState;
	} catch {
		return { agents: [], agentSeats: {}, nextAgentId: 1 };
	}
}

export function saveServerState(state: ServerState): void {
	try {
		ensureStateDir();
		fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
	} catch (err) {
		console.error('[Pixel Agents] Failed to save server state:', err);
	}
}

// ── Project directory path ───────────────────────────────────

export function getProjectDirPath(cwd: string): string {
	const dirName = cwd.replace(/[:\\/]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

// ── System terminal launching ────────────────────────────────

function escapeShellArg(s: string): string {
	// Basic escaping for single-quoted strings
	return s.replace(/'/g, "'\\''");
}

function launchSystemTerminal(cwd: string, sessionId: string): void {
	const cmd = `claude --session-id ${sessionId}`;
	const platform = process.platform;

	try {
		if (platform === 'darwin') {
			// macOS: use osascript to open a new Terminal.app window
			const script = `tell application "Terminal" to do script "cd '${escapeShellArg(cwd)}' && ${cmd}"`;
			Bun.spawn(['osascript', '-e', script]);
		} else if (platform === 'linux') {
			// Linux: try xterm
			Bun.spawn(['xterm', '-e', `bash -c "cd '${escapeShellArg(cwd)}' && ${cmd}; exec bash"`]);
		} else if (platform === 'win32') {
			// Windows: open cmd.exe in new window
			Bun.spawn(['cmd', '/c', 'start', 'cmd', '/k', `cd /d "${cwd}" && ${cmd}`]);
		} else {
			console.warn(`[Pixel Agents] Unknown platform: ${platform}, cannot open terminal`);
		}
	} catch (err) {
		console.error('[Pixel Agents] Failed to launch system terminal:', err);
	}
}

export function focusSystemTerminal(): void {
	const platform = process.platform;
	try {
		if (platform === 'darwin') {
			Bun.spawn(['osascript', '-e', 'tell application "Terminal" to activate']);
		}
		// Linux/Windows: no reliable cross-platform mechanism without window IDs
	} catch { /* ignore */ }
}

export function openExplorer(folderPath: string): void {
	const platform = process.platform;
	try {
		if (platform === 'darwin') {
			Bun.spawn(['open', folderPath]);
		} else if (platform === 'linux') {
			Bun.spawn(['xdg-open', folderPath]);
		} else if (platform === 'win32') {
			Bun.spawn(['explorer', folderPath]);
		}
	} catch { /* ignore */ }
}

// ── Agent lifecycle ──────────────────────────────────────────

export function launchAgent(
	cwd: string,
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	send: SendFn | null,
	doPersist: () => void,
): void {
	const sessionId = crypto.randomUUID();
	const projectDir = getProjectDirPath(cwd);

	// Pre-register expected JSONL file so project scan won't treat it as a new external session
	const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
	knownJsonlFiles.add(expectedFile);

	// Create agent immediately (before JSONL file exists)
	const id = nextAgentIdRef.current++;
	const agent: AgentState = {
		id,
		terminalPid: null, // osascript doesn't return PID of the spawned claude process
		projectDir,
		jsonlFile: expectedFile,
		fileOffset: 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
	};

	agents.set(id, agent);
	doPersist();
	console.log(`[Pixel Agents] Agent ${id}: launching in ${cwd}`);
	send?.({ type: 'agentCreated', id });

	// Open system terminal with claude command
	launchSystemTerminal(cwd, sessionId);

	// Poll for the JSONL file to appear (claude may take a moment to start)
	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, send);
				readNewLines(id, agents, waitingTimers, permissionTimers, send);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

export function removeAgent(
	agentId: number,
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	doPersist: () => void,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	// Stop JSONL poll timer
	const jpTimer = jsonlPollTimers.get(agentId);
	if (jpTimer) { clearInterval(jpTimer); }
	jsonlPollTimers.delete(agentId);

	// Stop file watching
	stopFileWatching(agentId, fileWatchers, pollingTimers);

	// Cancel timers
	cancelWaitingTimer(agentId, waitingTimers);
	cancelPermissionTimer(agentId, permissionTimers);

	// Remove from maps
	agents.delete(agentId);
	doPersist();
}

export function restoreAgents(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	state: ServerState,
	send: SendFn | null,
	doPersist: () => void,
): void {
	const persisted = state.agents;
	if (persisted.length === 0) return;

	let maxId = 0;

	for (const p of persisted) {
		// Only restore agents whose JSONL files exist
		if (!fs.existsSync(p.jsonlFile)) {
			console.log(`[Pixel Agents] Skipping restored agent ${p.id}: JSONL file gone`);
			continue;
		}

		const agent: AgentState = {
			id: p.id,
			terminalPid: null,
			projectDir: p.projectDir,
			jsonlFile: p.jsonlFile,
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
		};

		agents.set(p.id, agent);
		knownJsonlFiles.add(p.jsonlFile);
		console.log(`[Pixel Agents] Restored agent ${p.id}: ${path.basename(p.jsonlFile)}`);

		if (p.id > maxId) maxId = p.id;

		// Start file watching from end of file (skip old content)
		try {
			const stat = fs.statSync(p.jsonlFile);
			agent.fileOffset = stat.size;
			startFileWatching(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, send);
		} catch { /* ignore errors during restore */ }
	}

	// Advance counter past restored IDs
	if (maxId >= nextAgentIdRef.current) {
		nextAgentIdRef.current = maxId + 1;
	}

	// Re-persist cleaned-up list (removes entries whose files are gone)
	doPersist();
}

export function persistAgentsFn(
	agents: Map<number, AgentState>,
	nextAgentIdRef: { current: number },
	state: ServerState,
): void {
	const persisted: PersistedAgent[] = [];
	for (const agent of agents.values()) {
		persisted.push({
			id: agent.id,
			jsonlFile: agent.jsonlFile,
			projectDir: agent.projectDir,
		});
	}
	state.agents = persisted;
	state.nextAgentId = nextAgentIdRef.current;
	saveServerState(state);
}

export function sendExistingAgents(
	agents: Map<number, AgentState>,
	agentSeats: Record<string, AgentSeatMeta>,
	send: SendFn | null,
): void {
	if (!send) return;
	const agentIds: number[] = [];
	for (const id of agents.keys()) {
		agentIds.push(id);
	}
	agentIds.sort((a, b) => a - b);

	console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}`);
	send({
		type: 'existingAgents',
		agents: agentIds,
		agentMeta: agentSeats,
	});

	sendCurrentAgentStatuses(agents, send);
}

export function sendCurrentAgentStatuses(
	agents: Map<number, AgentState>,
	send: SendFn | null,
): void {
	if (!send) return;
	for (const [agentId, agent] of agents) {
		// Re-send active tools
		for (const [toolId, status] of agent.activeToolStatuses) {
			send({
				type: 'agentToolStart',
				id: agentId,
				toolId,
				status,
			});
		}
		// Re-send waiting status
		if (agent.isWaiting) {
			send({
				type: 'agentStatus',
				id: agentId,
				status: 'waiting',
			});
		}
	}
}

export function startJsonlPollTimer(
	id: number,
	agent: AgentState,
	agents: Map<number, AgentState>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	send: SendFn | null,
): void {
	const pollTimer = setInterval(() => {
		try {
			if (fs.existsSync(agent.jsonlFile)) {
				console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
				clearInterval(pollTimer);
				jsonlPollTimers.delete(id);
				startFileWatching(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, send);
				readNewLines(id, agents, waitingTimers, permissionTimers, send);
			}
		} catch { /* file may not exist yet */ }
	}, JSONL_POLL_INTERVAL_MS);
	jsonlPollTimers.set(id, pollTimer);
}

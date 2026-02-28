import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState } from './types.js';
import { PROJECT_SCAN_INTERVAL_MS } from './constants.js';
import { findAgentInProjectDir, reassignAgentToFile, adoptNewSession } from './fileWatcher.js';
import type { SendFn } from './timerManager.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/**
 * Seed knownJsonlFiles with all existing JSONL files across all project dirs.
 * Called at startup so we only react to truly new sessions.
 */
export function seedKnownFiles(knownJsonlFiles: Set<string>): void {
	try {
		const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(CLAUDE_PROJECTS_DIR, d.name));

		for (const dir of projectDirs) {
			try {
				const files = fs.readdirSync(dir)
					.filter(f => f.endsWith('.jsonl'))
					.map(f => path.join(dir, f));
				for (const f of files) knownJsonlFiles.add(f);
			} catch { /* dir may not be readable */ }
		}

		console.log(`[Scanner] Seeded ${knownJsonlFiles.size} known JSONL files`);
	} catch {
		// ~/.claude/projects/ may not exist yet
		console.log(`[Scanner] No Claude projects dir found at ${CLAUDE_PROJECTS_DIR}`);
	}
}

/**
 * Start scanning ALL subdirectories of ~/.claude/projects/ every 1s.
 *
 * New JSONL files found:
 * - In a project dir that matches an existing agent → /clear reassignment
 * - In a brand-new project dir (external session) → auto-create new agent
 *
 * This makes ALL Claude instances visible: CLI, VS Code extension, Claude Desktop.
 */
export function startProjectScanner(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	send: SendFn | null,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		scanAllProjects(
			nextAgentIdRef, agents, knownJsonlFiles,
			fileWatchers, pollingTimers, waitingTimers, permissionTimers,
			send, persistAgents,
		);
	}, PROJECT_SCAN_INTERVAL_MS);
}

function scanAllProjects(
	nextAgentIdRef: { current: number },
	agents: Map<number, AgentState>,
	knownJsonlFiles: Set<string>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	send: SendFn | null,
	persistAgents: () => void,
): void {
	let projectDirs: string[];
	try {
		projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
			.filter(d => d.isDirectory())
			.map(d => path.join(CLAUDE_PROJECTS_DIR, d.name));
	} catch {
		return; // projects dir may not exist
	}

	for (const projectDir of projectDirs) {
		let files: string[];
		try {
			files = fs.readdirSync(projectDir)
				.filter(f => f.endsWith('.jsonl'))
				.map(f => path.join(projectDir, f));
		} catch {
			continue;
		}

		for (const file of files) {
			if (!knownJsonlFiles.has(file)) {
				knownJsonlFiles.add(file);

				// Check if any existing agent is in this project dir → /clear reassignment
				const existingAgentId = findAgentInProjectDir(agents, projectDir);
				if (existingAgentId !== null) {
					console.log(`[Scanner] New JSONL in known project dir: ${path.basename(file)}, reassigning agent ${existingAgentId}`);
					reassignAgentToFile(
						existingAgentId, file,
						agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						send, persistAgents,
					);
				} else {
					// External session (from VS Code extension, Claude Desktop, CLI in another terminal)
					console.log(`[Scanner] New external session detected: ${path.basename(file)}`);
					adoptNewSession(
						file, projectDir, nextAgentIdRef,
						agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers,
						send, persistAgents,
					);
				}
			}
		}
	}
}

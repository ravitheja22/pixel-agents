export interface AgentState {
	id: number;
	terminalPid: number | null; // OS process PID; null for externally-launched sessions
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
	activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
}

export interface PersistedAgent {
	id: number;
	jsonlFile: string;
	projectDir: string;
}

export interface AgentSeatMeta {
	palette?: number;
	hueShift?: number;
	seatId?: string | null;
}

export interface ServerState {
	agents: PersistedAgent[];
	agentSeats: Record<string, AgentSeatMeta>;
	nextAgentId: number;
}

export interface ServerSettings {
	soundEnabled: boolean;
	launchDir: string;
}

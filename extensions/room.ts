/**
 * Room Extension — Multi-agent awareness for pi
 *
 * Each pi instance auto-registers on startup via tmux pane tracking.
 * Agents discover peers and can peek at their work or steer them
 * with terminal input.
 *
 * Layout: ~/.pi/room/<pane-id>.json
 *
 * No naming, no flags, no env vars. Just run `pi` in tmux.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOM_DIR = path.join(process.env.HOME ?? "~", ".pi", "room");
const TMUX_PANE = process.env.TMUX_PANE; // e.g., "%5"

function paneFileId(pane: string): string {
	return pane.replace("%", "");
}

function ensureDir() {
	fs.mkdirSync(ROOM_DIR, { recursive: true });
}

interface PeerInfo {
	pane: string;
	pid: number;
	cwd: string;
	session: string | null;
	registered: string;
	parentPane?: string;
	parentSession?: string;
}

function readPeer(filePath: string): PeerInfo | null {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
}

function writeSelf(ctx: { cwd: string; sessionManager: { getSessionFile(): string | null } }) {
	if (!TMUX_PANE) return;
	ensureDir();
	const info: PeerInfo = {
		pane: TMUX_PANE,
		pid: process.pid,
		cwd: ctx.cwd,
		session: ctx.sessionManager.getSessionFile(),
		registered: new Date().toISOString(),
		parentPane: process.env.PI_PARENT_PANE,
		parentSession: process.env.PI_PARENT_SESSION,
	};
	fs.writeFileSync(
		path.join(ROOM_DIR, `${paneFileId(TMUX_PANE)}.json`),
		JSON.stringify(info, null, 2),
	);
}

function removeSelf() {
	if (!TMUX_PANE) return;
	try {
		fs.unlinkSync(path.join(ROOM_DIR, `${paneFileId(TMUX_PANE)}.json`));
	} catch {}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function cleanupStale() {
	ensureDir();
	for (const file of fs.readdirSync(ROOM_DIR)) {
		if (!file.endsWith(".json")) continue;
		const peer = readPeer(path.join(ROOM_DIR, file));
		if (peer && !isProcessAlive(peer.pid)) {
			try {
				fs.unlinkSync(path.join(ROOM_DIR, file));
			} catch {}
		}
	}
}

function discoverPeers(): PeerInfo[] {
	ensureDir();
	const peers: PeerInfo[] = [];
	for (const file of fs.readdirSync(ROOM_DIR)) {
		if (!file.endsWith(".json")) continue;
		const peer = readPeer(path.join(ROOM_DIR, file));
		if (peer && peer.pane !== TMUX_PANE && isProcessAlive(peer.pid)) {
			peers.push(peer);
		}
	}
	return peers;
}

function extractRecentFiles(sessionPath: string | null, limit = 5): string[] {
	if (!sessionPath) return [];
	try {
		const raw = fs.readFileSync(sessionPath, "utf-8");
		const session = JSON.parse(raw);
		const files: string[] = [];
		for (const entry of session.entries ?? []) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult") continue;
			if (msg.toolName !== "edit" && msg.toolName !== "write") continue;
			const p = msg.details?.path ?? msg.input?.path;
			if (p && !files.includes(p)) files.push(p);
		}
		return files.slice(-limit);
	} catch {
		return [];
	}
}

function formatSessionEntries(sessionPath: string | null, count: number): string {
	if (!sessionPath) return "(no session file)";
	try {
		const raw = fs.readFileSync(sessionPath, "utf-8");
		const session = JSON.parse(raw);
		const entries = (session.entries ?? []).slice(-count);
		const lines: string[] = [];
		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role === "user") {
				const text =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								?.filter((c: { type: string }) => c.type === "text")
								.map((c: { text: string }) => c.text)
								.join("") ?? "";
				lines.push(`user: ${text.slice(0, 200)}`);
			} else if (msg.role === "assistant") {
				const text =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								?.filter((c: { type: string }) => c.type === "text")
								.map((c: { text: string }) => c.text)
								.join("") ?? "";
				if (text) lines.push(`assistant: ${text.slice(0, 300)}`);
			} else if (msg.role === "toolResult") {
				const result =
					typeof msg.content === "string"
						? msg.content.slice(0, 150)
						: msg.content
								?.filter((c: { type: string }) => c.type === "text")
								.map((c: { text: string }) => c.text)
								.join("")
								.slice(0, 150) ?? "";
				lines.push(`tool(${msg.toolName}): ${result}`);
			} else if (msg.role === "toolCall") {
				const args = JSON.stringify(msg.input ?? {}).slice(0, 150);
				lines.push(`call(${msg.toolName}): ${args}`);
			}
		}
		return lines.join("\n") || "(empty session)";
	} catch (e) {
		return `(error reading session: ${e})`;
	}
}

export default function (pi: ExtensionAPI) {
	if (!TMUX_PANE) return;

	// Register on startup, clean stale entries
	pi.on("session_start", async (_event, ctx) => {
		cleanupStale();
		writeSelf(ctx);
	});

	// Update registration when session changes
	pi.on("session_switch", async (_event, ctx) => {
		writeSelf(ctx);
	});

	// Deregister on shutdown
	pi.on("session_shutdown", async () => {
		removeSelf();
	});

	// Inject room awareness into the system prompt
	pi.on("before_agent_start", async (event) => {
		const peers = discoverPeers();
		const selfId = paneFileId(TMUX_PANE!);

		if (peers.length === 0) return;

		const peerLines: string[] = [];
		for (const peer of peers) {
			const files = extractRecentFiles(peer.session);
			const fileStr = files.length > 0 ? files.join(", ") : "none yet";
			const parentTag = peer.parentPane === selfId ? " [child]"
				: peer.parentPane ? ` [child of ${peer.parentPane}]` : "";
			peerLines.push(`- pane ${paneFileId(peer.pane)} (${peer.cwd})${parentTag}: ${fileStr}`);
		}

		const roomContext = [
			`\n\n## Room`,
			`You are pane ${selfId}. ${peers.length} other agent(s) working in parallel.`,
			`Files touched by others:`,
			...peerLines,
			`Use peek(pane) before editing shared files.`,
		].join("\n");

		return { systemPrompt: event.systemPrompt + roomContext };
	});

	// Peek tool — see what another agent is doing
	pi.registerTool({
		name: "peek",
		label: "Peek",
		description: [
			"See what another agent in the room is working on.",
			"Default mode 'screen' shows terminal scrollback via tmux.",
			"Mode 'session' shows structured conversation history from the pi session file.",
			"Specify a pane ID to peek at one agent, or omit for all.",
		].join("\n"),
		parameters: Type.Object({
			pane: Type.Optional(
				Type.String({ description: "Pane ID to peek at (from room info). Omit for all peers." }),
			),
			mode: Type.Optional(
				StringEnum(["screen", "session"] as const, {
					description: "screen (default): terminal scrollback. session: structured tool/message history.",
				}),
			),
			lines: Type.Optional(
				Type.Number({ description: "Lines of scrollback for screen mode. Default 30." }),
			),
			entries: Type.Optional(
				Type.Number({ description: "Number of session entries for session mode. Default 10." }),
			),
		}),
		async execute(_toolCallId, params) {
			const peers = discoverPeers();
			if (peers.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No other agents in the room." }],
					details: {},
				};
			}

			const targetPeers = params.pane
				? peers.filter((p) => paneFileId(p.pane) === params.pane)
				: peers;

			if (targetPeers.length === 0) {
				const available = peers.map((p) => paneFileId(p.pane)).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `No agent found at pane ${params.pane}. Available: ${available}`,
						},
					],
					details: {},
				};
			}

			const mode = params.mode ?? "screen";
			const sections: string[] = [];

			for (const peer of targetPeers) {
				const header = `## pane ${paneFileId(peer.pane)} — ${peer.cwd}`;

				if (mode === "session") {
					const content = formatSessionEntries(peer.session, params.entries ?? 10);
					sections.push(`${header}\n\n${content}`);
				} else {
					const result = await pi.exec("tmux", [
						"capture-pane",
						"-t",
						peer.pane,
						"-p",
						"-S",
						`-${params.lines ?? 30}`,
					]);
					const output = result.stdout?.trim() || "(empty screen)";
					sections.push(`${header}\n\n${output}`);
				}
			}

			return {
				content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }],
				details: { mode, peerCount: targetPeers.length },
			};
		},
	});

	// Steer tool — send a message to another agent
	pi.registerTool({
		name: "steer",
		label: "Steer",
		description: [
			"Send a message to another agent's terminal input.",
			"If the agent is mid-task, this interrupts after the current tool (steering).",
			"If idle, it becomes a new prompt.",
			"Include your pane ID so the other agent knows who's talking.",
		].join("\n"),
		parameters: Type.Object({
			pane: Type.String({ description: "Pane ID to send to (from room info)." }),
			message: Type.String({ description: "Message to type into their prompt." }),
		}),
		async execute(_toolCallId, params) {
			const peers = discoverPeers();
			const target = peers.find((p) => paneFileId(p.pane) === params.pane);

			if (!target) {
				const available = peers.map((p) => paneFileId(p.pane)).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `No agent at pane ${params.pane}. Available: ${available || "none"}`,
						},
					],
					details: {},
				};
			}

			await pi.exec("tmux", ["send-keys", "-t", target.pane, params.message, "Enter"]);

			return {
				content: [
					{
						type: "text" as const,
						text: `Sent to pane ${params.pane}: ${params.message}`,
					},
				],
				details: { targetPane: params.pane, targetCwd: target.cwd },
			};
		},
	});
}

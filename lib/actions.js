/**
 * Action executors: one non-interactive process, one HTTP request, or one log
 * line. Every executor resolves (never rejects) to a uniform outcome so the
 * engine only has one shape to record.
 *
 * @module dsh-automations/actions
 */

import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { tailText } from "./util.js";

/**
 * @typedef {object} ActionOutcome
 * @property {"ok"|"error"|"timeout"} status
 * @property {number|null} exitCode
 * @property {string} output
 * @property {string} [error]
 */

/**
 * Build the child environment for one run.
 *
 * @param {object} context - trigger context.
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(context) {
	const env = { ...process.env };
	env.DSH_AUTOMATION_RULE_ID = String(context.ruleId ?? "");
	env.DSH_AUTOMATION_RULE_NAME = String(context.ruleName ?? "");
	env.DSH_AUTOMATION_TRIGGER = String(context.triggerType ?? "");
	env.DSH_AUTOMATION_SESSION_ID = String(context.sessionId ?? "");
	if (context.tool !== undefined) env.DSH_AUTOMATION_TOOL = String(context.tool);
	env.DSH_AUTOMATION_CONTEXT = JSON.stringify({
		kind: context.kind ?? "",
		sessionId: context.sessionId ?? null,
		tool: context.tool ?? null,
		source: context.source ?? null,
		at: new Date().toISOString(),
	});
	return env;
}

/**
 * Kill a process tree (a PowerShell parent may have spawned children).
 *
 * @param {import("node:child_process").ChildProcess} child - the process.
 */
function killTree(child) {
	if (child.pid === undefined) return;
	if (process.platform === "win32") {
		try {
			spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
			return;
		} catch {
			/* fall through to the generic kill */
		}
	}
	try {
		child.kill("SIGKILL");
	} catch {
		/* already gone */
	}
}

/**
 * Resolve the interpreter invocation for a shell action.
 *
 * `cmd.exe` re-parses its own command line, so a normally quoted argument (with
 * `\"` escapes) reaches it verbatim and breaks on quoted paths. The cmd branch
 * therefore passes one pre-quoted command line with
 * `windowsVerbatimArguments`, which is the shape cmd actually expects.
 *
 * @param {{shell?: string, command: string}} action - shell action.
 * @returns {{file: string, args: string[], verbatim: boolean}}
 */
export function shellInvocation(action) {
	const requested = action.shell ?? "auto";
	if (requested === "cmd") {
		return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${action.command}"`], verbatim: true };
	}
	if (requested === "bash") {
		return { file: "bash", args: ["-lc", action.command], verbatim: false };
	}
	if (requested === "powershell") {
		return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", action.command], verbatim: false };
	}
	if (process.platform === "win32") {
		return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", action.command], verbatim: false };
	}
	return { file: "bash", args: ["-lc", action.command], verbatim: false };
}

/**
 * Run a shell action with a hard timeout and bounded output.
 *
 * @param {object} action - normalized shell action.
 * @param {object} context - trigger context.
 * @param {{timeoutMs: number, maxOutputChars: number, defaultCwd: string}} limits - resolved limits.
 * @returns {Promise<ActionOutcome>}
 */
function runShell(action, context, limits) {
	const { file, args, verbatim } = shellInvocation(action);
	const timeoutMs = action.timeoutMs ?? limits.timeoutMs;
	const budget = limits.maxOutputChars;
	return new Promise((resolve) => {
		const started = Date.now();
		let output = "";
		let settled = false;
		let timedOut = false;
		let child;
		const append = (chunk) => {
			output += chunk;
			// Keep memory bounded while a chatty command runs; the tail is what matters.
			if (output.length > budget * 4) output = output.slice(output.length - budget * 2);
		};
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ...result, durationMs: Date.now() - started });
		};
		const timer = setTimeout(() => {
			timedOut = true;
			if (child !== undefined) killTree(child);
		}, Math.max(1000, timeoutMs));

		try {
			child = spawn(file, args, {
				cwd: typeof action.cwd === "string" && action.cwd.trim() !== "" ? action.cwd : limits.defaultCwd,
				env: childEnv(context),
				windowsHide: true,
				windowsVerbatimArguments: verbatim,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			finish({ status: "error", exitCode: null, output: "", error: error instanceof Error ? error.message : String(error) });
			return;
		}

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", append);
		child.stderr?.on("data", append);
		child.on("error", (error) => {
			finish({ status: "error", exitCode: null, output: tailText(output, budget), error: error.message });
		});
		child.on("close", (code, signal) => {
			if (timedOut) {
				finish({ status: "timeout", exitCode: code, output: tailText(output, budget), error: `命令超过 ${timeoutMs}ms 未结束，已终止` });
				return;
			}
			const ok = code === 0;
			finish({
				status: ok ? "ok" : "error",
				exitCode: typeof code === "number" ? code : null,
				output: tailText(output, budget),
				...(ok ? {} : { error: signal ? `进程被信号 ${signal} 终止` : `退出码 ${code}` }),
			});
		});
	});
}

/**
 * Perform one HTTP action.
 *
 * @param {object} action - normalized http action.
 * @param {{maxOutputChars: number}} limits - resolved limits.
 * @returns {Promise<ActionOutcome>}
 */
async function runHttp(action, limits) {
	const timeoutMs = action.timeoutMs ?? 30000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
	try {
		const method = String(action.method ?? "GET").toUpperCase();
		/** @type {Record<string, string>} */
		const headers = {};
		const rawHeaders = String(action.headers ?? "{}").trim();
		if (rawHeaders !== "") {
			const parsed = JSON.parse(rawHeaders);
			for (const [key, value] of Object.entries(parsed)) headers[key] = String(value);
		}
		const body = typeof action.body === "string" && action.body.trim() !== "" && method !== "GET" && method !== "HEAD" ? action.body : undefined;
		const response = await fetch(action.url, { method, headers, body, signal: controller.signal });
		const text = await response.text().catch(() => "");
		const summary = `HTTP ${response.status} ${response.statusText}\n${text}`;
		return {
			status: response.ok ? "ok" : "error",
			exitCode: response.status,
			output: tailText(summary, limits.maxOutputChars),
			...(response.ok ? {} : { error: `HTTP ${response.status}` }),
		};
	} catch (error) {
		const aborted = error instanceof Error && error.name === "AbortError";
		return {
			status: aborted ? "timeout" : "error",
			exitCode: null,
			output: "",
			error: aborted ? `请求超过 ${timeoutMs}ms 未完成` : error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Create the action dispatcher.
 *
 * @param {{settings: object, log: {warn: Function}}} options - resolved settings.
 * @returns {{run: (action: object, context: object) => Promise<ActionOutcome & {durationMs: number}>}}
 */
export function createActions({ settings }) {
	return {
		/**
		 * Execute one normalized action.
		 *
		 * @param {object} action - normalized action.
		 * @param {object} context - trigger context.
		 * @returns {Promise<ActionOutcome & {durationMs: number}>}
		 */
		async run(action, context) {
			const limits = {
				timeoutMs: settings.defaultTimeoutMs,
				maxOutputChars: settings.maxOutputChars,
				defaultCwd: settings.defaultCwd !== "" ? settings.defaultCwd : homedir(),
			};
			const started = Date.now();
			if (action.type === "shell") return runShell(action, context, limits);
			if (action.type === "http") return runHttp(action, limits);
			const message = String(action.message ?? "").trim();
			return {
				status: "ok",
				exitCode: 0,
				output: message === "" ? "" : message,
				durationMs: Date.now() - started,
			};
		},
	};
}

/**
 * Offline selftest: model normalisation, storage round-trip, the run engine and
 * trigger wiring. No DSH host involved — run with `node test/selftest.mjs`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createActions } from "../lib/actions.js";
import { createEngine } from "../lib/engine.js";
import { buildView } from "../lib/http.js";
import { normalizeAction, normalizeRule, normalizeTrigger, RuleError, summarizeTrigger } from "../lib/model.js";
import { resolveConfig } from "../lib/settings.js";
import { createStore } from "../lib/store.js";
import { createTriggerHub } from "../lib/triggers.js";

const silentLog = { warn: () => {} };
const results = [];
let failures = 0;

/**
 * @param {string} name - check name.
 * @param {() => Promise<void> | void} fn - check body.
 */
async function check(name, fn) {
	try {
		await fn();
		results.push(`ok   ${name}`);
	} catch (error) {
		failures += 1;
		results.push(`FAIL ${name}\n     ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	}
}

const tempDirs = [];
/** @returns {string} a fresh temporary directory. */
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "dsha-test-"));
	tempDirs.push(dir);
	return dir;
}

/**
 * @param {number} ms - delay.
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

await check("normalizeTrigger fills defaults and rejects unknown types", () => {
	const trigger = normalizeTrigger({ type: "session-idle" });
	assert.equal(trigger.type, "session-idle");
	assert.equal(trigger.idleSeconds, 600);
	assert.throws(() => normalizeTrigger({ type: "nope" }), (error) => error instanceof RuleError && error.code === "invalid_trigger");
});

await check("normalizeTrigger clamps and validates daily/weekday fields", () => {
	assert.equal(normalizeTrigger({ type: "interval", minutes: 99999 }).minutes, 1440);
	assert.equal(normalizeTrigger({ type: "daily", time: "25:99" }).time, "08:30");
	assert.deepEqual(normalizeTrigger({ type: "daily", weekdays: [3, 1, 3, 9, "2"] }).weekdays, [1, 2, 3]);
});

await check("normalizeAction enforces required command/url and JSON headers", () => {
	assert.throws(() => normalizeAction({ type: "shell", command: "  " }), /缺少必填项/);
	assert.throws(() => normalizeAction({ type: "http", url: "not a url" }), /URL/);
	assert.throws(() => normalizeAction({ type: "http", url: "https://x.test", headers: "[1]" }), /JSON 对象/);
	const action = normalizeAction({ type: "http", url: "https://x.test", headers: "{\"a\":1}" });
	assert.equal(action.method, "GET");
	assert.equal(action.timeoutMs, 30000);
});

await check("normalizeRule keeps identity, timestamps and defaults", () => {
	const first = normalizeRule({ name: "  测试  ", trigger: { type: "startup" }, action: { type: "log", message: "hi" } });
	assert.equal(first.name, "测试");
	assert.equal(first.enabled, true);
	assert.equal(first.cooldownSeconds, 0);
	assert.ok(first.id.startsWith("rule-"));
	const second = normalizeRule({ ...first, name: "改名" }, { previous: first });
	assert.equal(second.id, first.id);
	assert.equal(second.name, "改名");
	assert.equal(second.createdAt, first.createdAt);
	assert.throws(() => normalizeRule({ id: "bad id!", name: "x", trigger: {}, action: { type: "log" } }), /规则 id/);
});

await check("summarizeTrigger renders the trigger for people", () => {
	assert.match(summarizeTrigger({ type: "startup", delayMs: 1500 }), /DSH 启动/);
	assert.match(summarizeTrigger({ type: "daily", time: "08:30", weekdays: [1, 2] }), /每天 08:30 · 1,2/);
	assert.match(summarizeTrigger({ type: "tool-after", tool: "pwsh", when: "error" }), /pwsh/);
});

await check("store round-trips rules and runs", () => {
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 5, log: silentLog });
	const rule = store.upsert({ name: "持久化", trigger: { type: "manual" }, action: { type: "log", message: "x" } });
	assert.equal(store.list().length, 1);
	store.addRun({ id: "run-1", ruleId: rule.id, ruleName: rule.name, trigger: "manual", at: new Date().toISOString(), durationMs: 5, status: "ok", exitCode: 0, output: "x" });
	store.flush();

	const reloaded = createStore({ dir, maxRuns: 5, log: silentLog });
	assert.equal(reloaded.list().length, 1);
	assert.equal(reloaded.list()[0].name, "持久化");
	assert.equal(reloaded.list()[0].runCount, 1);
	assert.equal(reloaded.list()[0].lastRun.status, "ok");
	assert.equal(reloaded.listRuns(10).length, 1);
	assert.equal(reloaded.remove(rule.id), true);
	assert.equal(reloaded.list().length, 0);
	reloaded.flush();
});

await check("store tolerates a corrupt file instead of throwing", () => {
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 5, log: silentLog });
	store.upsert({ name: "a", trigger: { type: "manual" }, action: { type: "log", message: "a" } });
	store.flush();
	writeFileSync(join(dir, "rules.json"), "{ this is not json", "utf8");
	const recovered = createStore({ dir, maxRuns: 5, log: silentLog });
	assert.equal(recovered.list().length, 0, "the corrupt file is set aside");
	assert.ok(readdirSync(dir).some((name) => name.startsWith("rules.json.broken-")), "a .broken copy is kept");
});

await check("engine runs a command, records it, and honours cooldown", async () => {
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 10, log: silentLog });
	const settings = resolveConfig({ defaultTimeoutMs: 15000, maxOutputChars: 4000 });
	const actions = createActions({ settings });
	const engine = createEngine({ settings, store, actions, log: silentLog });
	const command = process.platform === "win32" ? "echo hello-dsha" : "echo hello-dsha";
	const rule = store.upsert({
		name: "echo",
		cooldownSeconds: 60,
		trigger: { type: "manual" },
		action: { type: "shell", command, shell: process.platform === "win32" ? "cmd" : "bash" },
	});
	const first = await engine.submit(rule, { kind: "manual" }, { force: false });
	assert.equal(first.status, "ok", first.error ?? "");
	assert.match(first.output, /hello-dsha/);
	assert.equal(store.listRuns(5).length, 1);
	const second = await engine.submit(rule, { kind: "manual" }, { force: false });
	assert.equal(second.status, "skipped");
	assert.equal(store.listRuns(5).length, 1, "a skipped run is not recorded");
});

await check("engine times out a hanging command", async () => {
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 10, log: silentLog });
	const settings = resolveConfig({ maxOutputChars: 2000 });
	const actions = createActions({ settings });
	const engine = createEngine({ settings, store, actions, log: silentLog });
	const rule = store.upsert({
		name: "slow",
		trigger: { type: "manual" },
		action: process.platform === "win32"
			? { type: "shell", command: "Start-Sleep -Seconds 30", shell: "powershell", timeoutMs: 1200 }
			: { type: "shell", command: "sleep 30", shell: "bash", timeoutMs: 1200 },
	});
	const run = await engine.submit(rule, { kind: "manual" }, { force: true });
	assert.equal(run.status, "timeout", `expected timeout, got ${run.status}: ${run.error ?? ""}`);
});

await check("shell defaults to the user home when cwd is empty", async () => {
	const settings = resolveConfig({ maxOutputChars: 2000 });
	const actions = createActions({ settings });
	const action = process.platform === "win32"
		? { type: "shell", command: "cd", shell: "cmd", timeoutMs: 10000 }
		: { type: "shell", command: "pwd", shell: "bash", timeoutMs: 10000 };
	const run = await actions.run(action, { ruleId: "cwd", ruleName: "cwd", triggerType: "manual" });
	assert.equal(run.status, "ok", run.error ?? "");
	const expected = homedir().replace(/\\/g, "\\");
	assert.ok(run.output.toLowerCase().includes(expected.toLowerCase()), `expected ${expected} in ${run.output}`);
});

await check("panel view exposes the default working directory", () => {
	const settings = resolveConfig({});
	const store = { dir: "x", list: () => [], listRuns: () => [] };
	const view = buildView({ store, engine: { busy: () => 0 }, hub: { bootedAt: "2026-01-01T00:00:00.000Z" }, settings });
	assert.equal(view.defaultCwd, homedir());
	const custom = buildView({ store, engine: { busy: () => 0 }, hub: { bootedAt: "x" }, settings: resolveConfig({ defaultCwd: "D:\\work" }) });
	assert.equal(custom.defaultCwd, "D:\\work");
});

await check("engine performs an HTTP action", async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("pong");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address !== null ? address.port : 0;
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 10, log: silentLog });
	const settings = resolveConfig({ maxOutputChars: 4000 });
	const actions = createActions({ settings });
	const engine = createEngine({ settings, store, actions, log: silentLog });
	const rule = store.upsert({ name: "http", trigger: { type: "manual" }, action: { type: "http", url: `http://127.0.0.1:${port}/ping`, timeoutMs: 5000 } });
	const run = await engine.submit(rule, { kind: "manual" }, { force: true });
	server.close();
	assert.equal(run.status, "ok", run.error ?? "");
	assert.match(run.output, /pong/);
	assert.equal(run.exitCode, 200);
});

await check("trigger hub fires startup and lifecycle rules", async () => {
	globalThis.__dshAutomationsBootAt = undefined;
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 10, log: silentLog });
	store.upsert({ id: "startup-rule", name: "boot", trigger: { type: "startup", delayMs: 0 }, action: { type: "log", message: "boot" } });
	store.upsert({ id: "start-rule", name: "start", trigger: { type: "session-start", source: "resume" }, action: { type: "log", message: "start" } });
	const handlers = {};
	const ctx = { on: (name, listener) => { handlers[name] = listener; return () => {}; } };
	const calls = [];
	const engine = { submit: (rule, context) => { calls.push({ id: rule.id, context }); return Promise.resolve({ status: "ok" }); } };
	const hub = createTriggerHub({ ctx, settings: resolveConfig({ startupDelayMs: 0 }), store, engine, log: silentLog });
	hub.start();
	await sleep(25);
	handlers["agent/created"]({ agent: { session: { header: { id: "s1" } } }, source: "startup" });
	handlers["agent/created"]({ agent: { session: { header: { id: "s2" } } }, source: "resume" });
	handlers["agent/disposed"]({ agent: { session: { header: { id: "s2" } } } });
	await sleep(5);
	hub.stop();
	assert.ok(calls.some((call) => call.id === "startup-rule" && call.context.kind === "startup"), JSON.stringify(calls));
	assert.ok(calls.some((call) => call.id === "start-rule" && call.context.sessionId === "s2"), JSON.stringify(calls));
	assert.equal(calls.filter((call) => call.id === "start-rule").length, 1, "source filter keeps the startup session out");
});

await check("trigger hub enforces first-of-session user messages", async () => {
	globalThis.__dshAutomationsBootAt = undefined;
	const dir = tempDir();
	const store = createStore({ dir, maxRuns: 10, log: silentLog });
	store.upsert({ id: "first", name: "first", trigger: { type: "user-message", mode: "first-of-session" }, action: { type: "log", message: "x" } });
	const handlers = {};
	const ctx = { on: (name, listener) => { handlers[name] = listener; return () => {}; } };
	const calls = [];
	const engine = { submit: (rule, context) => { calls.push(context); return Promise.resolve({ status: "ok" }); } };
	const hub = createTriggerHub({ ctx, settings: resolveConfig({}), store, engine, log: silentLog });
	hub.start();
	const session = { id: "s1" };
	handlers["session/event"](session, { type: "user/message", data: { content: [{ type: "text", text: "hello" }] } });
	handlers["session/event"](session, { type: "user/message", data: { content: [{ type: "text", text: "again" }] } });
	hub.stop();
	assert.equal(calls.length, 1);
});

for (const line of results) console.log(line);
for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${results.length - failures}/${results.length} checks`);
process.exit(failures === 0 ? 0 : 1);

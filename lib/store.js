/**
 * Durable rule/run storage.
 *
 * Three small JSON files under one directory: `rules.json`, `runs.json` and
 * `meta.json` (scheduler bookkeeping that must survive a restart, such as "the
 * daily rule already fired today"). Writes are debounced and atomic within the
 * directory; a corrupt file is set aside instead of blocking startup.
 *
 * @module dsh-automations/store
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeRule, RuleError } from "./model.js";

/** @returns the default scheduler memory. */
function defaultMeta() {
	return { lastFired: {}, lastIntervalAt: {}, lastUserMessageDay: "", bootedAt: "" };
}

/**
 * Read a JSON file, returning `fallback` when it is missing or unreadable.
 *
 * @param {string} file - absolute path.
 * @param {unknown} fallback - value used on any failure.
 * @param {(error: unknown) => void} [warn] - called on a recoverable failure.
 * @returns {unknown}
 */
function readJson(file, fallback, warn) {
	if (!existsSync(file)) return fallback;
	try {
		return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		warn?.(error);
		try {
			renameSync(file, `${file}.broken-${Date.now()}`);
		} catch {
			/* best effort */
		}
		return fallback;
	}
}

/**
 * Write text atomically inside its directory (best effort on Windows rename).
 *
 * @param {string} file - destination.
 * @param {string} text - content.
 */
function writeAtomic(file, text) {
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, text, "utf8");
	try {
		renameSync(temp, file);
	} catch {
		writeFileSync(file, text, "utf8");
	}
}

/**
 * Create the store and load what is already on disk.
 *
 * @param {{dir: string, maxRuns: number, log: {warn: Function}}} options - storage options.
 * @returns {object} store facade.
 */
export function createStore({ dir, maxRuns, log }) {
	mkdirSync(dir, { recursive: true });
	const rulesFile = join(dir, "rules.json");
	const runsFile = join(dir, "runs.json");
	const metaFile = join(dir, "meta.json");

	const warn = (error) => log?.warn?.(`[dsh-automations] storage: ${error instanceof Error ? error.message : String(error)}`);

	/** @type {Array<object>} */
	let rules = [];
	/** @type {Array<object>} */
	let runs = [];
	/** @type {Record<string, any>} */
	let meta = defaultMeta();
	/** @type {Set<() => void>} */
	const listeners = new Set();
	let saveTimer = null;
	let dirty = false;

	// ── load ────────────────────────────────────────────────────────────────
	const rawRules = readJson(rulesFile, [], warn);
	const ruleList = Array.isArray(rawRules) ? rawRules : Array.isArray(rawRules?.rules) ? rawRules.rules : [];
	for (const raw of ruleList) {
		try {
			rules.push(normalizeRule(raw, { previous: raw }));
		} catch (error) {
			if (error instanceof RuleError) warn(`skipping invalid rule: ${error.message}`);
			else warn(error);
		}
	}
	const rawRuns = readJson(runsFile, [], warn);
	const runList = Array.isArray(rawRuns) ? rawRuns : Array.isArray(rawRuns?.runs) ? rawRuns.runs : [];
	runs = runList.filter((run) => run !== null && typeof run === "object").slice(0, maxRuns);
	const rawMeta = readJson(metaFile, defaultMeta(), warn);
	if (rawMeta !== null && typeof rawMeta === "object") meta = { ...defaultMeta(), ...rawMeta };

	// ── persistence ─────────────────────────────────────────────────────────
	function persist() {
		dirty = false;
		try {
			writeAtomic(rulesFile, `${JSON.stringify({ version: 1, rules }, null, 2)}\n`);
			writeAtomic(runsFile, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`);
			writeAtomic(metaFile, `${JSON.stringify({ version: 1, ...meta }, null, 2)}\n`);
		} catch (error) {
			warn(error);
		}
	}

	function scheduleSave() {
		dirty = true;
		if (saveTimer !== null) return;
		saveTimer = setTimeout(() => {
			saveTimer = null;
			if (dirty) persist();
		}, 250);
		if (typeof saveTimer.unref === "function") saveTimer.unref();
	}

	function emit() {
		for (const listener of listeners) {
			try {
				listener();
			} catch (error) {
				warn(error);
			}
		}
	}

	// ── public face ─────────────────────────────────────────────────────────
	return {
		dir,

		/** @returns {Array<object>} a copy of the rules, in insertion order. */
		list() {
			return rules.map((rule) => ({ ...rule }));
		},

		/**
		 * @param {string} id - rule id.
		 * @returns {object | undefined} the rule.
		 */
		get(id) {
			const rule = rules.find((entry) => entry.id === id);
			return rule === undefined ? undefined : { ...rule };
		},

		/**
		 * Create or replace one rule.
		 *
		 * @param {unknown} input - untrusted rule payload.
		 * @returns {object} the stored rule.
		 * @throws {RuleError} on invalid input.
		 */
		upsert(input) {
			const wantedId = input !== null && typeof input === "object" ? String(input.id ?? "") : "";
			const previous = wantedId === "" ? null : rules.find((entry) => entry.id === wantedId) ?? null;
			const rule = normalizeRule(input, { previous });
			const index = rules.findIndex((entry) => entry.id === rule.id);
			if (index >= 0) rules[index] = rule;
			else rules.push(rule);
			scheduleSave();
			emit();
			return { ...rule };
		},

		/**
		 * @param {string} id - rule id.
		 * @returns {boolean} whether a rule was removed.
		 */
		remove(id) {
			const index = rules.findIndex((entry) => entry.id === id);
			if (index < 0) return false;
			rules.splice(index, 1);
			scheduleSave();
			emit();
			return true;
		},

		/**
		 * @param {string} id - rule id.
		 * @param {boolean} enabled - desired state.
		 * @returns {object | undefined} the updated rule.
		 */
		setEnabled(id, enabled) {
			const rule = rules.find((entry) => entry.id === id);
			if (rule === undefined) return undefined;
			rule.enabled = enabled !== false;
			rule.updatedAt = new Date().toISOString();
			scheduleSave();
			emit();
			return { ...rule };
		},

		/**
		 * Record a finished run and fold its summary into the rule.
		 *
		 * @param {object} run - run record.
		 * @param {{outputTail?: string}} [options] - summary options.
		 * @returns {object} the run.
		 */
		addRun(run, options = {}) {
			runs.unshift(run);
			if (runs.length > maxRuns) runs.length = maxRuns;
			const rule = rules.find((entry) => entry.id === run.ruleId);
			if (rule !== undefined) {
				rule.runCount += 1;
				rule.lastRun = {
					at: run.at,
					status: run.status,
					durationMs: run.durationMs,
					exitCode: run.exitCode,
					outputTail: typeof options.outputTail === "string" ? options.outputTail.slice(-400) : "",
				};
			}
			scheduleSave();
			emit();
			return run;
		},

		/**
		 * @param {number} limit - maximum records.
		 * @returns {Array<object>} newest-first run records.
		 */
		listRuns(limit = 20) {
			return runs.slice(0, Math.max(0, limit)).map((run) => ({ ...run }));
		},

		/** @returns {Record<string, any>} scheduler memory (live object, mutate then save). */
		meta() {
			return meta;
		},

		/** Persist meta changes made through {@link meta}. */
		touchMeta() {
			scheduleSave();
		},

		/**
		 * Read one run by id.
		 *
		 * @param {string} id - run id.
		 * @returns {object | undefined}
		 */
		getRun(id) {
			return runs.find((entry) => entry.id === id);
		},

		/**
		 * Subscribe to any change (rule edit, run recorded).
		 *
		 * @param {() => void} listener - change callback.
		 * @returns {() => void} unsubscribe.
		 */
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},

		/** Write pending changes immediately. */
		flush() {
			if (saveTimer !== null) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
			if (dirty || !existsSync(rulesFile)) persist();
		},
	};
}

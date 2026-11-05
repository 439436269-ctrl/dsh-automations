/**
 * The run engine: validates cooldowns, serialises executions and records every
 * outcome.
 *
 * Runs are serial on purpose — automations are usually file/port/notification
 * operations, and a burst of lifecycle events must not interleave two commands
 * that touch the same resource. A full queue drops new work instead of growing
 * without bound.
 *
 * @module dsh-automations/engine
 */

import { newId, nowIso } from "./util.js";

/** Queue ceiling; beyond this a trigger is skipped rather than delayed. */
const MAX_QUEUE = 200;

/**
 * @param {object} rule - stored rule.
 * @param {object} context - trigger context.
 * @param {string} reason - skip reason.
 * @returns {object} a skipped run record (not persisted).
 */
function skipped(rule, context, reason) {
	return {
		id: newId("run"),
		ruleId: rule.id,
		ruleName: rule.name,
		trigger: rule.trigger?.type ?? "manual",
		at: nowIso(),
		durationMs: 0,
		status: "skipped",
		exitCode: null,
		output: "",
		error: reason,
		skipped: true,
		context: context ?? {},
	};
}

/**
 * Create the engine.
 *
 * @param {{settings: object, store: object, actions: {run: Function}, log: {warn: Function}}} options
 * @returns {{submit: Function, busy: () => number}}
 */
export function createEngine({ settings, store, actions, log }) {
	/** @type {Array<{rule: object, context: object, resolve: Function, draft: boolean}>} */
	const queue = [];
	/** @type {Map<string, number>} last execution start per rule. */
	const lastStarted = new Map();
	let draining = false;

	/**
	 * @param {object} rule - stored rule.
	 * @param {number} now - current epoch ms.
	 * @returns {boolean} whether the cooldown still holds.
	 */
	function coolingDown(rule, now) {
		const cooldown = Number(rule.cooldownSeconds ?? 0);
		if (!Number.isSafeInteger(cooldown) || cooldown <= 0) return false;
		const last = lastStarted.get(rule.id) ?? (rule.lastRun?.at ? Date.parse(rule.lastRun.at) : Number.NaN);
		return Number.isFinite(last) && now - last < cooldown * 1000;
	}

	/**
	 * Execute one job and record it.
	 *
	 * @param {{rule: object, context: object, draft: boolean}} job - queued work.
	 * @returns {Promise<object>} the run record.
	 */
	async function execute(job) {
		const { rule, context, draft } = job;
		const startedAt = Date.now();
		lastStarted.set(rule.id, startedAt);
		let outcome;
		try {
			outcome = await actions.run(rule.action, {
				...context,
				ruleId: rule.id,
				ruleName: rule.name,
				triggerType: rule.trigger?.type ?? "manual",
			});
		} catch (error) {
			outcome = {
				status: "error",
				exitCode: null,
				output: "",
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - startedAt,
			};
		}
		const record = {
			id: newId("run"),
			ruleId: rule.id,
			ruleName: rule.name,
			trigger: rule.trigger?.type ?? "manual",
			at: new Date(startedAt).toISOString(),
			durationMs: Math.max(0, Number(outcome.durationMs) || Date.now() - startedAt),
			status: outcome.status ?? "error",
			exitCode: typeof outcome.exitCode === "number" ? outcome.exitCode : null,
			output: typeof outcome.output === "string" ? outcome.output : "",
			error: outcome.error ?? null,
			draft: draft === true ? true : undefined,
			context: {
				kind: context?.kind ?? "manual",
				sessionId: context?.sessionId ?? null,
				tool: context?.tool ?? null,
				source: context?.source ?? null,
			},
		};
		if (!draft) {
			store.addRun(record, { outputTail: record.output });
		}
		if (record.status !== "ok" && record.status !== "skipped") {
			log?.warn?.(`[dsh-automations] ${rule.name}: ${record.status} ${record.error ?? ""}`.trim());
		}
		return record;
	}

	/** Drain queued jobs one at a time. */
	async function drain() {
		if (draining) return;
		draining = true;
		try {
			while (queue.length > 0) {
				const job = queue.shift();
				const record = await execute(job);
				job.resolve(record);
			}
		} finally {
			draining = false;
		}
	}

	return {
		/**
		 * Submit one rule run.
		 *
		 * @param {object} rule - stored rule (enabled check applies unless forced).
		 * @param {object} [context] - trigger context recorded with the run.
		 * @param {{force?: boolean, draft?: boolean}} [options] - `force` skips the cooldown (manual run).
		 * @returns {Promise<object>} the run record, including `status: "skipped"`.
		 */
		submit(rule, context = {}, options = {}) {
			const now = Date.now();
			if (options.force !== true) {
				if (rule.enabled === false) return Promise.resolve(skipped(rule, context, "规则已停用"));
				if (coolingDown(rule, now)) return Promise.resolve(skipped(rule, context, "冷却中"));
			}
			if (queue.length >= MAX_QUEUE) return Promise.resolve(skipped(rule, context, "执行队列已满"));
			return new Promise((resolve) => {
				queue.push({ rule, context, resolve, draft: options.draft === true });
				void drain();
			});
		},

		/** @returns {number} queued + running jobs. */
		busy() {
			return queue.length + (draining ? 1 : 0);
		},
	};
}

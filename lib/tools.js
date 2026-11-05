/**
 * Model-facing tools. They mirror the panel's capabilities with a flat, easily
 * authored schema: `triggerType` / `actionType` plus one bag of field values.
 *
 * @module dsh-automations/tools
 */

import { ACTION_TYPES, RuleError, TRIGGER_TYPES, summarizeAction, summarizeTrigger } from "./model.js";
import { humanDuration } from "./util.js";

/**
 * @param {object} rule - stored rule.
 * @returns {object} the compact shape declared by the tool schemas.
 */
function ruleRow(rule) {
	return {
		id: rule.id,
		name: rule.name,
		enabled: rule.enabled !== false,
		trigger: rule.trigger.type,
		action: rule.action.type,
		triggerSummary: summarizeTrigger(rule.trigger, "zh"),
		actionSummary: summarizeAction(rule.action, "zh"),
		cooldownSeconds: rule.cooldownSeconds ?? 0,
		lastRunAt: rule.lastRun?.at ?? "",
		lastStatus: rule.lastRun?.status ?? "",
		runCount: rule.runCount ?? 0,
	};
}

/** Shared rule-row schema. */
const RULE_ROW_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: { type: "string", required: true },
		name: { type: "string", required: true },
		enabled: { type: "boolean", required: true },
		trigger: { type: "string", required: true },
		action: { type: "string", required: true },
		triggerSummary: { type: "string", required: true },
		actionSummary: { type: "string", required: true },
		cooldownSeconds: { type: "integer", required: true },
		lastRunAt: { type: "string", required: true },
		lastStatus: { type: "string", required: true },
		runCount: { type: "integer", required: true },
	},
};

/**
 * Build every tool spec.
 *
 * @param {{store: object, engine: object}} deps - live services.
 * @returns {Array<object>} specs consumed by `index.js`.
 */
export function createToolSpecs({ store, engine }) {
	return [
		{
			name: "automation_list",
			description:
				"List DSH automations (rules that run a command / HTTP request / log entry on a lifecycle or clock trigger). "
				+ "Call this before creating a rule to avoid duplicates, and when the user asks what automations exist or why one did not run.",
			parameters: {
				enabledOnly: { type: "boolean", description: "Only return enabled rules." },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					count: { type: "integer", required: true },
					rules: { type: "array", items: RULE_ROW_SCHEMA, required: true },
				},
			},
			render: (_args, value) => {
				if (value.count === 0) return [{ type: "text", text: "还没有自动化任务。" }];
				const lines = value.rules.map((rule) => `- ${rule.enabled ? "●" : "○"} ${rule.name} [${rule.id}]\n  时机：${rule.triggerSummary}\n  动作：${rule.actionSummary}${rule.lastStatus ? `\n  上次：${rule.lastRunAt} ${rule.lastStatus}` : ""}`);
				return [{ type: "text", text: lines.join("\n") }];
			},
			execute: (args) => {
				const onlyEnabled = args?.enabledOnly === true;
				const rules = store.list().filter((rule) => (onlyEnabled ? rule.enabled !== false : true)).map(ruleRow);
				return { count: rules.length, rules };
			},
		},
		{
			name: "automation_save",
			description:
				"Create or update one DSH automation. Triggers: startup (DSH boots), session-start, session-idle, session-end, user-message, tool-after, daily, interval, manual. "
				+ "Actions: shell (local command, captured output + exit code), http (webhook/health check), log (side-effect free). "
				+ "Omit `id` to create; pass an existing id to update. Prefer a non-zero cooldown for anything reachable from frequent events, and never schedule an interactive command.",
			parameters: {
				id: { type: "string", description: "Existing rule id to update; omit to create a new rule." },
				name: { type: "string", required: true, description: "Short human name shown in the panel." },
				triggerType: { type: "string", required: true, enum: TRIGGER_TYPES, description: "Trigger kind." },
				trigger: {
					type: "object",
					additionalProperties: false,
					description: "Trigger fields: delayMs, source, idleSeconds, mode, match, tool, when, time, weekdays, minutes (only the ones the trigger uses).",
					properties: {
						delayMs: { type: "integer" },
						source: { type: "string" },
						idleSeconds: { type: "integer" },
						mode: { type: "string" },
						match: { type: "string" },
						tool: { type: "string" },
						when: { type: "string" },
						time: { type: "string" },
						weekdays: { type: "array", items: { type: "integer" } },
						minutes: { type: "integer" },
					},
				},
				actionType: { type: "string", required: true, enum: ACTION_TYPES, description: "Action kind." },
				action: {
					type: "object",
					additionalProperties: false,
					description: "Action fields: command, cwd, shell, timeoutMs (shell); url, method, headers, body, timeoutMs (http); message (log).",
					properties: {
						command: { type: "string" },
						cwd: { type: "string" },
						shell: { type: "string" },
						timeoutMs: { type: "integer" },
						url: { type: "string" },
						method: { type: "string" },
						headers: { type: "string" },
						body: { type: "string" },
						message: { type: "string" },
					},
				},
				cooldownSeconds: { type: "integer", description: "Minimum seconds between two runs of this rule (0 means none)." },
				enabled: { type: "boolean", description: "Defaults to true." },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					rule: RULE_ROW_SCHEMA,
					total: { type: "integer", required: true },
				},
			},
			render: (_args, value) => [{ type: "text", text: `已保存「${value.rule.name}」[${value.rule.id}]\n时机：${value.rule.triggerSummary}\n动作：${value.rule.actionSummary}\n当前共 ${value.total} 条规则。` }],
			execute: (args) => {
				if (typeof args?.name !== "string" || args.name.trim() === "") throw new Error("name 不能为空：给这条自动化起一个能看懂的名字。");
				const rule = store.upsert({
					id: args.id,
					name: args.name,
					enabled: args.enabled,
					cooldownSeconds: args.cooldownSeconds,
					trigger: { ...(args.trigger ?? {}), type: args.triggerType },
					action: { ...(args.action ?? {}), type: args.actionType },
				});
				return { ok: true, rule: ruleRow(rule), total: store.list().length };
			},
		},
		{
			name: "automation_run",
			description:
				"Run one automation immediately and return its captured output. Use it to test a rule after creating it. "
				+ "A non-zero exit code or an `error` field means the command itself failed; the automation is still saved.",
			parameters: {
				id: { type: "string", required: true, description: "Rule id from automation_list." },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					status: { type: "string", required: true },
					exitCode: { type: "integer", required: true },
					durationMs: { type: "integer", required: true },
					output: { type: "string", required: true },
					error: { type: "string", required: true },
				},
			},
			render: (_args, value) => [{
				type: "text",
				text: `${value.ok ? "成功" : "失败"}（${value.status}，${humanDuration(value.durationMs)}，退出码 ${value.exitCode}）${value.error ? `\n${value.error}` : ""}${value.output ? `\n\n${value.output}` : ""}`,
			}],
			execute: async (args) => {
				const id = String(args?.id ?? "");
				const rule = store.get(id);
				if (rule === undefined) throw new Error(`规则不存在：${id}。先用 automation_list 取得准确 id。`);
				const run = await engine.submit(rule, { kind: "manual" }, { force: true });
				return {
					ok: run.status === "ok",
					status: run.status,
					exitCode: typeof run.exitCode === "number" ? run.exitCode : -1,
					durationMs: run.durationMs ?? 0,
					output: run.output ?? "",
					error: run.error ?? "",
				};
			},
		},
		{
			name: "automation_remove",
			description: "Delete one automation by id. The rule stops immediately; past run records stay in history.",
			parameters: {
				id: { type: "string", required: true, description: "Rule id from automation_list." },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					ok: { type: "boolean", required: true },
					removed: { type: "boolean", required: true },
					id: { type: "string", required: true },
				},
			},
			render: (_args, value) => [{ type: "text", text: value.removed ? `已删除 ${value.id}` : `没有找到 ${value.id}` }],
			execute: (args) => {
				const id = String(args?.id ?? "");
				const removed = store.remove(id);
				if (!removed) throw new RuleError("rule_not_found", `规则不存在：${id}`);
				return { ok: true, removed: true, id };
			},
		},
		{
			name: "automation_runs",
			description: "Read recent automation runs (newest first), optionally for one rule. Use it to diagnose why an automation did not do what the user expected.",
			parameters: {
				limit: { type: "integer", description: "How many records (1-100, default 20)." },
				ruleId: { type: "string", description: "Only runs of this rule id." },
			},
			outputSchema: {
				type: "object",
				additionalProperties: false,
				properties: {
					count: { type: "integer", required: true },
					runs: {
						type: "array",
						required: true,
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								id: { type: "string", required: true },
								ruleId: { type: "string", required: true },
								ruleName: { type: "string", required: true },
								at: { type: "string", required: true },
								trigger: { type: "string", required: true },
								status: { type: "string", required: true },
								durationMs: { type: "integer", required: true },
								exitCode: { type: "integer", required: true },
								output: { type: "string", required: true },
							},
						},
					},
				},
			},
			render: (_args, value) => {
				if (value.count === 0) return [{ type: "text", text: "还没有运行记录。" }];
				const lines = value.runs.map((run) => `- ${run.at} ${run.status} ${run.ruleName}（${run.trigger}，${humanDuration(run.durationMs)}）${run.output ? `\n  ${run.output.split(/\r?\n/)[0].slice(0, 160)}` : ""}`);
				return [{ type: "text", text: lines.join("\n") }];
			},
			execute: (args) => {
				const limit = Number(args?.limit);
				const take = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
				const ruleId = typeof args?.ruleId === "string" ? args.ruleId : "";
				const runs = store.listRuns(200).filter((run) => (ruleId === "" ? true : run.ruleId === ruleId)).slice(0, take).map((run) => ({
					id: run.id,
					ruleId: run.ruleId,
					ruleName: run.ruleName,
					at: run.at,
					trigger: run.trigger,
					status: run.status,
					durationMs: run.durationMs ?? 0,
					exitCode: typeof run.exitCode === "number" ? run.exitCode : -1,
					output: run.output ?? "",
				}));
				return { count: runs.length, runs };
			},
		},
	];
}

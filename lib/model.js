/**
 * The rule model: trigger/action catalogs (with field metadata the Web editor
 * renders generically) and the normalisation that turns untrusted input into a
 * stored rule.
 *
 * Keeping the field catalog here means the server, the editor and the model
 * tools all describe a trigger the same way.
 *
 * @module dsh-automations/model
 */

import { clampInt, minutesOfDay, newId, nowIso } from "./util.js";

/**
 * @typedef {object} FieldSpec
 * @property {string} key - property name inside the trigger/action object.
 * @property {string} label - Chinese label.
 * @property {string} labelEn - English label.
 * @property {"int"|"text"|"textarea"|"select"|"time"|"weekdays"} type
 * @property {number} [min]
 * @property {number} [max]
 * @property {Array<{value: string, label: string, labelEn: string}>} [options]
 * @property {unknown} [default]
 * @property {string} [placeholder]
 * @property {string} [hint]
 */

/** Every trigger kind, in sidebar/form order. */
export const TRIGGER_CATALOG = [
	{
		type: "startup",
		label: "DSH 启动时",
		labelEn: "On DSH startup",
		hint: "宿主进程启动完成后触发一次（热重载不会重复触发）",
		hintEn: "Fires once after the host process boots (hot reload does not repeat it)",
		fields: [{ key: "delayMs", label: "延迟（毫秒）", labelEn: "Delay (ms)", type: "int", min: 0, max: 600000, default: 1500 }],
	},
	{
		type: "session-start",
		label: "会话开始时",
		labelEn: "On session start",
		hint: "新会话建立、恢复、清理或压缩时",
		hintEn: "When a session is created, resumed, cleared or compacted",
		fields: [
			{
				key: "source",
				label: "来源",
				labelEn: "Source",
				type: "select",
				default: "any",
				options: [
					{ value: "any", label: "任意", labelEn: "Any" },
					{ value: "startup", label: "新建", labelEn: "New session" },
					{ value: "resume", label: "恢复", labelEn: "Resume" },
					{ value: "clear", label: "清空后", labelEn: "After clear" },
					{ value: "compact", label: "压缩后", labelEn: "After compaction" },
				],
			},
		],
	},
	{
		type: "session-idle",
		label: "会话空闲时",
		labelEn: "On session idle",
		hint: "该会话超过设定时间没有新事件",
		hintEn: "A session produced no new event for the configured time",
		fields: [{ key: "idleSeconds", label: "空闲（秒）", labelEn: "Idle (seconds)", type: "int", min: 30, max: 86400, default: 600 }],
	},
	{
		type: "session-end",
		label: "会话结束时",
		labelEn: "On session end",
		hint: "会话被释放或 DSH 退出时",
		hintEn: "When a session is disposed or DSH shuts down",
		fields: [],
	},
	{
		type: "user-message",
		label: "收到用户消息时",
		labelEn: "On user message",
		hint: "可以只在每天/每会话第一条消息触发，或按关键词过滤",
		hintEn: "Optionally only the first message of a day/session, or filtered by text",
		fields: [
			{
				key: "mode",
				label: "条件",
				labelEn: "Condition",
				type: "select",
				default: "any",
				options: [
					{ value: "any", label: "每条消息", labelEn: "Every message" },
					{ value: "first-of-session", label: "每会话第一条", labelEn: "First of session" },
					{ value: "first-of-day", label: "每天第一条", labelEn: "First of day" },
				],
			},
			{ key: "match", label: "包含文本（可空）", labelEn: "Contains text (optional)", type: "text", default: "", placeholder: "例如：日报" },
		],
	},
	{
		type: "tool-after",
		label: "工具执行后",
		labelEn: "After a tool runs",
		hint: "按工具名与成功/失败过滤",
		hintEn: "Filter by tool name and success/failure",
		fields: [
			{ key: "tool", label: "工具名（* 为全部）", labelEn: "Tool name (* for all)", type: "text", default: "*", placeholder: "pwsh" },
			{
				key: "when",
				label: "结果",
				labelEn: "Outcome",
				type: "select",
				default: "always",
				options: [
					{ value: "always", label: "总是", labelEn: "Always" },
					{ value: "success", label: "仅成功", labelEn: "Only success" },
					{ value: "error", label: "仅失败", labelEn: "Only failure" },
				],
			},
		],
	},
	{
		type: "daily",
		label: "每天定时",
		labelEn: "Daily",
		hint: "本地时间；错过的当天窗口会在启动后补跑一次",
		hintEn: "Local time; a missed window is caught up once after startup",
		fields: [
			{ key: "time", label: "时间", labelEn: "Time", type: "time", default: "08:30" },
			{ key: "weekdays", label: "星期（空为每天）", labelEn: "Weekdays (empty = every day)", type: "weekdays", default: [] },
		],
	},
	{
		type: "interval",
		label: "固定间隔",
		labelEn: "Every N minutes",
		hint: "从规则启用后开始计时",
		hintEn: "Counted from the moment the rule becomes active",
		fields: [{ key: "minutes", label: "间隔（分钟）", labelEn: "Interval (minutes)", type: "int", min: 1, max: 1440, default: 60 }],
	},
	{
		type: "manual",
		label: "仅手动",
		labelEn: "Manual only",
		hint: "只在面板/工具里点「运行」时执行",
		hintEn: "Runs only from the panel or the tool",
		fields: [],
	},
];

/** Every action kind, in form order. */
export const ACTION_CATALOG = [
	{
		type: "shell",
		label: "运行命令",
		labelEn: "Run a command",
		hint: "在本机启动一个非交互进程，捕获输出与退出码",
		hintEn: "Spawn a non-interactive local process and capture output/exit code",
		fields: [
			{ key: "command", label: "命令", labelEn: "Command", type: "textarea", default: "", placeholder: "Get-Date | Out-File $env:USERPROFILE\\boot.log -Append", required: true },
			{ key: "cwd", label: "工作目录（可空）", labelEn: "Working directory (optional)", type: "text", default: "", hint: "留空 = 用户主目录；新建规则时会预填默认值", hintEn: "Empty = user home directory; new rules prefill the default" },
			{
				key: "shell",
				label: "解释器",
				labelEn: "Shell",
				type: "select",
				default: "auto",
				options: [
					{ value: "auto", label: "自动", labelEn: "Auto" },
					{ value: "powershell", label: "PowerShell", labelEn: "PowerShell" },
					{ value: "cmd", label: "cmd", labelEn: "cmd" },
					{ value: "bash", label: "bash", labelEn: "bash" },
				],
			},
			{ key: "timeoutMs", label: "超时（毫秒）", labelEn: "Timeout (ms)", type: "int", min: 1000, max: 600000, default: 60000 },
		],
	},
	{
		type: "http",
		label: "发送 HTTP 请求",
		labelEn: "Send an HTTP request",
		hint: "适合 webhook、飞书机器人、本地服务探活",
		hintEn: "Webhooks, chat bots, local health checks",
		fields: [
			{ key: "url", label: "URL", labelEn: "URL", type: "text", default: "", placeholder: "https://example.com/hook", required: true },
			{
				key: "method",
				label: "方法",
				labelEn: "Method",
				type: "select",
				default: "GET",
				options: [
					{ value: "GET", label: "GET", labelEn: "GET" },
					{ value: "POST", label: "POST", labelEn: "POST" },
					{ value: "PUT", label: "PUT", labelEn: "PUT" },
					{ value: "PATCH", label: "PATCH", labelEn: "PATCH" },
					{ value: "DELETE", label: "DELETE", labelEn: "DELETE" },
				],
			},
			{ key: "headers", label: "请求头（JSON）", labelEn: "Headers (JSON)", type: "textarea", default: "{}", placeholder: "{\"content-type\":\"application/json\"}" },
			{ key: "body", label: "请求体（可空）", labelEn: "Body (optional)", type: "textarea", default: "", placeholder: "{\"text\":\"DSH started\"}" },
			{ key: "timeoutMs", label: "超时（毫秒）", labelEn: "Timeout (ms)", type: "int", min: 1000, max: 300000, default: 30000 },
		],
	},
	{
		type: "log",
		label: "写入运行记录",
		labelEn: "Write a run-log entry",
		hint: "不产生副作用，适合验证时机是否命中",
		hintEn: "Side-effect free; useful to verify a trigger fires",
		fields: [{ key: "message", label: "内容", labelEn: "Message", type: "textarea", default: "", placeholder: "DSH 已启动" }],
	},
];

/** Trigger types accepted in stored rules. */
export const TRIGGER_TYPES = TRIGGER_CATALOG.map((entry) => entry.type);
/** Action types accepted in stored rules. */
export const ACTION_TYPES = ACTION_CATALOG.map((entry) => entry.type);

/**
 * @param {string} type - trigger type.
 * @returns {object | undefined}
 */
function triggerSpec(type) {
	return TRIGGER_CATALOG.find((entry) => entry.type === type);
}

/**
 * @param {string} type - action type.
 * @returns {object | undefined}
 */
function actionSpec(type) {
	return ACTION_CATALOG.find((entry) => entry.type === type);
}

/**
 * A `RuleError` carries a stable code so tools and the HTTP layer can report it.
 */
export class RuleError extends Error {
	/**
	 * @param {string} code - stable machine code.
	 * @param {string} message - human message.
	 */
	constructor(code, message) {
		super(message);
		this.name = "RuleError";
		this.code = code;
	}
}

/**
 * Coerce one catalog field value.
 *
 * @param {FieldSpec} field - field spec.
 * @param {unknown} raw - raw value.
 * @returns {unknown} the coerced value.
 */
function coerceField(field, raw) {
	if (field.type === "int") {
		const value = clampInt(raw, field.min ?? Number.MIN_SAFE_INTEGER, field.max ?? Number.MAX_SAFE_INTEGER, field.default);
		return value;
	}
	if (field.type === "select") {
		const allowed = (field.options ?? []).map((option) => option.value);
		return typeof raw === "string" && allowed.includes(raw) ? raw : field.default;
	}
	if (field.type === "weekdays") {
		if (!Array.isArray(raw)) return [];
		const days = raw
			.map((value) => Number(value))
			.filter((value) => Number.isSafeInteger(value) && value >= 1 && value <= 7);
		return [...new Set(days)].sort((a, b) => a - b);
	}
	if (field.type === "time") {
		return typeof raw === "string" && minutesOfDay(raw) !== null ? raw.trim() : field.default;
	}
	return typeof raw === "string" ? raw : field.default ?? "";
}

/**
 * Normalise a trigger object against its catalog entry.
 *
 * @param {unknown} raw - untrusted trigger.
 * @param {string} [fallbackType] - type used when `raw.type` is absent.
 * @returns {{type: string} & Record<string, unknown>}
 * @throws {RuleError} on an unknown type.
 */
export function normalizeTrigger(raw, fallbackType = "startup") {
	const source = raw !== null && typeof raw === "object" ? raw : {};
	const type = typeof source.type === "string" && source.type !== "" ? source.type : fallbackType;
	const spec = triggerSpec(type);
	if (spec === undefined) throw new RuleError("invalid_trigger", `未知的触发时机：${type}`);
	const result = { type };
	for (const field of spec.fields) result[field.key] = coerceField(field, source[field.key]);
	return result;
}

/**
 * Normalise an action object against its catalog entry.
 *
 * @param {unknown} raw - untrusted action.
 * @returns {{type: string} & Record<string, unknown>}
 * @throws {RuleError} on an unknown type or missing required text.
 */
export function normalizeAction(raw) {
	const source = raw !== null && typeof raw === "object" ? raw : {};
	const type = typeof source.type === "string" && source.type !== "" ? source.type : "log";
	const spec = actionSpec(type);
	if (spec === undefined) throw new RuleError("invalid_action", `未知的动作类型：${type}`);
	const result = { type };
	for (const field of spec.fields) result[field.key] = coerceField(field, source[field.key]);
	for (const field of spec.fields) {
		if (field.required === true && String(result[field.key] ?? "").trim() === "") {
			throw new RuleError("invalid_action", `${spec.label}缺少必填项：${field.label}`);
		}
	}
	if (type === "http") {
		try {
			new URL(String(result.url));
		} catch {
			throw new RuleError("invalid_action", "HTTP 动作的 URL 不合法");
		}
		const headers = String(result.headers ?? "{}").trim();
		if (headers !== "") {
			try {
				const parsed = JSON.parse(headers);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
			} catch {
				throw new RuleError("invalid_action", "请求头必须是 JSON 对象，例如 {\"a\":\"b\"}");
			}
		}
	}
	return result;
}

/**
 * Normalise a whole rule, preserving identity and timestamps when known.
 *
 * @param {unknown} raw - untrusted rule.
 * @param {{previous?: object | null}} [options] - the rule being replaced, if any.
 * @returns {object} the stored rule.
 * @throws {RuleError} on invalid input.
 */
export function normalizeRule(raw, options = {}) {
	const source = raw !== null && typeof raw === "object" ? raw : {};
	const previous = options.previous ?? null;
	const name = String(source.name ?? "").trim() || (previous?.name ?? "未命名任务");
	const id = String(source.id ?? previous?.id ?? "").trim() || newId("rule");
	if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) throw new RuleError("invalid_id", "规则 id 只能包含字母、数字、点、下划线、冒号和连字符");
	const trigger = normalizeTrigger(source.trigger, previous?.trigger?.type ?? "startup");
	const action = normalizeAction(source.action ?? previous?.action);
	const cooldownSeconds = clampInt(source.cooldownSeconds ?? previous?.cooldownSeconds, 0, 86400, 0);
	const stamp = nowIso();
	return {
		id,
		name,
		enabled: source.enabled === undefined ? (previous?.enabled ?? true) : source.enabled !== false,
		trigger,
		action,
		cooldownSeconds,
		createdAt: previous?.createdAt ?? source.createdAt ?? stamp,
		updatedAt: stamp,
		runCount: Number.isSafeInteger(previous?.runCount) ? previous.runCount : 0,
		lastRun: previous?.lastRun ?? null,
	};
}

/**
 * Chinese summary of a trigger.
 *
 * @param {object} trigger - stored trigger.
 * @param {"zh"|"en"} [lang] - output language.
 * @returns {string}
 */
export function summarizeTrigger(trigger, lang = "zh") {
	const t = trigger ?? {};
	const zh = lang === "zh";
	switch (t.type) {
		case "startup":
			return zh ? `DSH 启动 · 延迟 ${t.delayMs}ms` : `On startup · +${t.delayMs}ms`;
		case "session-start": {
			const map = { any: zh ? "任意来源" : "any source", startup: zh ? "新建" : "new", resume: zh ? "恢复" : "resume", clear: zh ? "清空后" : "after clear", compact: zh ? "压缩后" : "after compaction" };
			return zh ? `会话开始 · ${map[t.source] ?? t.source}` : `Session start · ${map[t.source] ?? t.source}`;
		}
		case "session-idle":
			return zh ? `会话空闲 ${t.idleSeconds}s` : `Session idle for ${t.idleSeconds}s`;
		case "session-end":
			return zh ? "会话结束 / DSH 退出" : "Session end / DSH exit";
		case "user-message": {
			const mode = t.mode === "first-of-day" ? (zh ? "每天第一条" : "first of day") : t.mode === "first-of-session" ? (zh ? "每会话第一条" : "first of session") : zh ? "每条消息" : "every message";
			const match = t.match ? ` · “${t.match}”` : "";
			return zh ? `用户消息 · ${mode}${match}` : `User message · ${mode}${match}`;
		}
		case "tool-after":
			return zh ? `工具 ${t.tool || "*"} 之后 · ${t.when}` : `After tool ${t.tool || "*"} · ${t.when}`;
		case "daily": {
			const days = Array.isArray(t.weekdays) && t.weekdays.length > 0 ? ` · ${t.weekdays.join(",")}` : "";
			return zh ? `每天 ${t.time}${days}` : `Daily ${t.time}${days}`;
		}
		case "interval":
			return zh ? `每 ${t.minutes} 分钟` : `Every ${t.minutes} min`;
		case "manual":
			return zh ? "仅手动" : "Manual only";
		default:
			return t.type ?? "";
	}
}

/**
 * Chinese summary of an action.
 *
 * @param {object} action - stored action.
 * @param {"zh"|"en"} [lang] - output language.
 * @returns {string}
 */
export function summarizeAction(action, lang = "zh") {
	const a = action ?? {};
	const zh = lang === "zh";
	if (a.type === "shell") {
		const command = String(a.command ?? "").trim().split(/\r?\n/)[0] ?? "";
		const short = command.length > 80 ? `${command.slice(0, 77)}…` : command;
		return zh ? `命令：${short || "（空）"}` : `Command: ${short || "(empty)"}`;
	}
	if (a.type === "http") return `${a.method ?? "GET"} ${String(a.url ?? "").slice(0, 90)}`;
	if (a.type === "log") {
		const message = String(a.message ?? "");
		return zh ? `记录：${message.length > 80 ? `${message.slice(0, 77)}…` : message}` : `Log: ${message}`;
	}
	return a.type ?? "";
}

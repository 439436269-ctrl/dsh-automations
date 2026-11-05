/**
 * The plugin's small JSON API, consumed by the sidebar panel.
 *
 * Routes are registered through `ctx.connection.fetch`, the host's
 * authenticated `/api` bridge: the composition has already checked the session
 * cookie and the Host/Origin fence before a handler runs, so this module only
 * parses bodies, maps errors and answers with plain `Response` objects.
 *
 * @module dsh-automations/http
 */

import { ACTION_CATALOG, normalizeRule, RuleError, summarizeAction, summarizeTrigger, TRIGGER_CATALOG } from "./model.js";
import { localDay } from "./util.js";
import { VERSION } from "./version.js";

/** Route prefix shared by every endpoint. */
const BASE = "/api/dsh-automations";

/** Request body ceiling (a rule is tiny; this only stops abuse). */
const MAX_BODY = 1_000_000;

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/**
 * @param {unknown} body - JSON payload.
 * @param {number} status - status code.
 * @returns {Response}
 */
function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

/**
 * Read one already-buffered JSON body.
 *
 * @param {Request} request - bridge request.
 * @returns {Promise<object>}
 */
async function readJsonBody(request) {
	const text = (await request.text()).trim();
	if (text === "") return {};
	if (text.length > MAX_BODY) throw new RuleError("body_too_large", "请求体太大");
	const parsed = JSON.parse(text);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new RuleError("bad_body", "请求体必须是 JSON 对象");
	return parsed;
}

/**
 * Build the panel view.
 *
 * @param {{store: object, engine: {busy: Function}, hub: {bootedAt: string}}} parts - live pieces.
 * @returns {object}
 */
export function buildView({ store, engine, hub }) {
	const rules = store.list().map((rule) => ({
		...rule,
		triggerSummary: summarizeTrigger(rule.trigger, "zh"),
		triggerSummaryEn: summarizeTrigger(rule.trigger, "en"),
		actionSummary: summarizeAction(rule.action, "zh"),
		actionSummaryEn: summarizeAction(rule.action, "en"),
	}));
	const runs = store.listRuns(40);
	const today = localDay(new Date());
	return {
		version: VERSION,
		now: new Date().toISOString(),
		bootedAt: hub.bootedAt,
		stateDir: store.dir,
		rules,
		runs,
		stats: {
			total: rules.length,
			enabled: rules.filter((rule) => rule.enabled !== false).length,
			runsToday: runs.filter((run) => {
				const at = Date.parse(run.at ?? "");
				return Number.isFinite(at) && localDay(new Date(at)) === today;
			}).length,
			lastRunAt: runs[0]?.at ?? null,
			busy: engine.busy(),
		},
		catalog: { triggers: TRIGGER_CATALOG, actions: ACTION_CATALOG },
	};
}

/**
 * Register every route on the authenticated API bridge.
 *
 * @param {{ctx: object, store: object, engine: object, hub: object, log: object}} options
 * @returns {() => void} disposer for all routes.
 */
export function registerRoutes({ ctx, store, engine, hub, log }) {
	const bridge = ctx.get("connection")?.fetch;
	if (bridge === undefined || typeof bridge.register !== "function") {
		log?.warn?.("[dsh-automations] connection.fetch unavailable; panel API disabled");
		return () => {};
	}
	const disposers = [];

	/**
	 * Register one endpoint.
	 *
	 * @param {string} path - absolute path under `/api`.
	 * @param {string[]} methods - accepted methods.
	 * @param {(body: object, request: Request) => Promise<{status?: number, body: unknown}>} handler - business logic.
	 */
	const route = (path, methods, handler) => {
		const dispose = bridge.register({
			path,
			methods,
			requestBody: "buffered",
			fetch: async (request) => {
				try {
					const body = (request.method ?? "GET").toUpperCase() === "GET" ? {} : await readJsonBody(request);
					const result = await handler(body, request);
					return json({ ok: true, value: result.body }, result.status ?? 200);
				} catch (error) {
					if (error instanceof RuleError) return json({ ok: false, error: { code: error.code, message: error.message } }, 400);
					if (error instanceof SyntaxError) return json({ ok: false, error: { code: "bad_json", message: "请求体不是合法 JSON" } }, 400);
					const message = error instanceof Error ? error.message : String(error);
					log?.warn?.(`[dsh-automations] api ${path}: ${message}`);
					return json({ ok: false, error: { code: "internal", message } }, 500);
				}
			},
		});
		if (typeof dispose === "function") disposers.push(dispose);
	};

	const view = () => buildView({ store, engine, hub });

	route(`${BASE}/state`, ["GET"], async () => ({ body: view() }));

	route(`${BASE}/rules`, ["POST"], async (body) => {
		const rule = store.upsert(body.rule ?? body);
		return { body: { rule, state: view() } };
	});

	route(`${BASE}/rules/delete`, ["POST"], async (body) => {
		const id = String(body.id ?? "");
		const removed = store.remove(id);
		return { body: { removed, id, state: view() } };
	});

	route(`${BASE}/rules/toggle`, ["POST"], async (body) => {
		const id = String(body.id ?? "");
		const rule = store.setEnabled(id, body.enabled !== false);
		if (rule === undefined) throw new RuleError("rule_not_found", `规则不存在：${id}`);
		return { body: { rule, state: view() } };
	});

	route(`${BASE}/run`, ["POST"], async (body) => {
		const id = String(body.id ?? "");
		const rule = store.get(id);
		if (rule === undefined) throw new RuleError("rule_not_found", `规则不存在：${id}`);
		const run = await engine.submit(rule, { kind: "manual" }, { force: true });
		return { body: { run, state: view() } };
	});

	route(`${BASE}/test`, ["POST"], async (body) => {
		const draft = normalizeRule({ ...(body.rule ?? {}), id: "draft", enabled: true }, { previous: null });
		const run = await engine.submit(draft, { kind: "manual", draft: true }, { force: true, draft: true });
		return { body: { run } };
	});

	route(`${BASE}/runs`, ["GET"], async (body, request) => {
		const url = new URL(request.url, "http://localhost");
		const limit = Number(url.searchParams.get("limit") ?? 40);
		return { body: { runs: store.listRuns(Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit)) : 40) } };
	});

	return () => {
		for (const dispose of disposers.splice(0)) {
			try {
				dispose();
			} catch {
				/* already withdrawn */
			}
		}
	};
}

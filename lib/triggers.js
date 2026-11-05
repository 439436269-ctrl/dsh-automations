/**
 * Trigger wiring: turn host events into rule executions.
 *
 * Lifecycle triggers (`startup`, `session-start`, `session-idle`,
 * `session-end`) come from agents; content triggers (`user-message`,
 * `tool-after`) come from session/tool feeds; clock triggers (`daily`,
 * `interval`) are evaluated by one low-frequency tick so a rule edit never
 * leaves a stale timer behind.
 *
 * @module dsh-automations/triggers
 */

import { isoWeekday, localDay, minutesOfDay, textOfContent } from "./util.js";

/** How late a missed daily window may still be caught up (minutes). */
const DAILY_CATCHUP_MINUTES = 240;

/**
 * Create the trigger hub.
 *
 * @param {{ctx: object, settings: object, store: object, engine: {submit: Function}, log: {warn: Function}}} options
 * @returns {{start: () => void, stop: () => void, bootedAt: string}}
 */
export function createTriggerHub({ ctx, settings, store, engine, log }) {
	/** @type {Map<string, NodeJS.Timeout>} `sessionId::ruleId` → idle timer. */
	const idleTimers = new Map();
	/** Sessions that already produced their first user message. */
	const firstOfSession = new Set();
	/** Current turn number per session, learned from `turn/start`. */
	const turnOf = new Map();
	/** Turn whose user message already fired, so one turn cannot fire twice. */
	const firedTurn = new Map();
	/** Last user-message seq per session, guarding against duplicate dispatch. */
	const lastUserSeq = new Map();
	/** @type {NodeJS.Timeout | null} */
	let tickTimer = null;
	/** @type {NodeJS.Timeout[]} */
	const startupTimers = [];
	/** @type {Array<() => void>} */
	const disposers = [];
	const bootAt = globalThis.__dshAutomationsBootAt === undefined
		? new Date().toISOString()
		: globalThis.__dshAutomationsBootAt;
	let started = false;

	const meta = store.meta();

	/**
	 * @param {unknown} error - failure to report.
	 */
	function warn(error) {
		log?.warn?.(`[dsh-automations] trigger: ${error instanceof Error ? error.message : String(error)}`);
	}

	/**
	 * @param {string} type - trigger type.
	 * @returns {Array<object>} enabled rules of that type.
	 */
	function rulesOf(type) {
		return store.list().filter((rule) => rule.enabled !== false && rule.trigger?.type === type);
	}

	/**
	 * Run one rule.
	 *
	 * @param {object} rule - stored rule.
	 * @param {object} context - trigger context.
	 */
	function fire(rule, context) {
		void engine.submit(rule, context).catch(warn);
	}

	/**
	 * Clear every idle timer owned by one session.
	 *
	 * @param {string} sessionId - session to clear.
	 */
	function clearIdle(sessionId) {
		const prefix = `${sessionId}::`;
		for (const [key, timer] of idleTimers) {
			if (key.startsWith(prefix)) {
				clearTimeout(timer);
				idleTimers.delete(key);
			}
		}
	}

	/**
	 * (Re)arm one timer per idle rule for a session.
	 *
	 * @param {string} sessionId - session to arm.
	 */
	function armIdle(sessionId) {
		if (typeof sessionId !== "string" || sessionId === "") return;
		clearIdle(sessionId);
		for (const rule of rulesOf("session-idle")) {
			const seconds = Math.max(30, Number(rule.trigger.idleSeconds) || 600);
			const key = `${sessionId}::${rule.id}`;
			const timer = setTimeout(() => {
				idleTimers.delete(key);
				fire(rule, { kind: "session-idle", sessionId, idleSeconds: seconds });
			}, seconds * 1000);
			timer.unref?.();
			idleTimers.set(key, timer);
		}
	}

	/**
	 * Evaluate clock triggers once.
	 */
	function tick() {
		const now = new Date();
		const dayKey = localDay(now);
		const minuteOfDay = now.getHours() * 60 + now.getMinutes();

		for (const rule of rulesOf("daily")) {
			const target = minutesOfDay(rule.trigger.time);
			if (target === null) continue;
			const weekdays = Array.isArray(rule.trigger.weekdays) ? rule.trigger.weekdays : [];
			if (weekdays.length > 0 && !weekdays.includes(isoWeekday(now))) continue;
			meta.lastFired ??= {};
			if (meta.lastFired[rule.id] === dayKey) continue;
			const late = minuteOfDay - target;
			if (late < 0 || late > DAILY_CATCHUP_MINUTES) continue;
			meta.lastFired[rule.id] = dayKey;
			store.touchMeta();
			fire(rule, { kind: "daily", time: rule.trigger.time, day: dayKey });
		}

		meta.lastIntervalAt ??= {};
		const nowMs = now.getTime();
		for (const rule of rulesOf("interval")) {
			const minutes = Math.max(1, Number(rule.trigger.minutes) || 60);
			const last = Number(meta.lastIntervalAt[rule.id] ?? 0);
			if (!Number.isFinite(last) || last <= 0) {
				meta.lastIntervalAt[rule.id] = nowMs;
				store.touchMeta();
				continue;
			}
			if (nowMs - last >= minutes * 60_000) {
				meta.lastIntervalAt[rule.id] = nowMs;
				store.touchMeta();
				fire(rule, { kind: "interval", minutes });
			}
		}
	}

	return {
		bootedAt: bootAt,

		/** Subscribe to host events and arm clock triggers. */
		start() {
			if (started) return;
			started = true;
			const firstBoot = globalThis.__dshAutomationsBootAt === undefined;
			globalThis.__dshAutomationsBootAt = bootAt;
			meta.bootedAt = bootAt;
			store.touchMeta();

			const on = (name, listener) => {
				try {
					const dispose = ctx.on(name, listener);
					if (typeof dispose === "function") disposers.push(dispose);
				} catch (error) {
					warn(error);
				}
			};

			on("agent/created", (payload) => {
				const sessionId = payload?.agent?.id ?? payload?.agent?.session?.header?.id ?? payload?.agent?.session?.id;
				if (typeof sessionId !== "string") return;
				armIdle(sessionId);
				const source = payload?.source ?? "startup";
				for (const rule of rulesOf("session-start")) {
					const wanted = rule.trigger.source ?? "any";
					if (wanted === "any" || wanted === source) fire(rule, { kind: "session-start", sessionId, source });
				}
			});

			on("session/event", (session, event) => {
				const sessionId = session?.id ?? session?.header?.id;
				if (typeof sessionId === "string") armIdle(sessionId);

				// One user turn produces several `user/message` events (the
				// message plus its contexts). Fire once per turn, and never twice
				// for the same seq.
				if (event?.type === "turn/start") {
					const next = Number(event?.data?.turn);
					if (Number.isSafeInteger(next)) {
						// A message seen just before this turn belongs to it.
						if (firedTurn.get(sessionId) === next - 1) firedTurn.set(sessionId, next);
						turnOf.set(sessionId, next);
					}
					return;
				}
				if (event?.type !== "user/message") return;
				const seq = event?.seq;
				if (Number.isSafeInteger(seq)) {
					if (lastUserSeq.get(sessionId) === seq) return;
					lastUserSeq.set(sessionId, seq);
				}
				const turn = turnOf.get(sessionId) ?? 0;
				if (firedTurn.get(sessionId) === turn) return;
				const text = textOfContent(event?.data?.content);
				const dayKey = localDay(new Date());
				let fired = false;
				for (const rule of rulesOf("user-message")) {
					const mode = rule.trigger.mode ?? "any";
					const needle = String(rule.trigger.match ?? "").trim();
					if (needle !== "" && !text.toLowerCase().includes(needle.toLowerCase())) continue;
					if (mode === "first-of-session" && firstOfSession.has(sessionId)) continue;
					if (mode === "first-of-day") {
						meta.lastFired ??= {};
						if (meta.lastFired[rule.id] === dayKey) continue;
						meta.lastFired[rule.id] = dayKey;
						store.touchMeta();
					}
					fire(rule, { kind: "user-message", sessionId, mode, text: text.slice(0, 200) });
					fired = true;
				}
				if (fired || rulesOf("user-message").length > 0) firedTurn.set(sessionId, turn);
				firstOfSession.add(sessionId);
			});

			on("agent/turn-stopping", (payload) => {
				const sessionId = payload?.agent?.id ?? payload?.agent?.session?.header?.id ?? payload?.agent?.session?.id;
				if (typeof sessionId === "string") armIdle(sessionId);
			});

			on("agent/disposed", (payload) => {
				const sessionId = payload?.agent?.id ?? payload?.agent?.session?.header?.id ?? payload?.agent?.session?.id;
				if (typeof sessionId === "string") {
					clearIdle(sessionId);
					firstOfSession.delete(sessionId);
					turnOf.delete(sessionId);
					firedTurn.delete(sessionId);
					lastUserSeq.delete(sessionId);
				}
				for (const rule of rulesOf("session-end")) fire(rule, { kind: "session-end", sessionId: sessionId ?? null });
			});

			on("tools/result", (exec, result) => {
				const name = String(exec?.name ?? "");
				const isError = result?.isError === true;
				const sessionId = exec?.agent?.id;
				for (const rule of rulesOf("tool-after")) {
					const wantedTool = String(rule.trigger.tool ?? "*").trim() || "*";
					if (wantedTool !== "*" && wantedTool.toLowerCase() !== name.toLowerCase()) continue;
					const when = rule.trigger.when ?? "always";
					if (when === "success" && isError) continue;
					if (when === "error" && !isError) continue;
					fire(rule, { kind: "tool-after", sessionId: sessionId ?? null, tool: name, isError });
				}
			});

			if (firstBoot) {
				for (const rule of rulesOf("startup")) {
					const delay = Math.max(0, Number(rule.trigger.delayMs) || 0);
					const timer = setTimeout(() => {
						fire(rule, { kind: "startup", delayMs: delay });
					}, settings.startupDelayMs + delay);
					timer.unref?.();
					startupTimers.push(timer);
				}
			}

			tickTimer = setInterval(tick, Math.max(5, settings.tickSeconds) * 1000);
			tickTimer.unref?.();
			tick();
		},

		/** Release every timer and subscription. */
		stop() {
			started = false;
			for (const timer of startupTimers) clearTimeout(timer);
			startupTimers.length = 0;
			if (tickTimer !== null) {
				clearInterval(tickTimer);
				tickTimer = null;
			}
			for (const timer of idleTimers.values()) clearTimeout(timer);
			idleTimers.clear();
			firstOfSession.clear();
			turnOf.clear();
			firedTurn.clear();
			lastUserSeq.clear();
			for (const dispose of disposers.splice(0)) {
				try {
					dispose();
				} catch {
					/* already gone */
				}
			}
		},
	};
}

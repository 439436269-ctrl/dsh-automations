/**
 * Settings without the schema dependency: defaults plus the resolver. Kept
 * separate from `config.js` so tests can resolve settings without a live DSH
 * install (the schema module is only needed for the loader).
 *
 * @module dsh-automations/settings
 */

/** Code-side defaults, mirrored by the `Config` schema in `./config.js`. */
export const DEFAULTS = Object.freeze({
	enabled: true,
	stateDir: "",
	maxRunHistory: 200,
	maxOutputChars: 8000,
	defaultTimeoutMs: 120000,
	startupDelayMs: 2000,
	tickSeconds: 15,
	promptEnabled: true,
	promptOrder: 62,
});

/**
 * A safe positive integer, or `fallback`.
 *
 * @param value - raw value.
 * @param fallback - value used when the input is not a positive safe integer.
 * @returns the resolved integer.
 */
function positiveInteger(value, fallback) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

/**
 * Resolve user configuration into the plain settings object the plugin uses.
 *
 * @param raw - the loader-supplied config (possibly undefined).
 * @returns resolved settings.
 */
export function resolveConfig(raw) {
	const config = raw === null || typeof raw !== "object" ? {} : raw;
	const startupDelay = Number(config.startupDelayMs);
	return {
		enabled: config.enabled !== false,
		stateDir: typeof config.stateDir === "string" ? config.stateDir.trim() : "",
		maxRunHistory: positiveInteger(config.maxRunHistory, DEFAULTS.maxRunHistory),
		maxOutputChars: positiveInteger(config.maxOutputChars, DEFAULTS.maxOutputChars),
		defaultTimeoutMs: positiveInteger(config.defaultTimeoutMs, DEFAULTS.defaultTimeoutMs),
		startupDelayMs: Number.isSafeInteger(startupDelay) && startupDelay >= 0 ? startupDelay : DEFAULTS.startupDelayMs,
		tickSeconds: positiveInteger(config.tickSeconds, DEFAULTS.tickSeconds),
		promptEnabled: config.promptEnabled !== false,
		promptOrder: Number.isSafeInteger(Number(config.promptOrder)) ? Number(config.promptOrder) : DEFAULTS.promptOrder,
	};
}

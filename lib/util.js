/**
 * Small shared helpers: ids, clocks, text extraction and bounded strings.
 *
 * @module dsh-automations/util
 */

import { randomBytes } from "node:crypto";

/**
 * A compact, sortable, collision-resistant id.
 *
 * @param prefix - namespace prefix (`rule` / `run`).
 * @returns the id.
 */
export function newId(prefix) {
	const stamp = Date.now().toString(36);
	const salt = randomBytes(3).toString("hex");
	return `${prefix}-${stamp}-${salt}`;
}

/** @returns the current instant as an ISO string. */
export function nowIso() {
	return new Date().toISOString();
}

/**
 * Clamp an integer into `[min, max]`, falling back when not an integer.
 *
 * @param value - raw value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @param fallback - value used when `value` is not a safe integer.
 * @returns the bounded integer.
 */
export function clampInt(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isSafeInteger(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

/**
 * Keep at most `max` characters, preferring the tail (logs end with the reason).
 *
 * @param text - raw text.
 * @param max - character budget.
 * @returns the bounded text.
 */
export function tailText(text, max) {
	const value = typeof text === "string" ? text : String(text ?? "");
	if (value.length <= max) return value;
	return `…(${value.length - max} chars trimmed)…\n${value.slice(value.length - max)}`;
}

/**
 * Flatten a message content array into plain text.
 *
 * @param content - content blocks (`{type:'text', text}` and friends).
 * @returns the concatenated text, or "".
 */
export function textOfContent(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n").trim();
}

/**
 * Local calendar day (`YYYY-MM-DD`) for a Date.
 *
 * @param date - the instant.
 * @returns the local day key.
 */
export function localDay(date) {
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Minutes since local midnight for `HH:MM`.
 *
 * @param time - `HH:MM` string.
 * @returns minutes, or null when malformed.
 */
export function minutesOfDay(time) {
	const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
	if (match === null) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/**
 * ISO weekday (Monday 1 … Sunday 7).
 *
 * @param date - the instant.
 * @returns the ISO weekday.
 */
export function isoWeekday(date) {
	const day = date.getDay();
	return day === 0 ? 7 : day;
}

/**
 * Human-readable duration for a millisecond span.
 *
 * @param ms - duration.
 * @returns e.g. `820ms`, `1.4s`, `3m 02s`.
 */
export function humanDuration(ms) {
	const value = Math.max(0, Number(ms) || 0);
	if (value < 1000) return `${Math.round(value)}ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
	const minutes = Math.floor(value / 60_000);
	const seconds = Math.round((value % 60_000) / 1000);
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// What tools read from a page in the browser: the result that the engine's hold mode publishes on
// the window, other values that a page publishes, and the errors and warnings that the page logs.

/** @import { ConsoleMessage, JSHandle, Page } from 'playwright-core' */
/** @import { RgbaImage } from './png.js' */

/**
 * The GPU tiers that the `?gpu=` switch forces: core WebGPU, WebGPU in compatibility mode, and
 * WebGL2.
 *
 * @type {readonly ['webgpu', 'compat', 'webgl2']}
 */
export const TIERS = ['webgpu', 'compat', 'webgl2'];

/** @typedef {(typeof TIERS)[number]} Tier */

/**
 * The tier that the engine reports for each value of the `?gpu=` switch.
 *
 * @type {Readonly<Record<Tier, string>>}
 */
export const REPORTED_TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' };

/** The global that hold mode publishes its result in. */
export const HOLD_RESULT = '__null3dHold';

/**
 * Hold mode's result as a tool reads it: the engine's own, with the pixels as base64.
 *
 * @typedef {HeldReport | HoldFailure} HoldReport
 * @typedef {{ ok: true, time: number, frame: number, tier: string, width: number, height: number, pixels: string }} HeldReport
 * @typedef {{ ok: false, code: string | null, error: string }} HoldFailure
 */

/**
 * The image of a held frame, with its pixels as bytes.
 *
 * @param {HeldReport} held
 * @returns {RgbaImage}
 */
export const heldImage = ({ width, height, pixels }) => ({
	width,
	height,
	data: new Uint8Array(Buffer.from(pixels, 'base64')),
});

/**
 * A page's path with hold mode's switches: the sketch time to hold at, or without a time a bare
 * switch, which holds at the page's own hold time or at 0. `gpu` forces a GPU tier.
 *
 * @param {string} path
 * @param {{ time?: number, gpu?: Tier }} switches
 */
export function holdPath(path, { time, gpu } = {}) {
	const url = new URL(path, 'http://localhost');
	url.searchParams.set('hold', time === undefined ? '' : String(time));
	if (gpu !== undefined) url.searchParams.set('gpu', gpu);
	return `${url.pathname}${url.search}`;
}

/**
 * Waits until the page's window holds a value under `name`, and returns a handle to it.
 *
 * @param {Page} page
 * @param {string} name
 * @param {number} timeoutMs
 * @returns {Promise<JSHandle>}
 */
export function waitForWindowValue(page, name, timeoutMs) {
	return page.waitForFunction(
		(key) => /** @type {Record<string, unknown>} */ (globalThis)[key],
		name,
		{ timeout: timeoutMs },
	);
}

/**
 * Waits until the page's window holds a value under `name`, and returns it.
 *
 * @template T
 * @param {Page} page
 * @param {string} name
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
export async function windowValue(page, name, timeoutMs) {
	return /** @type {T} */ (await (await waitForWindowValue(page, name, timeoutMs)).jsonValue());
}

/**
 * Runs in the page: whether the engine has started a hold, and hold mode's result once the engine
 * has published it, with the pixels as base64. A start in hold mode sets the global at once, and
 * the result replaces it when the hold ends.
 *
 * @param {string} name The global of hold mode's result.
 * @returns {{ started: boolean, report?: HoldReport }}
 */
function holdState(name) {
	const started = name in globalThis;
	const value = /** @type {Record<string, unknown>} */ (globalThis)[name];
	const result = /** @type {Record<string, unknown> | undefined} */ (value);
	if (!result) return { started };
	if (!(result.pixels instanceof Uint8Array))
		return { started, report: /** @type {HoldReport} */ (result) };
	const { pixels } = result;
	let binary = '';
	for (let i = 0; i < pixels.length; i += 0x8000)
		binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
	return { started, report: /** @type {HoldReport} */ ({ ...result, pixels: btoa(binary) }) };
}

/**
 * Whether the page has started the engine in hold mode, and hold mode's result once it exists.
 *
 * @param {Page} page
 */
export function readHold(page) {
	return page.evaluate(holdState, HOLD_RESULT);
}

/**
 * Waits until the engine publishes hold mode's result on the page, and returns it with the pixels
 * as base64. Throws when the time runs out.
 *
 * @param {Page} page
 * @param {number} timeoutMs
 * @returns {Promise<HoldReport>}
 */
export async function holdResult(page, timeoutMs) {
	await waitForWindowValue(page, HOLD_RESULT, timeoutMs);
	return /** @type {HoldReport} */ ((await readHold(page)).report);
}

/**
 * Where a stack's first frame points, as a path on the page's server with its line and column.
 *
 * @param {string | undefined} stack
 */
function stackPlace(stack) {
	const match = /\((https?:\/\/[^\s)]+):(\d+):(\d+)\)|at (https?:\/\/\S+):(\d+):(\d+)/.exec(
		stack ?? '',
	);
	if (!match) return '';
	const [url, line, column] = match[1] ? match.slice(1, 4) : match.slice(4, 7);
	return ` (at ${new URL(/** @type {string} */ (url)).pathname}:${line}:${column})`;
}

/**
 * What a page reports while it runs: its uncaught errors with the place they came from, its
 * console errors, and its console warnings. `onError` hears each error as it comes.
 *
 * @param {Page} page
 * @param {() => void} [onError]
 */
export function watchConsole(page, onError) {
	/** @type {{ errors: string[], warnings: string[] }} */
	const log = { errors: [], warnings: [] };
	page.on('pageerror', (error) => {
		log.errors.push(`page error: ${error.message}${stackPlace(error.stack)}`);
		onError?.();
	});
	page.on('console', (/** @type {ConsoleMessage} */ message) => {
		const type = message.type();
		if (type === 'warning') log.warnings.push(`console warning: ${message.text()}`);
		// The browser asks for a site icon by itself, and a page need not have one.
		if (type !== 'error' || message.location().url.endsWith('/favicon.ico')) return;
		log.errors.push(`console error: ${message.text()}`);
		onError?.();
	});
	return log;
}

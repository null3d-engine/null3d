// The start data that a page gives its sketch: plain JSON data, which travels to the sketch's thread
// as one string in the start message and which a recording keeps as the same text. The sketch's
// thread parses the text once, so the sketch gets its own copy on every thread.

import { EngineError } from '../errors/engine-error';

/** The most bytes that the start data takes as JSON text, in UTF-8. */
export const MAX_SKETCH_DATA_BYTES = 65_536;

/**
 * The JSON text of `data`, or undefined for no data. Plain objects, arrays, strings, finite numbers,
 * booleans and null pass, and a property whose value is undefined is left out, as JSON leaves it.
 * Any other value fails with E1213, which names where it sits: JSON would change it or drop it, so
 * the sketch and a replay would see other data than the page gave.
 */
export function sketchDataText(data: unknown): string | undefined {
	if (data === undefined) return undefined;
	checkValue(data, 'sketchData', new Set());
	const text = JSON.stringify(data);
	const bytes = new TextEncoder().encode(text).length;
	if (bytes > MAX_SKETCH_DATA_BYTES)
		throw new EngineError(
			'E1213',
			`createEngine() got sketchData of ${bytes.toLocaleString('en')} bytes as JSON, over the limit of ${MAX_SKETCH_DATA_BYTES.toLocaleString('en')}. Pass a small start state, and load larger data in the sketch as a file.`,
		);
	return text;
}

/** Throws E1213 when `value`, at `path` in the data, is not plain JSON data. */
function checkValue(value: unknown, path: string, parents: Set<object>): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return;
		refuse(path, String(value));
	}
	if (typeof value !== 'object') refuse(path, `a ${typeof value}`);
	if (parents.has(value)) refuse(path, 'an object that holds it');
	parents.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) {
			const item: unknown = value[index];
			if (item === undefined) refuse(`${path}[${index}]`, 'undefined');
			checkValue(item, `${path}[${index}]`, parents);
		}
	} else {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null)
			refuse(path, `a ${(value as object).constructor?.name ?? 'class instance'}`);
		for (const [key, item] of Object.entries(value))
			if (item !== undefined) checkValue(item, `${path}.${key}`, parents);
	}
	parents.delete(value);
}

function refuse(path: string, what: string): never {
	throw new EngineError(
		'E1213',
		`createEngine() got sketchData where ${path} is ${what}. sketchData takes plain JSON data: objects, arrays, strings, finite numbers, booleans and null.`,
	);
}

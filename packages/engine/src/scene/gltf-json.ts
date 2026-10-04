// Checks of a glTF file's JSON and the types its accessors read into, which the parser
// (gltf-parse.ts) and its reader of skins, clips and morph targets (gltf-animation.ts) share. Each
// check throws E1416 with words that name what it checked. The module imports nothing at run time,
// so the glTF worker's bundle holds it alone.

/**
 * The engine's codes for a file the parser refuses: broken data, or an extension it does not read.
 * The worker adds E1406 for a decoder that did not download.
 */
export type GltfErrorCode = 'E1406' | 'E1416' | 'E1417';

/** A file the parser refuses, with the engine's code and the reason in words. */
export class GltfError extends Error {
	constructor(
		readonly code: GltfErrorCode,
		message: string,
	) {
		super(message);
	}
}

export function broken(reason: string): never {
	throw new GltfError('E1416', reason);
}

/** The typed arrays an accessor reads into. */
export type AccessorArray =
	| Int8Array
	| Uint8Array
	| Int16Array
	| Uint16Array
	| Uint32Array
	| Float32Array;

/** An object of the JSON, whose fields the parser checks before it reads them. */
export type Entry = Record<string, unknown>;

/**
 * The parser's reader of accessors: a tight typed array of an accessor's values, with its type.
 * With `shared`, an accessor whose values lie tightly in the file comes as a view of the file's
 * bytes, with no copy, which the caller must not change.
 */
export type Reader = (
	k: number,
	what: string,
	shared?: boolean,
) => {
	array: AccessorArray;
	components: number;
	componentType: number;
	normalized: boolean;
	count: number;
	accessor: Entry;
};

/** Floats of an accessor's values, with normalized integers as fractions, as glTF reads them. */
export function toFloats(array: AccessorArray, normalized: boolean): Float32Array {
	if (array instanceof Float32Array) return array;
	const out = Float32Array.from(array);
	if (!normalized) return out;
	const scale =
		array instanceof Int8Array
			? 127
			: array instanceof Uint8Array
				? 255
				: array instanceof Int16Array
					? 32767
					: 65535;
	for (let i = 0; i < out.length; i++) out[i] = Math.max((out[i] as number) / scale, -1);
	return out;
}

// Checks of the JSON's values. Each throws E1416 that names what it checked.

export function entry(value: unknown, what: string): Entry {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		broken(`${what} is not an object`);
	return value as Entry;
}

export function list(value: unknown, what: string): unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) broken(`${what} is not a list`);
	return value;
}

/** A whole number from 0, below 2^31. */
export function count(value: unknown, what: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0x7fffffff)
		broken(`${what} is ${String(value)}, not a whole number from 0`);
	return value;
}

/** A whole number that names one of `length` items. */
export function index(value: unknown, length: number, what: string): number {
	const k = count(value, what);
	if (k >= length) broken(`${what} is ${k}, and there are ${length}`);
	return k;
}

export function finite(value: unknown, what: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		broken(`${what} is ${String(value)}, not a number`);
	return value;
}

/** A number from 0 to `most`. */
export function unit(value: unknown, what: string, most = 1): number {
	const n = finite(value, what);
	if (n < 0 || n > most) broken(`${what} is ${n}, outside 0 to ${most}`);
	return n;
}

/** A list of `length` finite numbers, or `fallback` when the value is missing. */
export function numbers(
	value: unknown,
	length: number,
	fallback: readonly number[] | undefined,
	what: string,
): number[] {
	if (value === undefined && fallback) return [...fallback];
	if (
		!Array.isArray(value) ||
		value.length !== length ||
		!value.every((n) => typeof n === 'number' && Number.isFinite(n))
	)
		broken(`${what} is not ${length} numbers`);
	return value as number[];
}

export function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

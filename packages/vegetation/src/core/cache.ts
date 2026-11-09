// The caches of kits, grown variants, nearest wood and far bakes, keyed by content: a kit by its
// key, a variant by its variant key (generate.ts). The memory cache keeps them for the page's visit.
// A store of bytes, which the page passes in, keeps them across visits: the plant core encodes each
// value to bytes for it and decodes what it answers. A key holds the generator's version and every
// input, so a cached value is never stale: a changed record or generator gives another key.

/**
 * A cache of the plant core's results by key, as the values themselves.
 *
 * @category api/vegetation
 */
export interface PlantCache {
	/** The value kept under a key, or undefined. */
	get<T>(key: string): Promise<T | undefined>;
	/** Keeps a value under a key. A cache that cannot keep it drops it without an error. */
	put(key: string, value: unknown): Promise<void>;
}

/**
 * A store of bytes by key that keeps the plant core's results across visits, such as a namespace of
 * the engine's cache of derived data, which `ctx.assets.cache(name, version)` gives. The plant core reads it after its memory cache misses and
 * writes each new result to it without waiting. A store that fails or answers bytes the core cannot
 * read costs a new growth, never an error.
 *
 * @category api/vegetation
 */
export interface PlantByteCache {
	/** The bytes kept under a key, or undefined. */
	get(key: string): Promise<Uint8Array | undefined>;
	/** Keeps bytes under a key. */
	put(key: string, bytes: Uint8Array): Promise<void>;
}

/** The bytes of the typed arrays in a value, which the memory cache counts against its limit. */
function bytesOf(value: unknown, seen = new Set<unknown>()): number {
	if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
	seen.add(value);
	if (ArrayBuffer.isView(value)) return value.byteLength;
	let bytes = 0;
	for (const item of Object.values(value)) bytes += bytesOf(item, seen);
	return bytes;
}

/**
 * A cache in the page's memory that drops its oldest values past a limit of bytes.
 *
 * @param limit Bytes of typed arrays the cache may hold.
 * @returns The cache.
 * @category api/vegetation
 */
export function memoryCache(limit: number): PlantCache {
	const values = new Map<string, { value: unknown; bytes: number }>();
	let held = 0;
	return {
		async get<T>(key: string): Promise<T | undefined> {
			const entry = values.get(key);
			if (!entry) return undefined;
			values.delete(key);
			values.set(key, entry);
			return entry.value as T;
		},
		async put(key: string, value: unknown): Promise<void> {
			const bytes = bytesOf(value);
			if (bytes > limit) return;
			const old = values.get(key);
			if (old) {
				held -= old.bytes;
				values.delete(key);
			}
			values.set(key, { value, bytes });
			held += bytes;
			for (const [oldest, entry] of values) {
				if (held <= limit) break;
				values.delete(oldest);
				held -= entry.bytes;
			}
		},
	};
}

/** The typed arrays a value may hold, by name. */
const VIEWS = {
	Int8Array,
	Uint8Array,
	Uint8ClampedArray,
	Int16Array,
	Uint16Array,
	Int32Array,
	Uint32Array,
	Float32Array,
	Float64Array,
} as const;

type ViewName = keyof typeof VIEWS;

/** The key that marks a typed array's place in the encoded text. */
const MARK = '$plantView';

/** The first bytes of every encoded value, which a reader checks before it trusts the rest. */
const MAGIC = 0x504c4e31;

/** Rounds a byte count up to the next multiple of 8, so every typed array starts aligned. */
const align8 = (bytes: number) => (bytes + 7) & ~7;

/**
 * Encodes a plant core result as bytes: its plain data as JSON text, with each typed array replaced
 * by its place in a block of bytes that follows the text.
 *
 * @param value A kit, a grown variant, a part or a far bake.
 * @returns The bytes.
 */
export function encodePlantValue(value: unknown): Uint8Array {
	const views: ArrayBufferView[] = [];
	let offset = 0;
	const text = JSON.stringify(value, (_key, item: unknown) => {
		if (!ArrayBuffer.isView(item) || item instanceof DataView) return item;
		const name = item.constructor.name as ViewName;
		if (!(name in VIEWS))
			throw new TypeError(`a plant value holds a ${name}, which it cannot keep`);
		const at = offset;
		views.push(item);
		offset = align8(offset + item.byteLength);
		return { [MARK]: name, at, length: (item as Uint8Array).length };
	});
	const head = new TextEncoder().encode(text);
	const start = align8(8 + head.byteLength);
	const bytes = new Uint8Array(start + offset);
	const words = new DataView(bytes.buffer);
	words.setUint32(0, MAGIC, true);
	words.setUint32(4, head.byteLength, true);
	bytes.set(head, 8);
	let at = start;
	for (const view of views) {
		bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), at);
		at = align8(at + view.byteLength);
	}
	return bytes;
}

/**
 * Decodes bytes that `encodePlantValue` made. Each typed array gets a buffer of its own.
 *
 * @param bytes The bytes.
 * @returns The value, or undefined when the bytes are not an encoded value.
 */
export function decodePlantValue<T>(bytes: Uint8Array): T | undefined {
	if (bytes.byteLength < 8) return undefined;
	const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (words.getUint32(0, true) !== MAGIC) return undefined;
	const length = words.getUint32(4, true);
	const start = align8(8 + length);
	if (start > bytes.byteLength) return undefined;
	try {
		const text = new TextDecoder().decode(bytes.subarray(8, 8 + length));
		return JSON.parse(text, (_key, item: unknown) => {
			if (item === null || typeof item !== 'object' || !(MARK in item)) return item;
			const mark = item as { [MARK]: ViewName; at: number; length: number };
			const View = VIEWS[mark[MARK]];
			if (!View) throw new TypeError(`a plant value names a ${mark[MARK]}`);
			const from = start + mark.at;
			const end = from + mark.length * View.BYTES_PER_ELEMENT;
			if (end > bytes.byteLength) throw new RangeError('a plant value is cut short');
			return new View(bytes.slice(from, end).buffer);
		}) as T;
	} catch {
		return undefined;
	}
}

/**
 * A result from the caches, or made and kept when neither holds it: the memory cache first, then
 * the store of bytes, then `make`. A value read from the store is kept in memory too. A new value is
 * written to the store without waiting, and a store that fails is passed over.
 *
 * @param key The result's key.
 * @param memory The visit's memory cache.
 * @param store The store of bytes across visits, if the page gave one.
 * @param make Makes the result.
 * @returns The result.
 */
export async function cachedResult<T>(
	key: string,
	memory: PlantCache,
	store: PlantByteCache | undefined,
	make: () => Promise<T>,
): Promise<T> {
	const held = await memory.get<T>(key);
	if (held !== undefined) return held;
	if (store) {
		const bytes = await store.get(key).catch(() => undefined);
		const stored = bytes && decodePlantValue<T>(bytes);
		if (stored !== undefined) {
			await memory.put(key, stored);
			return stored;
		}
	}
	const value = await make();
	await memory.put(key, value);
	if (store)
		void Promise.resolve()
			.then(() => store.put(key, encodePlantValue(value)))
			.catch(() => {});
	return value;
}

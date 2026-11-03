// The caches of kits, grown variants and far bakes, keyed by content: a kit by its key, a variant by
// its variant key (generate.ts). The memory cache keeps them for the page's visit; the IndexedDB
// cache keeps them across visits, so a second visit grows nothing. A key holds the generator's
// version and every input, so a cached value is never stale: a changed record or generator gives
// another key. Values are plain data and typed arrays, which IndexedDB stores as they are.

/**
 * A cache of the plant core's results by key.
 *
 * @category api/vegetation
 */
export interface PlantCache {
	/** The value kept under a key, or undefined. */
	get<T>(key: string): Promise<T | undefined>;
	/** Keeps a value under a key. A cache that cannot keep it drops it without an error. */
	put(key: string, value: unknown): Promise<void>;
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

/** The IndexedDB store's name. */
const STORE = 'values';

/** A request's result as a promise. */
function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * A cache in the browser's IndexedDB, which keeps values across visits. Where IndexedDB is missing
 * or refuses, as in a private window, it answers nothing and keeps nothing, and the page grows
 * again.
 *
 * @param name The database's name.
 * @returns The cache.
 * @category api/vegetation
 */
export function indexedDbCache(name = 'null3d-vegetation'): PlantCache {
	let opened: Promise<IDBDatabase | undefined> | undefined;
	const database = () => {
		opened ??= (async () => {
			if (typeof indexedDB === 'undefined') return undefined;
			try {
				const request = indexedDB.open(name, 1);
				request.onupgradeneeded = () => request.result.createObjectStore(STORE);
				return await done(request);
			} catch {
				return undefined;
			}
		})();
		return opened;
	};
	return {
		async get<T>(key: string): Promise<T | undefined> {
			const db = await database();
			if (!db) return undefined;
			try {
				return (await done(db.transaction(STORE).objectStore(STORE).get(key))) as T | undefined;
			} catch {
				return undefined;
			}
		},
		async put(key: string, value: unknown): Promise<void> {
			const db = await database();
			if (!db) return;
			try {
				await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
			} catch {
				// A full or refused store keeps nothing; the page grows the value again next visit.
			}
		},
	};
}

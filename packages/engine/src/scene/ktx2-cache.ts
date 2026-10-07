// The cache of transcoded KTX2 textures. The KTX2 loader keeps each file's texels, in the format
// that the device takes, in the browser's Cache Storage. A later load of the same file, on this
// visit or a later one, reads them back instead of transcoding, and a page whose files all come
// from the cache never downloads the transcoder.
//
// An entry's key is the SHA-256 of the file's bytes with the format and the mip levels that the
// transcoder writes. The file's address and its response's validator would not do: the textures
// inside one glTF file share its address and validator, and a server that sends no validator would
// leave its files out. The cache's name holds the transcoder's version and the layout of the
// texels, so an engine whose transcoder writes other bytes starts a cache of its own and deletes
// the old one. The cache keeps the newest entries up to a size, and deletes the oldest first.
//
// Every step may fail: a page outside a secure context has no Cache Storage, some private windows
// refuse it, and the browser may refuse a write when the origin's storage is full. Then the file
// goes to the transcoder as it would without the cache. Writes run after the texture is made, off
// the load's path, and an entry that reads back at the wrong size is deleted and transcoded again.
//
// Like the KTX2 loader, this module imports no engine module, so it stays in the loader's file.

/** The start of every name of this cache, of this engine version or an earlier one. */
const CACHE_PREFIX = 'null3d-ktx2-';

/**
 * The cache's name: the transcoder's version, Basis Universal 2.50, and the version of the
 * entries' layout, every mip level in turn with each level's layers in turn.
 */
export const CACHE_NAME = `${CACHE_PREFIX}basis-2.50-1`;

/**
 * The origin of the entries' keys. Cache Storage keys entries by HTTP address, and an address of
 * a reserved name never matches one that the page itself fetches and caches.
 */
const KEY_ORIGIN = 'https://ktx2.null3d.invalid/';

/** The most bytes of texels that the cache keeps. Older entries go first when a write passes it. */
export const CACHE_MAX_BYTES = 256 * 2 ** 20;

/**
 * The most bytes of texels that wait to be written at once. A load that would pass it skips the
 * write, so a page that loads many textures at once holds no more than this in second copies. Job
 * workers that transcode in parallel finish many textures at once, so it holds a scene's worth.
 */
const WRITING_MAX_BYTES = 128 * 2 ** 20;

/** The header that holds an entry's size, which the cache reads to keep under its size. */
const SIZE_HEADER = 'x-null3d-bytes';

/** The cache's key of a file's texels: the file's hash, the format, and the mip levels written. */
export function cacheKey(hash: ArrayBuffer, format: string, levels: number): string {
	let hex = '';
	for (const byte of new Uint8Array(hash)) hex += byte.toString(16).padStart(2, '0');
	return `${KEY_ORIGIN}${hex}/${format}/${levels}`;
}

/** What the cache answers for a file: its texels, or a way to store them once transcoded. */
export type CacheLookup =
	| { texels: ArrayBuffer; store?: undefined }
	| { texels?: undefined; store(texels: ArrayBuffer): void };

/** The browser's parts that the cache uses, which tests replace. */
export interface CacheHost {
	caches: CacheStorage | undefined;
	digest: ((data: ArrayBuffer) => Promise<ArrayBuffer>) | undefined;
}

/** The browser's Cache Storage and SHA-256, where the page is a secure context that has them. */
function browserHost(): CacheHost {
	const subtle = globalThis.crypto?.subtle;
	return {
		caches: globalThis.caches,
		digest: subtle && ((data) => subtle.digest('SHA-256', data)),
	};
}

/** A lookup that only skips: the cache could not answer. */
const NO_CACHE: CacheLookup = { store() {} };

/**
 * The cache of one thread. It opens Cache Storage on the first lookup, and deletes the caches of
 * other transcoder versions then.
 */
export class TranscodeCache {
	private opened: Promise<Cache | undefined> | undefined;
	/** Bytes of texels that writes under way hold. */
	private writing = 0;
	/** Writes under way. The last one to finish keeps the cache under its size. */
	private writes = 0;

	constructor(
		private readonly host: CacheHost = browserHost(),
		private readonly maxBytes = CACHE_MAX_BYTES,
		private readonly writingMaxBytes = WRITING_MAX_BYTES,
	) {}

	/**
	 * The texels of `file` in `format` with `levels` mip levels, when the cache holds them at
	 * `bytes` bytes, or a function that stores them. The file stays usable: hashing reads a copy.
	 */
	async lookup(
		file: ArrayBuffer,
		format: string,
		levels: number,
		bytes: number,
	): Promise<CacheLookup> {
		const { digest } = this.host;
		const cache = digest && (await this.open());
		if (!cache) return NO_CACHE;
		let key: string;
		try {
			key = cacheKey(await digest(file), format, levels);
			const hit = await cache.match(key);
			if (hit) {
				const texels = await hit.arrayBuffer();
				if (texels.byteLength === bytes) return { texels };
				void cache.delete(key).catch(() => {});
			}
		} catch {
			return NO_CACHE;
		}
		return { store: (texels) => this.store(cache, key, texels) };
	}

	/** Opens the cache once, or gives undefined where the browser has none or refuses it. */
	private open(): Promise<Cache | undefined> {
		this.opened ??= (async () => {
			const { caches } = this.host;
			if (!caches) return undefined;
			try {
				const cache = await caches.open(CACHE_NAME);
				void dropOtherVersions(caches);
				return cache;
			} catch {
				return undefined;
			}
		})();
		return this.opened;
	}

	/**
	 * Writes texels under `key` after the load, unless the writes under way hold too many bytes.
	 * The response copies the texels at once, so the caller may hand them on.
	 */
	private store(cache: Cache, key: string, texels: ArrayBuffer): void {
		const bytes = texels.byteLength;
		if (bytes > this.maxBytes || this.writing + bytes > this.writingMaxBytes) return;
		let response: Response;
		try {
			response = new Response(texels, { headers: { [SIZE_HEADER]: String(bytes) } });
		} catch {
			return;
		}
		this.writing += bytes;
		this.writes++;
		cache
			.put(key, response)
			.catch(() => {})
			.finally(() => {
				this.writing -= bytes;
				if (--this.writes === 0) void trim(cache, this.maxBytes).catch(() => {});
			});
	}
}

/** Deletes the caches of other transcoder versions or entry layouts. */
async function dropOtherVersions(caches: CacheStorage): Promise<void> {
	try {
		for (const name of await caches.keys())
			if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
	} catch {
		// A cache that stays is only space; the next start tries again.
	}
}

/**
 * Deletes the oldest entries until the rest fit in `maxBytes`. Cache Storage keeps its entries in
 * the order of their writes, so the first keys are the oldest.
 */
export async function trim(cache: Cache, maxBytes: number): Promise<void> {
	const keys = await cache.keys();
	const sizes = await Promise.all(
		keys.map(async (key) => Number((await cache.match(key))?.headers.get(SIZE_HEADER)) || 0),
	);
	let total = sizes.reduce((sum, size) => sum + size, 0);
	for (let k = 0; k < keys.length && total > maxBytes; k++) {
		await cache.delete(keys[k] as Request);
		total -= sizes[k] as number;
	}
}

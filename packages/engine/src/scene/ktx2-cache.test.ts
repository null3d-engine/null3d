import { describe, expect, test } from 'bun:test';
import { CACHE_NAME, type CacheHost, cacheKey, TranscodeCache, trim } from './ktx2-cache';

/** Cache Storage in memory: entries keep the order of their writes, as browsers keep them. */
class MemoryCache {
	readonly entries = new Map<string, { body: ArrayBuffer; headers: Headers }>();
	/** Writes that fail, as when the origin's storage is full. */
	refuseWrites = false;

	async match(key: RequestInfo): Promise<Response | undefined> {
		const entry = this.entries.get(urlOf(key));
		return entry && new Response(entry.body.slice(0), { headers: entry.headers });
	}

	async put(key: RequestInfo, response: Response): Promise<void> {
		if (this.refuseWrites) throw new Error('QuotaExceededError');
		const body = await response.arrayBuffer();
		this.entries.delete(urlOf(key));
		this.entries.set(urlOf(key), { body, headers: response.headers });
	}

	async delete(key: RequestInfo): Promise<boolean> {
		return this.entries.delete(urlOf(key));
	}

	async keys(): Promise<Request[]> {
		return [...this.entries.keys()].map((url) => new Request(url));
	}
}

const urlOf = (key: RequestInfo) => (typeof key === 'string' ? key : key.url);

class MemoryStorage {
	readonly caches = new Map<string, MemoryCache>();
	opens = 0;

	async open(name: string): Promise<Cache> {
		this.opens++;
		let cache = this.caches.get(name);
		if (!cache) {
			cache = new MemoryCache();
			this.caches.set(name, cache);
		}
		return cache as unknown as Cache;
	}

	async keys(): Promise<string[]> {
		return [...this.caches.keys()];
	}

	async delete(name: string): Promise<boolean> {
		return this.caches.delete(name);
	}
}

const sha256 = (data: ArrayBuffer) => crypto.subtle.digest('SHA-256', data);

function host(storage = new MemoryStorage()): CacheHost & { storage: MemoryStorage } {
	return { caches: storage as unknown as CacheStorage, digest: sha256, storage };
}

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** Waits for the writes that a store started, which run after the load. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The texels a transcoder would write: `length` bytes that start with `seed`. */
function texels(length: number, seed = 1): ArrayBuffer {
	const data = new Uint8Array(length);
	for (let k = 0; k < length; k++) data[k] = (seed + k) & 0xff;
	return data.buffer;
}

describe('the key of a transcoded texture', () => {
	test("names the file's SHA-256, the format and the mip levels", async () => {
		const key = cacheKey(await sha256(bytes(1, 2, 3)), 'cTFETC1_RGB', 11);
		expect(key).toBe(
			'https://ktx2.null3d.invalid/039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81/cTFETC1_RGB/11',
		);
	});

	test('differs for other bytes, another format and other mip levels, and only then', async () => {
		const a = await sha256(bytes(1, 2, 3));
		const b = await sha256(bytes(1, 2, 4));
		const keys = new Set([
			cacheKey(a, 'cTFETC1_RGB', 11),
			cacheKey(b, 'cTFETC1_RGB', 11),
			cacheKey(a, 'cTFASTC_4x4_RGBA', 11),
			cacheKey(a, 'cTFETC1_RGB', 1),
		]);
		expect(keys.size).toBe(4);
		expect(cacheKey(await sha256(bytes(1, 2, 3)), 'cTFETC1_RGB', 11)).toBe(
			cacheKey(a, 'cTFETC1_RGB', 11),
		);
	});
});

describe('the cache of transcoded textures', () => {
	test('misses a new file, then gives back the texels that the load stored', async () => {
		const cache = new TranscodeCache(host());
		const file = bytes(9, 8, 7);
		const first = await cache.lookup(file, 'cTFBC7_RGBA', 3, 64);
		expect(first.texels).toBeUndefined();
		first.store?.(texels(64));
		await settle();
		const second = await cache.lookup(file, 'cTFBC7_RGBA', 3, 64);
		expect(new Uint8Array(second.texels as ArrayBuffer)).toEqual(new Uint8Array(texels(64)));
		expect(second.store).toBeUndefined();
	});

	test('keeps the file usable, as the transcoder takes it after the lookup', async () => {
		const file = bytes(1, 2, 3, 4);
		await new TranscodeCache(host()).lookup(file, 'cTFBC7_RGBA', 1, 16);
		expect(file.byteLength).toBe(4);
	});

	test('misses the same file in another format or with other mip levels', async () => {
		const cache = new TranscodeCache(host());
		const file = bytes(5, 5, 5);
		(await cache.lookup(file, 'cTFBC7_RGBA', 3, 64)).store?.(texels(64));
		await settle();
		expect((await cache.lookup(file, 'cTFASTC_4x4_RGBA', 3, 64)).texels).toBeUndefined();
		expect((await cache.lookup(file, 'cTFBC7_RGBA', 1, 64)).texels).toBeUndefined();
	});

	test('deletes an entry of the wrong size and misses, so the file transcodes again', async () => {
		const { storage, ...parts } = host();
		const cache = new TranscodeCache(parts);
		const file = bytes(4, 4);
		(await cache.lookup(file, 'cTFETC1_RGB', 1, 32)).store?.(texels(32));
		await settle();
		const lookup = await cache.lookup(file, 'cTFETC1_RGB', 1, 48);
		expect(lookup.texels).toBeUndefined();
		await settle();
		expect(storage.caches.get(CACHE_NAME)?.entries.size).toBe(0);
	});

	test('skips without Cache Storage or SHA-256, as outside a secure context', async () => {
		for (const parts of [
			{ caches: undefined, digest: sha256 },
			{ caches: new MemoryStorage() as unknown as CacheStorage, digest: undefined },
		]) {
			const lookup = await new TranscodeCache(parts).lookup(bytes(1), 'cTFRGBA32', 1, 4);
			expect(lookup.texels).toBeUndefined();
			expect(() => lookup.store?.(texels(4))).not.toThrow();
		}
	});

	test('skips when the browser refuses to open the cache, and opens it once', async () => {
		const storage = new MemoryStorage();
		storage.open = async () => {
			storage.opens++;
			throw new Error('SecurityError');
		};
		const cache = new TranscodeCache({
			caches: storage as unknown as CacheStorage,
			digest: sha256,
		});
		for (let k = 0; k < 3; k++)
			expect((await cache.lookup(bytes(k), 'cTFRGBA32', 1, 4)).texels).toBeUndefined();
		expect(storage.opens).toBe(1);
	});

	test('loses nothing but the entry when the browser refuses a write', async () => {
		const { storage, ...parts } = host();
		const cache = new TranscodeCache(parts);
		(await cache.lookup(bytes(1), 'cTFRGBA32', 1, 4)).store?.(texels(4));
		await settle();
		const memory = storage.caches.get(CACHE_NAME) as MemoryCache;
		memory.refuseWrites = true;
		(await cache.lookup(bytes(2), 'cTFRGBA32', 1, 4)).store?.(texels(4));
		await settle();
		expect(memory.entries.size).toBe(1);
		expect((await cache.lookup(bytes(1), 'cTFRGBA32', 1, 4)).texels?.byteLength).toBe(4);
	});

	test('skips a write that would hold too many bytes at once', async () => {
		const { storage, ...parts } = host();
		const cache = new TranscodeCache(parts, 1000, 100);
		const a = await cache.lookup(bytes(1), 'cTFRGBA32', 1, 60);
		const b = await cache.lookup(bytes(2), 'cTFRGBA32', 1, 60);
		a.store?.(texels(60));
		b.store?.(texels(60));
		await settle();
		expect(storage.caches.get(CACHE_NAME)?.entries.size).toBe(1);
	});

	test('keeps the newest entries within its size once the writes end', async () => {
		const { storage, ...parts } = host();
		const cache = new TranscodeCache(parts, 100);
		for (let k = 0; k < 4; k++) {
			(await cache.lookup(bytes(k), 'cTFRGBA32', 1, 40)).store?.(texels(40, k));
			await settle();
		}
		await settle();
		const left = [...(storage.caches.get(CACHE_NAME)?.entries.values() ?? [])];
		expect(left.map(({ body }) => new Uint8Array(body)[0])).toEqual([2, 3]);
	});

	test('deletes the caches of other transcoder versions when it opens', async () => {
		const { storage, ...parts } = host();
		await storage.open('null3d-ktx2-basis-2.40-1');
		await storage.open('the-page-own-cache');
		await new TranscodeCache(parts).lookup(bytes(1), 'cTFRGBA32', 1, 4);
		await settle();
		expect([...storage.caches.keys()].sort()).toEqual([CACHE_NAME, 'the-page-own-cache']);
	});
});

describe('trimming the cache', () => {
	test('deletes the oldest entries first, and counts an entry without a size as empty', async () => {
		const memory = new MemoryCache();
		const put = (name: string, size?: number) =>
			memory.put(
				`https://ktx2.null3d.invalid/${name}`,
				new Response(new ArrayBuffer(size ?? 8), {
					headers: size === undefined ? {} : { 'x-null3d-bytes': String(size) },
				}),
			);
		await put('a', 50);
		await put('b');
		await put('c', 50);
		await put('d', 50);
		await trim(memory as unknown as Cache, 100);
		expect([...memory.entries.keys()].map((url) => url.slice(-1))).toEqual(['b', 'c', 'd']);
	});
});

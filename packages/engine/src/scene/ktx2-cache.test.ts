import { describe, expect, test } from 'bun:test';
import type { DerivedCache } from './derived-cache';
import { cacheKey, KTX2_CACHE_NAME, KTX2_CACHE_VERSION, TranscodeCache } from './ktx2-cache';

/** A namespace of the cache of derived data in memory, which counts its calls. */
function memoryNamespace(): DerivedCache & { entries: Map<string, Uint8Array>; puts: number } {
	const entries = new Map<string, Uint8Array>();
	const namespace = {
		name: KTX2_CACHE_NAME,
		version: KTX2_CACHE_VERSION,
		entries,
		puts: 0,
		async get(key: string) {
			return entries.get(key)?.slice();
		},
		async put(key: string, bytes: Uint8Array) {
			namespace.puts++;
			entries.set(key, bytes.slice());
		},
	};
	return namespace;
}

const sha256 = (data: ArrayBuffer) => crypto.subtle.digest('SHA-256', data);

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** Waits for the writes that a store started, which run after the load. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The texels a transcoder would write: `length` bytes that start with `seed`. */
function texels(length: number, seed = 1): Uint8Array {
	const data = new Uint8Array(length);
	for (let k = 0; k < length; k++) data[k] = (seed + k) & 0xff;
	return data;
}

describe('the key of a transcoded texture', () => {
	test("names the file's SHA-256, the format and the mip levels", async () => {
		expect(cacheKey(await sha256(bytes(1, 2, 3)), 'cTFETC1_RGB', 11)).toBe(
			'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81/cTFETC1_RGB/11',
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
		const namespace = memoryNamespace();
		const cache = new TranscodeCache(namespace, sha256);
		const file = bytes(9, 9, 9);
		const miss = await cache.lookup(file, 'cTFBC7_RGBA', 1, 16);
		expect(miss.texels).toBeUndefined();
		miss.store?.(texels(16));
		await settle();
		const hit = await cache.lookup(file, 'cTFBC7_RGBA', 1, 16);
		expect([...(hit.texels ?? [])]).toEqual([...texels(16)]);
		expect(hit.store).toBeUndefined();
	});

	test('keeps the file usable, as the transcoder takes it after the lookup', async () => {
		const file = bytes(1, 2, 3, 4);
		await new TranscodeCache(memoryNamespace(), sha256).lookup(file, 'cTFBC7_RGBA', 1, 16);
		expect(file.byteLength).toBe(4);
	});

	test('misses the same file in another format or with other mip levels', async () => {
		const cache = new TranscodeCache(memoryNamespace(), sha256);
		const file = bytes(5);
		(await cache.lookup(file, 'cTFETC1_RGB', 2, 8)).store?.(texels(8));
		await settle();
		expect((await cache.lookup(file, 'cTFASTC_4x4_RGBA', 2, 8)).texels).toBeUndefined();
		expect((await cache.lookup(file, 'cTFETC1_RGB', 1, 8)).texels).toBeUndefined();
		expect((await cache.lookup(file, 'cTFETC1_RGB', 2, 8)).texels).toBeDefined();
	});

	test('misses an entry of the wrong size, so the file transcodes again and writes it over', async () => {
		const namespace = memoryNamespace();
		const cache = new TranscodeCache(namespace, sha256);
		const file = bytes(7);
		(await cache.lookup(file, 'cTFRGBA32', 1, 4)).store?.(texels(3));
		await settle();
		const again = await cache.lookup(file, 'cTFRGBA32', 1, 4);
		expect(again.texels).toBeUndefined();
		again.store?.(texels(4));
		await settle();
		expect((await cache.lookup(file, 'cTFRGBA32', 1, 4)).texels?.byteLength).toBe(4);
	});

	test('skips without SHA-256, as outside a secure context, or when hashing fails', async () => {
		for (const digest of [
			undefined,
			async () => {
				throw new Error('refused');
			},
		]) {
			const namespace = memoryNamespace();
			const lookup = await new TranscodeCache(namespace, digest).lookup(
				bytes(1),
				'cTFRGBA32',
				1,
				4,
			);
			expect(lookup.texels).toBeUndefined();
			lookup.store?.(texels(4));
			await settle();
			expect(namespace.puts).toBe(0);
		}
	});

	test('keeps its entries in the namespace of transcoded textures at the transcoder version', () => {
		expect([KTX2_CACHE_NAME, KTX2_CACHE_VERSION]).toEqual(['null3d-ktx2', 'basis-2.50-1']);
	});
});

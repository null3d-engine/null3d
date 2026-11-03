import { describe, expect, it } from 'bun:test';
import type { DerivedCache } from '@null3d/engine';
import { plantAssetDigest } from '../asset';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import {
	cachedResult,
	decodePlantValue,
	encodePlantValue,
	memoryCache,
	type PlantByteCache,
} from './cache';
import { standInSpecies } from './stand-in';

/** A store of bytes in a map, which counts its reads and writes. */
function mapStore(): PlantByteCache & { readonly bytes: Map<string, Uint8Array>; reads: number } {
	const bytes = new Map<string, Uint8Array>();
	const store = {
		bytes,
		reads: 0,
		async get(key: string) {
			store.reads++;
			return bytes.get(key);
		},
		async put(key: string, value: Uint8Array) {
			bytes.set(key, value);
		},
	};
	return store;
}

/** Lets a write that the cache did not wait for land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the plant caches', () => {
	it('keep values in memory up to a limit of bytes, dropping the oldest first', async () => {
		const cache = memoryCache(1000);
		await cache.put('a', { arrays: [new Uint8Array(400)] });
		await cache.put('b', { arrays: [new Uint8Array(400)] });
		expect(await cache.get('a')).toBeDefined();
		await cache.put('c', { arrays: [new Uint8Array(400)] });
		// Reading a kept it newer than b, so b went first.
		expect(await cache.get('b')).toBeUndefined();
		expect(await cache.get('a')).toBeDefined();
		expect(await cache.get('c')).toBeDefined();
		await cache.put('huge', new Uint8Array(2000));
		expect(await cache.get('huge')).toBeUndefined();
	});

	it('encode a kit and a grown variant to bytes and decode the same bytes back', async () => {
		const stub = standInSpecies('stub');
		await loadPlantCode(stub.record);
		const kit = buildKitNow(stub, { placeholders: true });
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		const back = decodePlantValue<typeof asset>(encodePlantValue(asset));
		expect(back).toBeDefined();
		expect(plantAssetDigest(back as typeof asset)).toBe(plantAssetDigest(asset));
		expect(back).toEqual(asset);
		expect(decodePlantValue<typeof kit>(encodePlantValue(kit))).toEqual(kit);
	});

	it('refuse bytes that are not an encoded value', () => {
		expect(decodePlantValue(new Uint8Array([1, 2, 3]))).toBeUndefined();
		const cut = encodePlantValue({ rows: new Float32Array(64) });
		expect(decodePlantValue(cut.subarray(0, cut.length - 16))).toBeUndefined();
	});

	it('make a result once, then answer it from memory, and from the store on a new visit', async () => {
		const store = mapStore();
		let made = 0;
		const make = async () => ({ made: ++made, rows: new Uint16Array([1, 2, 3]) });
		const first = await cachedResult('k', memoryCache(1000), store, make);
		const again = await cachedResult('k', memoryCache(1000), undefined, make);
		expect(again.made).toBe(2);
		await settle();
		expect(store.bytes.has('k')).toBe(true);
		const visit = memoryCache(1000);
		const stored = await cachedResult('k', visit, store, make);
		expect(stored).toEqual(first);
		expect(made).toBe(2);
		const reads = store.reads;
		expect(await cachedResult('k', visit, store, make)).toBe(stored);
		expect(store.reads).toBe(reads);
	});

	it('grow again when the store fails', async () => {
		const broken: PlantByteCache = {
			get: () => Promise.reject(new Error('the store is gone')),
			put: () => {
				throw new Error('the store is full');
			},
		};
		let made = 0;
		const value = await cachedResult('k', memoryCache(1000), broken, async () => ++made);
		await settle();
		expect(value).toBe(1);
	});

	it("take a namespace of the engine's cache of derived data as their store", async () => {
		const bytes = new Map<string, Uint8Array>();
		const engineCache: DerivedCache = {
			name: '@null3d/vegetation',
			version: '1',
			get: async (key) => bytes.get(key)?.slice(),
			put: async (key, value) => {
				bytes.set(key, value.slice());
			},
		};
		const store: PlantByteCache = engineCache;
		const make = async () => ({ heights: new Float32Array([1, 2, 3]) });
		await cachedResult('k', memoryCache(1000), store, make);
		await settle();
		const later = await cachedResult(
			'k',
			memoryCache(1000),
			store,
			async (): ReturnType<typeof make> => {
				throw new Error('a new visit grew the value again');
			},
		);
		expect([...later.heights]).toEqual([1, 2, 3]);
	});
});

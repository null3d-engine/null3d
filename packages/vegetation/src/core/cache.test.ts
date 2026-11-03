import { describe, expect, it } from 'bun:test';
import { indexedDbCache, memoryCache } from './cache';

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

	it('answer nothing across visits where the browser has no IndexedDB', async () => {
		const cache = indexedDbCache('test');
		await cache.put('a', 1);
		expect(await cache.get('a')).toBeUndefined();
	});
});

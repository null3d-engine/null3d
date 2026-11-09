import { describe, expect, test } from 'bun:test';
import {
	BUDGET_SHARE,
	checkOf,
	DerivedStore,
	derivedEntries,
	entryHead,
	entryName,
	readEntry,
	type StorageHost,
} from './derived-cache';

/**
 * A file of the origin private file system in memory. Its sync access handle is exclusive, as in
 * Safari and Firefox, and its writable stream replaces the bytes only when it closes.
 */
class MemoryFile {
	readonly kind = 'file';
	bytes = new Uint8Array(0);
	locked = false;
	syncOpens = 0;
	/** Writes that fail, as when the origin's storage is full. */
	refuseWrites = false;

	constructor(readonly name: string) {}

	async getFile(): Promise<File> {
		return new File([this.bytes.slice()], this.name);
	}

	async createWritable() {
		if (this.locked || this.refuseWrites) throw new DOMException('refused', 'QuotaExceededError');
		const parts: Uint8Array[] = [];
		return {
			write: async (chunk: Uint8Array) => {
				parts.push(chunk.slice());
			},
			close: async () => {
				const total = parts.reduce((sum, part) => sum + part.length, 0);
				const bytes = new Uint8Array(total);
				let at = 0;
				for (const part of parts) {
					bytes.set(part, at);
					at += part.length;
				}
				this.bytes = bytes;
			},
			abort: async () => {},
		};
	}

	async createSyncAccessHandle() {
		if (this.locked) throw new DOMException('held', 'NoModificationAllowedError');
		this.locked = true;
		this.syncOpens++;
		return {
			getSize: () => this.bytes.length,
			read: (buffer: Uint8Array, { at }: { at: number }) => {
				const part = this.bytes.subarray(at, at + buffer.length);
				buffer.set(part);
				return part.length;
			},
			write: (buffer: Uint8Array, { at }: { at: number }) => {
				if (at + buffer.length > this.bytes.length) {
					const grown = new Uint8Array(at + buffer.length);
					grown.set(this.bytes);
					this.bytes = grown;
				}
				this.bytes.set(buffer, at);
				return buffer.length;
			},
			truncate: (size: number) => {
				this.bytes = this.bytes.slice(0, size);
			},
			flush: () => {},
			close: () => {
				this.locked = false;
			},
		};
	}
}

/** A folder of the origin private file system in memory. */
class MemoryFolder {
	readonly kind = 'directory';
	readonly children = new Map<string, MemoryFolder | MemoryFile>();

	constructor(readonly name = '') {}

	async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryFolder> {
		const found = this.children.get(name);
		if (found instanceof MemoryFolder) return found;
		if (found || !options?.create) throw new DOMException(name, 'NotFoundError');
		const made = new MemoryFolder(name);
		this.children.set(name, made);
		return made;
	}

	async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
		const found = this.children.get(name);
		if (found instanceof MemoryFile) return found;
		if (found || !options?.create) throw new DOMException(name, 'NotFoundError');
		const made = new MemoryFile(name);
		this.children.set(name, made);
		return made;
	}

	async removeEntry(name: string): Promise<void> {
		const found = this.children.get(name);
		if (found instanceof MemoryFile && found.locked)
			throw new DOMException(name, 'NoModificationAllowedError');
		if (!this.children.delete(name)) throw new DOMException(name, 'NotFoundError');
	}

	async *keys() {
		yield* [...this.children.keys()];
	}

	async *values() {
		yield* [...this.children.values()];
	}

	/** The folder or file at a path of names. */
	at(...path: string[]): MemoryFolder | MemoryFile | undefined {
		let node: MemoryFolder | MemoryFile | undefined = this;
		for (const name of path)
			node = node instanceof MemoryFolder ? node.children.get(name) : undefined;
		return node;
	}

	/** The bytes of every file under this folder. */
	bytes(): number {
		let total = 0;
		for (const child of this.children.values())
			total += child instanceof MemoryFolder ? child.bytes() : child.bytes.length;
		return total;
	}
}

interface TestHost extends StorageHost {
	folder: MemoryFolder;
	quota: number;
	/** Bytes that the origin uses besides the cache. */
	other: number;
	time: number;
}

function host(sync = true): TestHost {
	const folder = new MemoryFolder();
	const site: TestHost = {
		folder,
		quota: 1e9,
		other: 0,
		time: Date.UTC(2026, 0, 1),
		sync,
		root: async () => folder as unknown as FileSystemDirectoryHandle,
		estimate: async () => ({ quota: site.quota, usage: folder.bytes() + site.other }),
		now: () => site.time,
	};
	return site;
}

const bytes = (length: number, seed = 1) => {
	const data = new Uint8Array(length);
	for (let k = 0; k < length; k++) data[k] = (seed * 31 + k * 7) & 0xff;
	return data;
};

const HOUR = 3_600_000;

/** The file of an entry in the memory folder. */
const fileOf = (site: TestHost, name: string, version: string, key: string) =>
	site.folder.at('null3d-derived-1', name, version, entryName(key)) as MemoryFile | undefined;

describe('an entry of the cache of derived data', () => {
	test('reads back the bytes under its own key, and nothing under another key', () => {
		const data = bytes(3000);
		const head = entryHead('kit:abc', data, 7);
		const file = new Uint8Array(head.length + data.length);
		file.set(head);
		file.set(data, head.length);
		const entry = readEntry(file, 'kit:abc');
		expect(entry?.hour).toBe(7);
		expect([...(entry?.bytes ?? [])]).toEqual([...data]);
		expect(readEntry(file, 'kit:abd')).toBeUndefined();
	});

	test('fails its check when it is cut short, grows, or a sampled byte changes', () => {
		const data = bytes(5000);
		const head = entryHead('k', data, 1);
		const file = new Uint8Array(head.length + data.length);
		file.set(head);
		file.set(data, head.length);
		expect(readEntry(file.subarray(0, file.length - 1), 'k')).toBeUndefined();
		const longer = new Uint8Array(file.length + 1);
		longer.set(file);
		expect(readEntry(longer, 'k')).toBeUndefined();
		const changed = file.slice();
		(changed[changed.length - 1] as number) ^= 1;
		expect(readEntry(changed, 'k')).toBeUndefined();
		const small = bytes(100);
		const sampled = new Uint8Array(entryHead('k', small, 1).length + small.length);
		sampled.set(entryHead('k', small, 1));
		sampled.set(small, sampled.length - small.length);
		(sampled[sampled.length - 50] as number) ^= 1;
		expect(readEntry(sampled, 'k')).toBeUndefined();
	});

	test('checks every byte of a small entry, and a fixed number of bytes of a large one', () => {
		const small = bytes(64);
		const other = small.slice();
		(other[10] as number) ^= 1;
		expect(checkOf(small)).not.toBe(checkOf(other));
		expect(checkOf(bytes(0))).toBe(checkOf(new Uint8Array(0)));
	});

	test('takes a file name of 16 hex digits from its key', () => {
		expect(entryName('a')).toMatch(/^[0-9a-f]{16}$/);
		expect(entryName('a')).toBe(entryName('a'));
		expect(new Set(['a', 'b', 'ab', 'ba', '', 'x'.repeat(500)].map(entryName)).size).toBe(6);
	});
});

describe('the cache of derived data', () => {
	for (const sync of [true, false]) {
		test(`misses a new key, then gives back the bytes that were put, ${sync ? 'in a worker' : 'on the main thread'}`, async () => {
			const site = host(sync);
			const cache = new DerivedStore(site).namespace('plants', '3');
			expect(await cache.get('kit:1')).toBeUndefined();
			await cache.put('kit:1', bytes(40));
			expect([...((await cache.get('kit:1')) ?? [])]).toEqual([...bytes(40)]);
			expect(await cache.get('kit:2')).toBeUndefined();
			expect((fileOf(site, 'plants', '3', 'kit:1') as MemoryFile).syncOpens).toBe(sync ? 1 : 0);
		});
	}

	test('starts a write only after the call that asks for it returns', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('plants', '3');
		await cache.get('warm-up');
		const written = cache.put('k', bytes(8));
		await Promise.resolve();
		expect(fileOf(site, 'plants', '3', 'k')?.bytes.length ?? 0).toBe(0);
		await written;
		expect(fileOf(site, 'plants', '3', 'k')?.bytes.length).toBeGreaterThan(8);
	});

	test('counts only whole entries for test pages, not a file whose write never closed', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('plants', '3');
		await cache.put('whole', bytes(40));
		await cache.put('cut', bytes(40));
		const cut = fileOf(site, 'plants', '3', 'cut') as MemoryFile;
		cut.bytes = cut.bytes.slice(0, cut.bytes.length - 1);
		// A write makes its file first, and an engine that stops before the write closes leaves it.
		const folder = site.folder.at('null3d-derived-1', 'plants', '3') as MemoryFolder;
		const open = await folder.getFileHandle(entryName('open'), { create: true });
		await (await open.createWritable()).write(entryHead('open', bytes(40), 0));
		expect(await derivedEntries('plants', '3', site)).toBe(1);
		expect(await derivedEntries('terrain', '3', site)).toBe(0);
		expect(await derivedEntries('plants', '3', undefined)).toBeNull();
	});

	test('keeps namespaces apart, and gives the same namespace for the same name and version', async () => {
		const store = new DerivedStore(host());
		const a = store.namespace('a', '1');
		await a.put('k', bytes(4, 1));
		await store.namespace('b', '1').put('k', bytes(4, 2));
		expect([...((await a.get('k')) ?? [])]).toEqual([...bytes(4, 1)]);
		expect(store.namespace('a', '1')).toBe(a);
	});

	test("deletes the entries of a name's other versions, and leaves other names", async () => {
		const site = host();
		const first = new DerivedStore(site);
		await first.namespace('plants', '1').put('k', bytes(4));
		await first.namespace('terrain', '1').put('k', bytes(4));
		const next = new DerivedStore(site).namespace('plants', '2');
		expect(await next.get('k')).toBeUndefined();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(site.folder.at('null3d-derived-1', 'plants', '1')).toBeUndefined();
		expect(site.folder.at('null3d-derived-1', 'terrain', '1')).toBeDefined();
	});

	test('deletes the folders of older layouts and the caches of the older store when it opens', async () => {
		const site = host();
		await site.folder.getDirectoryHandle('null3d-derived-0', { create: true });
		await site.folder.getDirectoryHandle('game-data', { create: true });
		const deleted: string[] = [];
		site.caches = {
			keys: async () => ['null3d-ktx2-basis-2.50-1', 'game-v3'],
			delete: async (name: string) => {
				deleted.push(name);
				return true;
			},
		} as unknown as CacheStorage;
		await new DerivedStore(site).namespace('a', '1').get('k');
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect([...site.folder.children.keys()].sort()).toEqual(['game-data', 'null3d-derived-1']);
		expect(deleted).toEqual(['null3d-ktx2-basis-2.50-1']);
	});

	test('names folders so that no name or version leaves its folder', async () => {
		const site = host();
		await new DerivedStore(site).namespace('../up', 'a/b.c').put('k', bytes(4));
		expect(site.folder.at('null3d-derived-1', '%2E%2E%2Fup', 'a%2Fb%2Ec')).toBeDefined();
	});

	test('misses a damaged entry, and writes it over', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('a', '1');
		await cache.put('k', bytes(64));
		const file = fileOf(site, 'a', '1', 'k') as MemoryFile;
		(file.bytes[file.bytes.length - 3] as number) ^= 0xff;
		expect(await cache.get('k')).toBeUndefined();
		await cache.put('k', bytes(64));
		expect(await cache.get('k')).toBeDefined();
	});

	test('shares one read between two reads of the same entry at once, each with its own bytes', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('a', '1');
		await cache.put('k', bytes(32));
		const [one, two] = await Promise.all([cache.get('k'), cache.get('k')]);
		expect(one).toBeDefined();
		expect([...(two ?? [])]).toEqual([...(one ?? [])]);
		expect(two).not.toBe(one);
		expect((fileOf(site, 'a', '1', 'k') as MemoryFile).syncOpens).toBe(1);
	});

	test('keeps nothing in a namespace that the page switch turns off', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('a', '1', false);
		await cache.put('k', bytes(4));
		expect(await cache.get('k')).toBeUndefined();
		expect(site.folder.children.size).toBe(0);
	});

	test('misses everything, and never rejects, where the storage refuses to open', async () => {
		const site = host();
		site.root = async () => {
			throw new DOMException('no', 'SecurityError');
		};
		const cache = new DerivedStore(site).namespace('a', '1');
		await cache.put('k', bytes(4));
		expect(await cache.get('k')).toBeUndefined();
		expect(await new DerivedStore(undefined).namespace('a', '1').get('k')).toBeUndefined();
	});

	test('works without the storage once its open passes the time limit', async () => {
		const site = host();
		let opens = 0;
		site.root = () => {
			opens++;
			return new Promise(() => {});
		};
		const cache = new DerivedStore(site, { openMs: 20, writingMaxBytes: 1e6 }).namespace('a', '1');
		const started = performance.now();
		expect(await cache.get('k')).toBeUndefined();
		expect(performance.now() - started).toBeLessThan(1000);
		await cache.put('k', bytes(4));
		expect(await cache.get('j')).toBeUndefined();
		expect(opens).toBe(1);
	});

	test('loses only the entry when the browser refuses a write', async () => {
		const site = host();
		const cache = new DerivedStore(site).namespace('a', '1');
		await cache.put('k', bytes(4));
		(fileOf(site, 'a', '1', 'k') as MemoryFile).refuseWrites = true;
		await cache.put('k', bytes(4, 9));
		expect([...((await cache.get('k')) ?? [])]).toEqual([...bytes(4)]);
	});

	test('drops a write that would hold too many bytes at once, or that passes the budget', async () => {
		const site = host();
		const store = new DerivedStore(site, { openMs: 1000, writingMaxBytes: 100 });
		const cache = store.namespace('a', '1');
		await Promise.all([cache.put('one', bytes(60)), cache.put('two', bytes(60))]);
		expect(await cache.get('one')).toBeDefined();
		expect(await cache.get('two')).toBeUndefined();
		site.quota = 50 / BUDGET_SHARE;
		await store.trim();
		await cache.put('three', bytes(60));
		expect(await cache.get('three')).toBeUndefined();
	});

	test('deletes the entries used longest ago, of every namespace, until the rest fit its budget', async () => {
		const site = host();
		const store = new DerivedStore(site);
		const plants = store.namespace('plants', '1');
		const terrain = store.namespace('terrain', '1');
		await plants.put('old', bytes(100));
		site.time += 2 * HOUR;
		await terrain.put('middle', bytes(100));
		site.time += 2 * HOUR;
		await plants.put('new', bytes(100));
		const entry = (fileOf(site, 'plants', '1', 'new') as MemoryFile).bytes.length;
		site.quota = Math.ceil((2 * entry + 10) / BUDGET_SHARE);
		await store.trim();
		expect(await plants.get('old')).toBeUndefined();
		expect(await terrain.get('middle')).toBeDefined();
		expect(await plants.get('new')).toBeDefined();
	});

	test('trims nothing while what the origin uses fits the budget', async () => {
		const site = host();
		const store = new DerivedStore(site);
		const cache = store.namespace('a', '1');
		await cache.put('k', bytes(100));
		site.quota = Math.ceil(site.folder.bytes() / BUDGET_SHARE);
		await store.trim();
		expect(await cache.get('k')).toBeDefined();
	});

	test('writes the hour of a hit again once the entry is a day old, so an entry in use stays', async () => {
		const site = host();
		const store = new DerivedStore(site);
		const cache = store.namespace('a', '1');
		await cache.put('used', bytes(100));
		await cache.put('unused', bytes(100));
		site.time += 30 * HOUR;
		await cache.put('new', bytes(100));
		expect(await cache.get('used')).toBeDefined();
		await new Promise((resolve) => setTimeout(resolve, 5));
		const entry = (fileOf(site, 'a', '1', 'new') as MemoryFile).bytes.length;
		site.quota = Math.ceil((2 * entry + 10) / BUDGET_SHARE);
		await store.trim();
		expect(await cache.get('unused')).toBeUndefined();
		expect(await cache.get('used')).toBeDefined();
		expect(await cache.get('new')).toBeDefined();
	});
});

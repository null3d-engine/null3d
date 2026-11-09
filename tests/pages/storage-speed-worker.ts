// The storage speed page's worker: times writes and reads of blocks of bytes in each of the
// browser's stores, from a worker, where the engine's sketch runs. The stores are Cache Storage,
// IndexedDB with an ArrayBuffer and with a Blob, and the origin private file system with a sync
// access handle and with its asynchronous file calls. Each size is written and read back a few
// times under keys of its own, and each read checks the bytes it got. It also times two hashes of
// each block: SHA-256, which keys the engine's cache of transcoded textures, and a 32-bit hash of
// words, the cost of a check of every byte on read. Then it writes 120 blocks of 1 MiB at once and
// reads them back at once, as a scene's textures load together. Each store's blocks are deleted
// after use.

/** The block sizes, in MiB. */
const SIZES_MIB = [1, 10, 100];
/** How many times each size is written and read. */
const REPEATS = 3;
/** The name of every store that the page makes, so it never touches the engine's own. */
const NAME = 'null3d-storage-speed';
/** The blocks of the batch that the page writes and reads at once, each as large as the first size. */
const BATCH = 120;

/** The origin of Cache Storage's keys. */
const KEY_ORIGIN = 'https://storage-speed.null3d.invalid/';

type StoreName = 'cache' | 'idb' | 'idb-blob' | 'opfs-sync' | 'opfs';

type Bytes = Uint8Array<ArrayBuffer>;

/** A file's sync access handle, which only dedicated workers have. */
interface SyncHandle {
	getSize(): number;
	read(buffer: Bytes, options: { at: number }): number;
	write(buffer: Bytes, options: { at: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
}

const syncHandle = (file: FileSystemFileHandle) =>
	(
		file as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncHandle> }
	).createSyncAccessHandle();

/** One store's calls: open it, write a block, read it back, delete it, and close it. */
interface Store {
	open(): Promise<void>;
	write(key: string, bytes: Bytes): Promise<void>;
	read(key: string): Promise<ArrayBuffer>;
	remove(key: string): Promise<void>;
	close(): Promise<void>;
}

/** The milliseconds of each try of one size in one store, and whether every read matched. */
interface SizeTimes {
	mib: number;
	writeMs: number[];
	readMs: number[];
	ok: boolean;
}

/** One store's times, or why it could not run. */
interface StoreTimes {
	store: StoreName;
	openMs?: number;
	sizes?: SizeTimes[];
	/** The milliseconds to write the batch's blocks at once, and to read them back at once. */
	batch?: { writeMs: number; readMs: number; ok: boolean };
	error?: string;
}

const done = (request: IDBRequest | IDBTransaction) =>
	new Promise<void>((resolve, reject) => {
		if (request instanceof IDBTransaction) {
			request.oncomplete = () => resolve();
			request.onabort = request.onerror = () => reject(request.error);
		} else {
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		}
	});

function cacheStore(): Store {
	let cache: Cache;
	return {
		async open() {
			cache = await caches.open(NAME);
		},
		async write(key, bytes) {
			await cache.put(KEY_ORIGIN + key, new Response(bytes));
		},
		async read(key) {
			const hit = await cache.match(KEY_ORIGIN + key);
			if (!hit) throw new Error(`Cache Storage lost ${key}`);
			return hit.arrayBuffer();
		},
		async remove(key) {
			await cache.delete(KEY_ORIGIN + key);
		},
		async close() {
			await caches.delete(NAME);
		},
	};
}

function idbStore(asBlob: boolean): Store {
	let db: IDBDatabase;
	const transaction = (mode: IDBTransactionMode) =>
		db.transaction('blocks', mode, { durability: 'relaxed' });
	return {
		async open() {
			const request = indexedDB.open(NAME, 1);
			request.onupgradeneeded = () => request.result.createObjectStore('blocks');
			await done(request);
			db = request.result;
		},
		async write(key, bytes) {
			const write = transaction('readwrite');
			write.objectStore('blocks').put(asBlob ? new Blob([bytes]) : bytes.buffer, key);
			await done(write);
		},
		async read(key) {
			const read = transaction('readonly');
			const request = read.objectStore('blocks').get(key);
			await done(request);
			const value = request.result as ArrayBuffer | Blob | undefined;
			if (!value) throw new Error(`IndexedDB lost ${key}`);
			return value instanceof Blob ? value.arrayBuffer() : value;
		},
		async remove(key) {
			const remove = transaction('readwrite');
			remove.objectStore('blocks').delete(key);
			await done(remove);
		},
		async close() {
			db.close();
			await done(indexedDB.deleteDatabase(NAME));
		},
	};
}

function opfsStore(sync: boolean): Store {
	let folder: FileSystemDirectoryHandle;
	return {
		async open() {
			const root = await navigator.storage.getDirectory();
			folder = await root.getDirectoryHandle(NAME, { create: true });
		},
		async write(key, bytes) {
			const file = await folder.getFileHandle(key, { create: true });
			if (sync) {
				const handle = await syncHandle(file);
				handle.truncate(0);
				handle.write(bytes, { at: 0 });
				handle.flush();
				handle.close();
			} else {
				const writable = await file.createWritable();
				await writable.write(bytes);
				await writable.close();
			}
		},
		async read(key) {
			const file = await folder.getFileHandle(key);
			if (!sync) return (await file.getFile()).arrayBuffer();
			const handle = await syncHandle(file);
			const bytes = new Uint8Array(handle.getSize());
			handle.read(bytes, { at: 0 });
			handle.close();
			return bytes.buffer;
		},
		async remove(key) {
			await folder.removeEntry(key);
		},
		async close() {
			await (await navigator.storage.getDirectory()).removeEntry(NAME, { recursive: true });
		},
	};
}

const STORES: Record<StoreName, () => Store> = {
	cache: cacheStore,
	idb: () => idbStore(false),
	'idb-blob': () => idbStore(true),
	'opfs-sync': () => opfsStore(true),
	opfs: () => opfsStore(false),
};

/** A block of random bytes, so no store can compress it. */
function block(mib: number): Bytes {
	const bytes = new Uint8Array(mib * 2 ** 20);
	const step = 65536;
	for (let at = 0; at < bytes.length; at += step)
		crypto.getRandomValues(bytes.subarray(at, at + step));
	return bytes;
}

/** A 32-bit hash of a block's words, as a check of every byte on read would cost. */
function wordHash(bytes: ArrayBuffer): number {
	const words = new Uint32Array(bytes, 0, bytes.byteLength >>> 2);
	let hash = 0x811c9dc5;
	for (let k = 0; k < words.length; k++) hash = Math.imul(hash ^ (words[k] as number), 0x01000193);
	return hash >>> 0;
}

/** True when two blocks hold the same bytes, read a word at a time. */
function same(a: Uint8Array, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const x = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >>> 2);
	const y = new Uint32Array(b, 0, b.byteLength >>> 2);
	for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
	return true;
}

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);
const step = (text: string) => post({ step: text });

async function timeStore(name: StoreName, blocks: Bytes[]): Promise<StoreTimes> {
	const store = STORES[name]();
	try {
		const opened = performance.now();
		await store.open();
		const openMs = performance.now() - opened;
		const sizes: SizeTimes[] = [];
		for (const [index, mib] of SIZES_MIB.entries()) {
			const bytes = blocks[index] as Bytes;
			const times: SizeTimes = { mib, writeMs: [], readMs: [], ok: true };
			for (let k = 0; k < REPEATS; k++) {
				const key = `block-${mib}-${k}`;
				step(`${name}: ${mib} MiB, try ${k + 1}`);
				let at = performance.now();
				await store.write(key, bytes);
				times.writeMs.push(performance.now() - at);
				at = performance.now();
				const back = await store.read(key);
				times.readMs.push(performance.now() - at);
				if (!same(bytes, back)) times.ok = false;
				await store.remove(key);
			}
			sizes.push(times);
		}
		step(`${name}: ${BATCH} blocks at once`);
		const one = blocks[0] as Bytes;
		const keys = Array.from({ length: BATCH }, (_, k) => `batch-${k}`);
		let at = performance.now();
		await Promise.all(keys.map((key) => store.write(key, one)));
		const writeMs = performance.now() - at;
		at = performance.now();
		const back = await Promise.all(keys.map((key) => store.read(key)));
		const readMs = performance.now() - at;
		const ok = back.every((bytes) => same(one, bytes));
		await Promise.all(keys.map((key) => store.remove(key)));
		await store.close();
		return { store: name, openMs, sizes, batch: { writeMs, readMs, ok } };
	} catch (thrown) {
		await store.close().catch(() => {});
		return {
			store: name,
			error: thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown),
		};
	}
}

/** The milliseconds of each hash of each block size. */
async function timeHashes(blocks: Bytes[]) {
	const rows = [];
	for (const [index, mib] of SIZES_MIB.entries()) {
		const bytes = blocks[index] as Bytes;
		const sha256Ms: number[] = [];
		const wordMs: number[] = [];
		for (let k = 0; k < REPEATS; k++) {
			let at = performance.now();
			await crypto.subtle.digest('SHA-256', bytes);
			sha256Ms.push(performance.now() - at);
			at = performance.now();
			wordHash(bytes.buffer as ArrayBuffer);
			wordMs.push(performance.now() - at);
		}
		rows.push({ mib, sha256Ms, wordMs });
	}
	return rows;
}

async function estimate() {
	try {
		const { quota, usage } = await navigator.storage.estimate();
		return { quota, usage };
	} catch (thrown) {
		return { error: String(thrown) };
	}
}

self.onmessage = async (event: MessageEvent<{ stores: StoreName[] }>) => {
	try {
		step('making the blocks');
		const blocks = SIZES_MIB.map(block);
		const before = await estimate();
		const stores: StoreTimes[] = [];
		for (const name of event.data.stores) stores.push(await timeStore(name, blocks));
		step('timing the hashes');
		const hashes = await timeHashes(blocks);
		post({
			result: { estimate: before, stores, hashes, crossOriginIsolated: self.crossOriginIsolated },
		});
	} catch (thrown) {
		post({ error: thrown instanceof Error ? thrown.message : String(thrown) });
	}
};

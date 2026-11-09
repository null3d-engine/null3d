// The cache of derived data across visits: bytes that a load makes from its inputs, such as the
// texels that the KTX2 transcoder writes or a plant that an add-on grows, kept in the browser's
// storage so that a later visit reads them back instead of making them again.
//
// Each producer registers a namespace: its name and the version of the bytes it makes. An entry's
// key names its inputs by their content, such as a hash of a file's bytes, so a cached entry is
// never stale. A namespace keeps one version: registering a version deletes the entries of every
// other version of the same name, and an engine whose entry layout changed deletes the old layout's
// entries with their folder.
//
// The entries live in the origin private file system, one file per entry under a folder per
// namespace and version. On the device measurements of the store (D-311) it reads a scene's batch
// of small entries and a large entry fastest from a worker, through the file's sync access handle.
// The main thread has no sync handles, so there the cache reads each file whole. Writes go through
// the file's writable stream, which works off the thread, so they never stall the sketch, and which
// replaces the file only when it closes, so a reader never sees half an entry.
//
// Every entry starts with a header: a mark, the hour it was last written or used, its length, a
// check of its bytes and its key. A read that finds another key, length or check misses, so a
// damaged entry or one whose file name two keys share is made again and written over. The check
// samples the bytes at a fixed number of places: a hash of every byte would cost more than the
// read itself on Apple's devices.
//
// All namespaces share one budget, a share of the storage that the browser reports it allows the
// origin. When writes end and the origin uses more than the budget, the cache deletes the entries
// that were used longest ago until the rest fit. A hit refreshes its entry's hour when that is a day
// old, so an entry in use stays.
//
// Every step may fail: a page outside a secure context has no file system, a private window may
// refuse it, storage can be full, another tab can hold a file, and the browser can delete the
// origin's storage under pressure. Each failure is a miss, or a write that does not happen, and the
// load makes its data as it would without the cache. Opening the storage has a time limit, so a
// browser that never answers costs one wait per thread. Writes start after the call that asks for
// them returns, and wait in memory up to a limit; a write past it is dropped.
//
// This module imports no engine module, so the loaders that use it keep it in their own files.

/**
 * A namespace of the cache of derived data, which `assets.cache` gives: bytes by key, kept in the
 * browser's storage across visits. Keys name the inputs that the bytes were made from, such as a
 * hash of a file's content, so an entry never goes stale. The calls never reject: a miss, a failed
 * read, a refused write, a full disk or a page with the cache off all mean no entry, and the caller
 * makes its data again.
 *
 * @category api/assets
 */
export interface DerivedCache {
	/** The producer's name, such as an add-on's package name. */
	readonly name: string;
	/** The version of the bytes that the producer makes. Another version starts empty. */
	readonly version: string;
	/** The bytes kept under a key, after a check that they are whole, or undefined. */
	get(key: string): Promise<Uint8Array | undefined>;
	/**
	 * Keeps bytes under a key. The write starts after the call returns, so it never delays the
	 * caller, and the promise resolves when it ends or is dropped. The cache reads the bytes when it
	 * writes them, so leave them unchanged until then.
	 */
	put(key: string, bytes: Uint8Array): Promise<void>;
}

/** The layout of the entries and their folders. A new layout deletes the folders of older ones. */
const LAYOUT = 1;
/** The start of the root folder's name of every layout. */
const ROOT_PREFIX = 'null3d-derived-';
const ROOT = `${ROOT_PREFIX}${LAYOUT}`;
/** The start of the names of an older store, which the cache deletes when it opens. */
const OLD_CACHE_PREFIX = 'null3d-ktx2-';

/** The share of the storage that the browser allows the origin that the cache may take. */
export const BUDGET_SHARE = 0.1;
/** The cache's budget in bytes for the storage that the browser allows the origin. */
const budgetOf = (quota: number) => Math.floor(quota * BUDGET_SHARE);
/** How long the cache waits for the storage to open before it works without it on this thread. */
export const OPEN_LIMIT_MS = 2000;
/**
 * The most bytes that wait to be written at once. A write that would pass it is dropped, so a page
 * that makes much data at once holds no more than this in second copies.
 */
export const WRITING_MAX_BYTES = 128 * 2 ** 20;
/** The writes that run at once. */
const WRITERS = 4;
/** How old an entry's hour must be, in hours, before a hit writes the hour again. */
const TOUCH_HOURS = 24;

/** The first word of every entry. */
const MARK = 0x4e334443;
/** The header's words before the key: the mark, the hour, the length, the check, the key's length. */
const HEAD_WORDS = 5;
const HEAD_BYTES = HEAD_WORDS * 4;
const HOUR_AT = 4;

/** The size of the whole file of an entry whose header's words are `head`. */
const entrySize = (head: DataView) =>
	HEAD_BYTES + head.getUint32(16, true) + head.getUint32(8, true);

/** The bytes that the check samples, at evenly spaced places. */
const CHECK_SAMPLES = 1024;

/** A file's sync access handle, which only dedicated workers have. */
interface SyncHandle {
	getSize(): number;
	read(buffer: Uint8Array, options: { at: number }): number;
	write(buffer: Uint8Array, options: { at: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
}

type SyncFile = FileSystemFileHandle & {
	createSyncAccessHandle(options?: { mode?: 'read-only' | 'readwrite' }): Promise<SyncHandle>;
};

/** The browser's parts that the cache uses, which tests replace. */
export interface StorageHost {
	/** The origin private file system's root folder. */
	root(): Promise<FileSystemDirectoryHandle>;
	/** The storage that the browser allows the origin, and what the origin uses, in bytes. */
	estimate(): Promise<{ quota?: number; usage?: number }>;
	/** True where files have sync access handles: in a dedicated worker. */
	sync: boolean;
	/** The browser's Cache Storage, where an older store may have left entries. */
	caches?: CacheStorage;
	/** The time in milliseconds since 1970. */
	now(): number;
}

/** The browser's storage, or undefined where the page has no origin private file system. */
function browserHost(): StorageHost | undefined {
	const storage = globalThis.navigator?.storage;
	if (typeof storage?.getDirectory !== 'function') return undefined;
	const file = (globalThis as { FileSystemFileHandle?: { prototype: object } })
		.FileSystemFileHandle;
	return {
		root: () => storage.getDirectory(),
		estimate: () => storage.estimate(),
		sync: !!file && 'createSyncAccessHandle' in file.prototype,
		caches: globalThis.caches,
		now: () => Date.now(),
	};
}

/** A name that a folder may take: the text with every character that a file name may not hold escaped. */
const folderName = (text: string) => encodeURIComponent(text).replaceAll('.', '%2E');

/**
 * An entry's file name: a 64-bit hash of its key, as 16 hex digits. The header holds the whole key,
 * so two keys of one name never read each other's bytes.
 */
export function entryName(key: string): string {
	let a = 0x811c9dc5;
	let b = 0x9747b28c;
	for (let k = 0; k < key.length; k++) {
		const code = key.charCodeAt(k);
		a = Math.imul(a ^ code, 0x01000193);
		b = Math.imul(b ^ code, 0x5bd1e995);
		b ^= b >>> 15;
	}
	return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** A check of `bytes`: a hash of their length and of bytes at evenly spaced places. */
export function checkOf(bytes: Uint8Array): number {
	const length = bytes.length;
	let hash = Math.imul(0x811c9dc5 ^ length, 0x01000193);
	const samples = Math.min(length, CHECK_SAMPLES);
	for (let k = 0; k < samples; k++) {
		const at = samples === length ? k : Math.floor(((k + 0.5) * length) / samples);
		hash = Math.imul(hash ^ (bytes[at] as number), 0x01000193);
	}
	if (length > 0) hash = Math.imul(hash ^ (bytes[length - 1] as number), 0x01000193);
	return hash >>> 0;
}

const encoder = new TextEncoder();

/** The header of an entry of `bytes` under `key`, last used at `hour`. */
export function entryHead(key: string, bytes: Uint8Array, hour: number): Uint8Array {
	const name = encoder.encode(key);
	const head = new Uint8Array(HEAD_BYTES + name.length);
	const words = new DataView(head.buffer);
	words.setUint32(0, MARK, true);
	words.setUint32(HOUR_AT, hour, true);
	words.setUint32(8, bytes.length, true);
	words.setUint32(12, checkOf(bytes), true);
	words.setUint32(16, name.length, true);
	head.set(name, HEAD_BYTES);
	return head;
}

/**
 * The bytes of an entry's file whose header names `key` and passes its check, as a view of the
 * file's bytes, with the hour of its last use. Undefined for any other file.
 */
export function readEntry(
	file: Uint8Array,
	key: string,
): { bytes: Uint8Array; hour: number } | undefined {
	if (file.length < HEAD_BYTES) return undefined;
	const words = new DataView(file.buffer, file.byteOffset, HEAD_BYTES);
	if (words.getUint32(0, true) !== MARK) return undefined;
	const name = encoder.encode(key);
	const start = HEAD_BYTES + words.getUint32(16, true);
	if (start !== HEAD_BYTES + name.length || file.length !== entrySize(words)) return undefined;
	for (let k = 0; k < name.length; k++) if (file[HEAD_BYTES + k] !== name[k]) return undefined;
	const bytes = file.subarray(start);
	if (checkOf(bytes) !== words.getUint32(12, true)) return undefined;
	return { bytes, hour: words.getUint32(HOUR_AT, true) };
}

/** Resolves to `promise`'s value, or to undefined once `ms` milliseconds pass first. */
function withinTime<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(undefined), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(undefined);
			},
		);
	});
}

/** A write that waits: its folder, its file's name, and the entry's header and bytes. */
interface Write {
	folder: FileSystemDirectoryHandle;
	name: string;
	head: Uint8Array;
	bytes: Uint8Array;
	done(): void;
}

/** One entry's file, as the budget's trim reads it. */
interface Listed {
	folder: FileSystemDirectoryHandle;
	name: string;
	size: number;
	hour: number;
}

/**
 * The cache of one thread. It opens the storage on the first call that needs it, and deletes the
 * folders of older layouts then.
 */
export class DerivedStore {
	private opened: Promise<FileSystemDirectoryHandle | undefined> | undefined;
	private readonly folders = new Map<string, Promise<FileSystemDirectoryHandle | undefined>>();
	private readonly namespaces = new Map<string, DerivedCache>();
	/** Reads under way, by namespace and key, which reads of the same entry at once share. */
	private readonly reads = new Map<string, Promise<Uint8Array | undefined>>();
	private readonly queue: Write[] = [];
	/** Bytes that waiting and running writes hold. */
	private writing = 0;
	/** Writes under way. The last one to end keeps the cache within its budget. */
	private running = 0;
	/** The cache's budget in bytes, once the browser's estimate has come. */
	private budget: number | undefined;
	/** The trim under way, or the last one. */
	private trimming = Promise.resolve();

	constructor(
		private readonly host: StorageHost | undefined = browserHost(),
		private readonly limits = { openMs: OPEN_LIMIT_MS, writingMaxBytes: WRITING_MAX_BYTES },
	) {}

	/**
	 * The namespace `name` at `version`. A namespace that the switch turns off keeps nothing. The
	 * first one of a name deletes the entries of the name's other versions.
	 */
	namespace(name: string, version: string, on = true): DerivedCache {
		const id = `${on}\n${name}\n${version}`;
		let namespace = this.namespaces.get(id);
		if (!namespace) {
			namespace =
				on && this.host
					? this.makeNamespace(name, version)
					: { name, version, get: async () => undefined, put: async () => {} };
			this.namespaces.set(id, namespace);
		}
		return namespace;
	}

	private makeNamespace(name: string, version: string): DerivedCache {
		const folder = () => this.folder(name, version);
		return {
			name,
			version,
			get: async (key) => {
				// Safari and Firefox let one reader at a time hold a file, so a second read of the
				// same entry at once would miss: it shares the first, with a copy of its bytes.
				const id = `${name}\n${version}\n${key}`;
				const reading = this.reads.get(id);
				if (reading) return (await reading)?.slice();
				const read = folder().then((at) => at && this.read(at, key));
				this.reads.set(id, read);
				try {
					return await read;
				} finally {
					this.reads.delete(id);
				}
			},
			put: (key, bytes) =>
				new Promise<void>((done) => {
					const size = bytes.length;
					if (this.writing + size > this.limits.writingMaxBytes || size > (this.budget ?? size)) {
						done();
						return;
					}
					this.writing += size;
					// The header samples the bytes now; the write itself waits for the queue.
					const head = entryHead(key, bytes, this.hour());
					void folder().then((at) => {
						if (!at) {
							this.writing -= size;
							done();
							return;
						}
						this.queue.push({ folder: at, name: entryName(key), head, bytes, done });
						setTimeout(() => this.drain(), 0);
					});
				}),
		};
	}

	/** The hours since 1970, which entries keep as the time of their last use. */
	private hour(): number {
		return Math.floor((this.host as StorageHost).now() / 3_600_000);
	}

	/** Opens the root folder once, or gives undefined where the storage refuses or does not answer. */
	private open(): Promise<FileSystemDirectoryHandle | undefined> {
		this.opened ??= (async () => {
			const host = this.host as StorageHost;
			const opening = host.root().then((root) => root.getDirectoryHandle(ROOT, { create: true }));
			const root = await withinTime(opening, this.limits.openMs);
			if (!root) return undefined;
			void host.estimate().then(
				({ quota }) => {
					if (quota) this.budget = budgetOf(quota);
				},
				() => {},
			);
			void this.dropOlderLayouts();
			return root;
		})();
		return this.opened;
	}

	/** The folder of a namespace's version, which the first call makes and clears of other versions. */
	private folder(name: string, version: string): Promise<FileSystemDirectoryHandle | undefined> {
		const id = `${name}\n${version}`;
		let folder = this.folders.get(id);
		if (!folder) {
			folder = (async () => {
				try {
					const root = await this.open();
					if (!root) return undefined;
					const own = await root.getDirectoryHandle(folderName(name), { create: true });
					const at = await own.getDirectoryHandle(folderName(version), { create: true });
					void this.dropOtherVersions(own, folderName(version));
					return at;
				} catch {
					return undefined;
				}
			})();
			this.folders.set(id, folder);
		}
		return folder;
	}

	/** An entry's bytes, or undefined on a miss, a failed read or a failed check. */
	private async read(
		folder: FileSystemDirectoryHandle,
		key: string,
	): Promise<Uint8Array | undefined> {
		const name = entryName(key);
		try {
			const handle = await folder.getFileHandle(name);
			let file: Uint8Array;
			if (this.host?.sync) {
				const access = await (handle as SyncFile).createSyncAccessHandle({ mode: 'read-only' });
				try {
					file = new Uint8Array(access.getSize());
					access.read(file, { at: 0 });
				} finally {
					access.close();
				}
			} else file = new Uint8Array(await (await handle.getFile()).arrayBuffer());
			const entry = readEntry(file, key);
			if (!entry) return undefined;
			if (this.hour() - entry.hour >= TOUCH_HOURS) setTimeout(() => this.touch(handle), 0);
			return entry.bytes;
		} catch {
			return undefined;
		}
	}

	/** Writes the hour of an entry's use again, where the thread has sync handles. */
	private async touch(handle: FileSystemFileHandle): Promise<void> {
		if (!this.host?.sync) return;
		try {
			const access = await (handle as SyncFile).createSyncAccessHandle();
			try {
				const word = new Uint8Array(4);
				new DataView(word.buffer).setUint32(0, this.hour(), true);
				access.write(word, { at: HOUR_AT });
			} finally {
				access.close();
			}
		} catch {
			// Another tab holds the file, or it is gone: the hour stays.
		}
	}

	/** Starts the waiting writes, a few at a time. */
	private drain(): void {
		while (this.running < WRITERS && this.queue.length > 0) {
			const write = this.queue.shift() as Write;
			this.running++;
			void this.write(write).finally(() => {
				this.writing -= write.bytes.length;
				this.running--;
				write.done();
				if (this.queue.length > 0) this.drain();
				else if (this.running === 0) void this.trim();
			});
		}
	}

	/** Writes one entry's file whole, through a writable stream or, without one, a sync handle. */
	private async write({ folder, name, head, bytes }: Write): Promise<void> {
		try {
			const handle = await folder.getFileHandle(name, { create: true });
			if (typeof handle.createWritable === 'function') {
				const stream = await handle.createWritable();
				try {
					await stream.write(head as Uint8Array<ArrayBuffer>);
					await stream.write(bytes as Uint8Array<ArrayBuffer>);
					await stream.close();
				} catch (thrown) {
					await stream.abort().catch(() => {});
					throw thrown;
				}
			} else if (this.host?.sync) {
				const access = await (handle as SyncFile).createSyncAccessHandle();
				try {
					access.truncate(0);
					access.write(head, { at: 0 });
					access.write(bytes, { at: head.length });
					access.flush();
				} finally {
					access.close();
				}
			}
		} catch {
			// A full disk or a file that another tab holds: the entry is made again next time.
		}
	}

	/**
	 * Deletes the entries used longest ago, of every namespace, until the rest fit in the budget.
	 * Trims run one after another, so two never count the same deleted entry.
	 */
	trim(): Promise<void> {
		this.trimming = this.trimming.then(() => this.trimNow());
		return this.trimming;
	}

	/**
	 * One trim. The browser's figure of what the origin uses holds the cache and the page's own
	 * storage, so a figure within the budget needs no list of the entries.
	 */
	private async trimNow(): Promise<void> {
		try {
			const root = await this.open();
			const host = this.host as StorageHost;
			if (!root) return;
			const { quota, usage } = await host.estimate();
			if (!quota || usage === undefined) return;
			const budget = budgetOf(quota);
			this.budget = budget;
			if (usage <= budget) return;
			const entries = await listEntries(root);
			let total = entries.reduce((sum, { size }) => sum + size, 0);
			entries.sort((a, b) => a.hour - b.hour);
			for (const { folder, name, size } of entries) {
				if (total <= budget) break;
				try {
					await folder.removeEntry(name);
					total -= size;
				} catch {
					// Another tab holds the file: the next trim tries again.
				}
			}
		} catch {
			// The storage went away: there is nothing to trim.
		}
	}

	/** Deletes the folders of older layouts, and the caches of an older store. */
	private async dropOlderLayouts(): Promise<void> {
		const host = this.host as StorageHost;
		try {
			const root = await host.root();
			for await (const name of root.keys())
				if (name.startsWith(ROOT_PREFIX) && name !== ROOT)
					await root.removeEntry(name, { recursive: true });
		} catch {
			// A folder that stays is only space; the next start tries again.
		}
		try {
			for (const name of (await host.caches?.keys()) ?? [])
				if (name.startsWith(OLD_CACHE_PREFIX)) await host.caches?.delete(name);
		} catch {
			// As above.
		}
	}

	/** Deletes the folders of a namespace's versions but `keep`. */
	private async dropOtherVersions(own: FileSystemDirectoryHandle, keep: string): Promise<void> {
		try {
			for await (const name of own.keys())
				if (name !== keep) await own.removeEntry(name, { recursive: true });
		} catch {
			// As above.
		}
	}
}

/** A file's size, and its header's words where the file is long enough to hold them. */
async function fileHead(handle: FileSystemFileHandle): Promise<{ size: number; head?: DataView }> {
	const file = await handle.getFile();
	if (file.size < HEAD_BYTES) return { size: file.size };
	return { size: file.size, head: new DataView(await file.slice(0, HEAD_BYTES).arrayBuffer()) };
}

/** Every entry's file under the root, with its size and the hour of its last use. */
async function listEntries(root: FileSystemDirectoryHandle): Promise<Listed[]> {
	const listed: Listed[] = [];
	for await (const own of root.values()) {
		if (own.kind !== 'directory') continue;
		for await (const version of (own as FileSystemDirectoryHandle).values()) {
			if (version.kind !== 'directory') continue;
			const folder = version as FileSystemDirectoryHandle;
			for await (const entry of folder.values()) {
				if (entry.kind !== 'file') continue;
				try {
					const { size, head } = await fileHead(entry as FileSystemFileHandle);
					listed.push({
						folder,
						name: entry.name,
						size,
						hour: head?.getUint32(HOUR_AT, true) ?? 0,
					});
				} catch {
					// A file that another tab writes: the next trim reads it.
				}
			}
		}
	}
	return listed;
}

/** This thread's cache, which opens with the first namespace that reads or writes. */
let store: DerivedStore | undefined;

/**
 * The namespace `name` at `version` of this thread's cache of derived data. With `on` false, the
 * page switch's answer, it keeps nothing.
 */
export function derivedCache(name: string, version: string, on: boolean): DerivedCache {
	store ??= new DerivedStore();
	return store.namespace(name, version, on);
}

/**
 * The whole entries of a namespace's version, for test pages: how many files the storage holds
 * whose header gives the file's own size, or null where the page has no origin private file system.
 * A write makes its file before its bytes land, so a file that a write has not closed yet, or that
 * a stopped engine left empty, is no entry.
 */
export async function derivedEntries(
	name: string,
	version: string,
	host: StorageHost | undefined = browserHost(),
): Promise<number | null> {
	if (!host) return null;
	try {
		const root = await (await host.root()).getDirectoryHandle(ROOT);
		const own = await root.getDirectoryHandle(folderName(name));
		const folder = await own.getDirectoryHandle(folderName(version));
		let count = 0;
		for await (const entry of folder.values()) {
			if (entry.kind !== 'file' || !/^[0-9a-f]{16}$/.test(entry.name)) continue;
			const { size, head } = await fileHead(entry as FileSystemFileHandle);
			if (head && head.getUint32(0, true) === MARK && size === entrySize(head)) count++;
		}
		return count;
	} catch {
		return 0;
	}
}

/** Deletes every entry of the cache of derived data, for test pages that start as a first visit. */
export async function clearDerivedCache(): Promise<void> {
	const host = browserHost();
	try {
		await (await host?.root())?.removeEntry(ROOT, { recursive: true });
	} catch {
		// Nothing to delete.
	}
}

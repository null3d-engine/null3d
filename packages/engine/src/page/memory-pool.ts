// Keeps the shared memory of threaded engines that stopped cleanly, for the next engine that the
// page starts. Safari gives each of the first 8 WebAssembly memories of a page a large range of
// address space, and refuses a new memory while a dropped one still holds its range, for as long
// as the page keeps asking. An engine that takes a kept memory asks the browser for none (D-98).

/** WebAssembly memory comes in pages of 64 KiB. */
const PAGE_BYTES = 65_536;
/** The most memories that the pool keeps: the oldest goes when a stop would keep one more. */
export const POOL_SIZE = 2;
/** How long the pool keeps a memory for a new engine, in ms, before it lets the browser free it. */
export const KEEP_MS = 30_000;

/** What a memory is for: the core file that runs in it, and its declared maximum in pages. */
export interface MemoryKey {
	core: string;
	maximum: number;
}

interface Kept extends MemoryKey {
	memory: WebAssembly.Memory;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * The pool lives on the page's global object, so that a new copy of the engine's code, such as one
 * that a hot reload brings, finds the memories that the copy before it kept.
 */
const POOL_SLOT = Symbol.for('null3d.memory-pool');

function pool(): Kept[] {
	const slots = globalThis as Record<symbol, Kept[] | undefined>;
	slots[POOL_SLOT] ??= [];
	return slots[POOL_SLOT];
}

function drop(entry: Kept): void {
	clearTimeout(entry.timer);
	const kept = pool();
	const index = kept.indexOf(entry);
	if (index >= 0) kept.splice(index, 1);
}

/**
 * Keeps the memory of an engine whose threads have all left it, for `keepMs`. Only an engine with
 * the same core and maximum can take it. The pool lets go of it when the page goes away too: a
 * frame that its page removes runs no more timers, and Safari can keep a removed frame's page, and
 * all that it reaches, for minutes (D-92).
 */
export function keepMemory(memory: WebAssembly.Memory, key: MemoryKey, keepMs = KEEP_MS): void {
	const kept = pool();
	if (kept.some((entry) => entry.memory === memory)) return;
	globalThis.addEventListener?.('pagehide', releaseMemories);
	const entry: Kept = { ...key, memory, timer: setTimeout(() => drop(entry), keepMs) };
	kept.push(entry);
	while (kept.length > POOL_SIZE) drop(kept[0] as Kept);
}

/**
 * Takes a kept memory for a new engine, or none when no memory has the same core and maximum. The
 * memory's first `initialPages`, where the core keeps its data and stacks, are cleared, so the core
 * sets them up as in a new memory. The core's heap clears the pages above them when it takes them.
 */
export function takeMemory(key: MemoryKey, initialPages: number): WebAssembly.Memory | undefined {
	const bytes = initialPages * PAGE_BYTES;
	const entry = pool().find(
		(kept) =>
			kept.core === key.core &&
			kept.maximum === key.maximum &&
			kept.memory.buffer.byteLength >= bytes,
	);
	if (!entry) return undefined;
	drop(entry);
	new Uint8Array(entry.memory.buffer, 0, bytes).fill(0);
	return entry.memory;
}

/** Lets the browser free every memory that the pool keeps. */
export function releaseMemories(): void {
	for (const entry of [...pool()]) drop(entry);
}

/** The memories that the pool keeps now. */
export function keptMemories(): number {
	return pool().length;
}

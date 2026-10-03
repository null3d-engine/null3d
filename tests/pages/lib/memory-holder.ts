// A worker that holds a shared WebAssembly memory in one of the ways the engine's threads do, until
// the page stops it. It idles; it keeps an Atomics.waitAsync pending; it blocks in Atomics.wait or
// inside WebAssembly in memory.atomic.wait32; it runs a WebAssembly instance that imports the memory
// and then idles; it blocks in one of the two waits until the page wakes it, and then idles; it
// keeps the engine core's compiled module; it starts the engine core with the memory, as each of
// the engine's workers does, and then idles; or it grows the memory, after it starts the core or
// without it, and then idles. It signals the page in a separate small buffer: once
// it holds the memory that way, and once a wait it was woken from has returned.
import { startCore } from '@null3d/engine/internal';

export type HoldKind =
	| 'idle'
	| 'async-wait'
	| 'blocking-wait'
	| 'wasm-wait'
	| 'instance'
	| 'woken-wait'
	| 'woken-wasm-wait'
	| 'module'
	| 'core'
	| 'grown'
	| 'grown-core';

/** Holds that the page ends by waking the worker's wait before it stops the worker. */
export const WOKEN_KINDS: readonly HoldKind[] = ['woken-wait', 'woken-wasm-wait'];
/** Holds that need the engine core's compiled module. */
export const CORE_KINDS: readonly HoldKind[] = ['module', 'core', 'grown-core'];
/** How much a growing hold grows the memory, in 64 KiB pages: as much as the engine's start does. */
const GROWTH_PAGES = 400;

export interface HoldMessage {
	memory: WebAssembly.Memory;
	/** Two words: set once the worker holds the memory, and once a woken wait has returned. */
	flags: SharedArrayBuffer;
	kind: HoldKind;
	module?: WebAssembly.Module;
}

/**
 * A module that imports a shared memory and exports `wait`: memory.atomic.wait32 on address 0, for
 * the value 0, with no time limit.
 */
const WAIT_MODULE = new Uint8Array([
	0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x02,
	0x12, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x03, 0x01,
	0x80, 0x80, 0x04, 0x03, 0x02, 0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x77, 0x61, 0x69, 0x74, 0x00,
	0x00, 0x0a, 0x0e, 0x01, 0x0c, 0x00, 0x41, 0x00, 0x41, 0x00, 0x42, 0x7f, 0xfe, 0x01, 0x02, 0x00,
	0x0b,
]);

/**
 * Holds the memory that the page sends. Only a worker listens: the page imports this file for its
 * kinds, and a handler on the page's window would hear every message that a frame posts.
 */
const hold = async ({ data }: MessageEvent<HoldMessage>) => {
	const words = new Int32Array(data.memory.buffer);
	const flags = new Int32Array(data.flags);
	const ready = () => Atomics.store(flags, 0, 1);
	const woken = () => Atomics.store(flags, 1, 1);
	const instantiate = async () =>
		(await WebAssembly.instantiate(WAIT_MODULE, { env: { memory: data.memory } })).instance.exports
			.wait as () => number;
	switch (data.kind) {
		case 'idle':
		case 'module':
			ready();
			break;
		case 'async-wait':
			void Atomics.waitAsync(words, 0, 0).value;
			ready();
			break;
		case 'blocking-wait':
		case 'woken-wait':
			ready();
			Atomics.wait(words, 0, 0);
			woken();
			break;
		case 'wasm-wait':
		case 'woken-wasm-wait': {
			const wait = await instantiate();
			ready();
			wait();
			woken();
			break;
		}
		case 'instance':
			await instantiate();
			ready();
			break;
		case 'core':
			await startCore('threaded', data.module as WebAssembly.Module, data.memory);
			ready();
			break;
		case 'grown':
			data.memory.grow(GROWTH_PAGES);
			ready();
			break;
		case 'grown-core':
			await startCore('threaded', data.module as WebAssembly.Module, data.memory);
			data.memory.grow(GROWTH_PAGES);
			ready();
			break;
	}
};

if (!('document' in globalThis)) self.onmessage = hold;

// The engine's worker starter wraps the thread's `Worker` for the length of one start, so that the
// worker's script goes through the bootstrap module where the script's origin needs it. A thread can
// change its `Worker` between starts, and each start then reaches the class the thread holds.
import { describe, expect, test } from 'bun:test';
import type { WasmError } from './wasm';
import { spawnWorker } from './worker-start';

const error: WasmError = (code, message) => new Error(`${code}: ${message}`) as never;

describe('spawnWorker', () => {
	test('starts each worker through the Worker that the thread holds at that start', () => {
		const Native = globalThis.Worker;
		const made: string[] = [];
		/** Stands in for the thread's `Worker`, and notes the script that a start asked for. */
		const standIn = (name: string) =>
			class {
				constructor(script: string | URL) {
					made.push(`${name} ${String(script)}`);
				}
			} as unknown as typeof Worker;
		try {
			globalThis.Worker = standIn('first');
			spawnWorker(() => new Worker('file:///first.js'), error);
			globalThis.Worker = standIn('second');
			spawnWorker(() => new Worker('file:///second.js'), error);
		} finally {
			globalThis.Worker = Native;
		}
		expect(made).toEqual(['first file:///first.js', 'second file:///second.js']);
	});
});

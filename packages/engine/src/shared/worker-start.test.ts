// The engine's worker starter wraps the thread's `Worker` for the length of one start, so that the
// worker's script goes through the bootstrap module where the script's origin needs it. A thread can
// change its `Worker` between starts, and each start then reaches the class the thread holds. A
// thread can also read the script of a worker that it starts later, without starting one.
import { describe, expect, test } from 'bun:test';
import type { WasmError } from './wasm';
import { spawnWorker, watchWorkerError, workerScriptOf } from './worker-start';

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

describe('workerScriptOf', () => {
	test('reads the script of a start without starting a worker, and gives the thread its Worker back', () => {
		const Native = globalThis.Worker;
		let started = 0;
		try {
			globalThis.Worker = class {
				constructor() {
					started++;
				}
			} as unknown as typeof Worker;
			const Own = globalThis.Worker;
			const script = workerScriptOf(
				() => new Worker(new URL('file:///workers/job.js'), { type: 'module', name: 'job' }),
			);
			expect(script?.href).toBe('file:///workers/job.js');
			expect(started).toBe(0);
			expect(globalThis.Worker).toBe(Own);
			expect(
				workerScriptOf(() => {
					throw new Error('no worker here');
				}),
			).toBeUndefined();
			expect(globalThis.Worker).toBe(Own);
		} finally {
			globalThis.Worker = Native;
		}
	});
});

describe('watchWorkerError', () => {
	/** A worker stand-in that a test fires an error event at. */
	const worker = () => new EventTarget() as unknown as Worker;

	test('hears a plain error event, which a script that did not load sends, with no message', () => {
		const messages: string[] = [];
		const target = worker();
		watchWorkerError(target, (message) => messages.push(message));
		target.dispatchEvent(new Event('error'));
		expect(messages).toEqual(['']);
	});

	test('reports the message of a worker that threw', () => {
		const messages: string[] = [];
		const target = worker();
		watchWorkerError(target, (message) => messages.push(message));
		const event = new Event('error');
		Object.defineProperty(event, 'message', { value: 'boom' });
		target.dispatchEvent(event);
		expect(messages).toEqual(['boom']);
	});

	test('stops listening once the returned function runs', () => {
		const messages: string[] = [];
		const target = worker();
		const remove = watchWorkerError(target, (message) => messages.push(message));
		remove();
		target.dispatchEvent(new Event('error'));
		expect(messages).toEqual([]);
	});
});

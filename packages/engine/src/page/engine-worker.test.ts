// How the page routes a worker's replies once the worker has started: a failure that the worker
// reports, or that ends it, reaches the page's failure handler, and a stop waits for the worker's
// answer.
import { beforeEach, expect, test } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { WorkerReply } from '../workers/protocol';
import { EngineWorker } from './engine';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A stand-in for a Worker that the test answers for. */
function fakeWorker() {
	const sent: unknown[] = [];
	const worker = {
		onmessage: null as ((event: MessageEvent<WorkerReply>) => void) | null,
		onerror: null as ((event: ErrorEvent) => void) | null,
		postMessage: (message: unknown) => sent.push(message),
		terminate: () => {},
	};
	const reply = (data: WorkerReply) => worker.onmessage?.({ data } as MessageEvent<WorkerReply>);
	return { worker: worker as unknown as Worker, reply, sent, raw: worker };
}

/** An engine worker whose failures the test collects, started with a ready reply. */
async function started(role = 'job 3') {
	const fake = fakeWorker();
	const failures: [EngineError, boolean | undefined][] = [];
	const engineWorker = new EngineWorker(fake.worker, role, {
		sketchMessage: () => {},
		failure: (error, endsStart) => failures.push([error, endsStart]),
		quality: () => {},
		stats: () => {},
		labelSlot: () => {},
		jobsWanted: () => {},
	});
	fake.reply({ type: 'ready', role: 'job', index: 3, threaded: true, version: 'test' });
	await engineWorker.ready();
	return { ...fake, engineWorker, failures };
}

test('a job worker that fails after its start reaches the failure handler as E1404', async () => {
	const { reply, failures, engineWorker } = await started();
	reply({ type: 'fault', role: 'job', index: 3, message: 'RuntimeError: unreachable' });
	expect(failures.map(([error]) => error.code)).toEqual(['E1404']);
	expect(failures[0]?.[0].message).toContain('the job 3 worker failed: RuntimeError: unreachable.');
	// The failed worker left the job system, so a stop does not wait for it.
	await engineWorker.stopped();
});

test('an error reply after the start, with no request waiting, is reported too', async () => {
	const { reply, failures } = await started('render');
	reply({ type: 'error', role: 'render', message: 'out of memory' });
	expect(failures.map(([error]) => error.code)).toEqual(['E1404']);
});

test('a GPU error is reported with its code, and does not end the start', async () => {
	const { reply, failures } = await started('render');
	reply({ type: 'gpu-error', role: 'render', outOfMemory: true, message: 'no room' });
	reply({ type: 'gpu-error', role: 'render', outOfMemory: false, message: 'too large' });
	expect(failures.map(([error, ends]) => [error.code, ends])).toEqual([
		['E1304', false],
		['E1305', false],
	]);
	expect(failures[1]?.[0].message).toContain(
		"the render worker's GPU rejected a command: too large.",
	);
});

test('a stop waits for the answer, and a clean answer lets the worker start again', async () => {
	const { reply, engineWorker, sent } = await started('render');
	const answered = engineWorker.stopDrawing();
	expect(sent).toEqual([{ type: 'stop-drawing' }]);
	expect(engineWorker.cleanStop).toBe(false);
	reply({ type: 'stopped', role: 'render' });
	await answered;
	expect(engineWorker.cleanStop).toBe(true);
});

test('a worker that ends with an error event is reported once it had started', async () => {
	const { raw, failures, engineWorker } = await started('sketch');
	const answered = engineWorker.stopDrawing();
	raw.onerror?.({ message: 'boom' } as ErrorEvent);
	await answered;
	expect(engineWorker.cleanStop).toBe(false);
	expect(failures.map(([error]) => error.code)).toEqual(['E1404']);
});

test('a loop that fails before the worker is ready fails the start', async () => {
	const fake = fakeWorker();
	const failures: EngineError[] = [];
	const engineWorker = new EngineWorker(fake.worker, 'sketch', {
		sketchMessage: () => {},
		failure: (error) => failures.push(error),
		quality: () => {},
		stats: () => {},
		labelSlot: () => {},
		jobsWanted: () => {},
	});
	fake.reply({ type: 'fault', role: 'sketch', message: 'Unable to create texture' });
	await expect(engineWorker.ready()).rejects.toThrow('Unable to create texture');
	expect(failures).toEqual([]);
});

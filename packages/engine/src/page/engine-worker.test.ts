// How the page routes a worker's replies once the worker has started: a failure that the worker
// reports, or that ends it, reaches the page's failure handler, and a stop waits for the worker's
// answer. A request that the worker never answers fails once its wait has taken longer than the
// limit, so that a thread that stopped taking messages gives the page a named error.
import { beforeEach, expect, test } from 'bun:test';
import type { EngineError } from '../errors/engine-error';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { BUILD_WAIT_LIMIT_MS } from '../render/scene-renderer';
import type { WorkerReply } from '../workers/protocol';
import { EngineWorker, WORKER_REPLY_LIMIT_MS } from './engine';

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

/**
 * Holds the timers that the code arms, so that a test fires each one by hand instead of waiting for
 * its delay. The clock is the code's own `setTimeout`, which it reads from the global at each call.
 */
function heldTimers() {
	const armed = new Map<number, () => void>();
	const cleared: number[] = [];
	let next = 0;
	const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
	globalThis.setTimeout = ((handler: () => void) => {
		armed.set(++next, handler);
		return next;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((id: number) => {
		cleared.push(id);
		armed.delete(id);
	}) as unknown as typeof clearTimeout;
	return {
		/** The number of timers that are still armed. */
		armed: () => armed.size,
		cleared,
		/** Fires each armed timer once, as its delay passing would. */
		fire: () => {
			for (const [id, handler] of [...armed]) {
				armed.delete(id);
				handler();
			}
		},
		restore: () => {
			globalThis.setTimeout = real.setTimeout;
			globalThis.clearTimeout = real.clearTimeout;
		},
	};
}

/** A page whose visibility a test sets, or undefined on a thread that has no document. */
const page = globalThis as { document?: { visibilityState: string } };

/** An engine worker whose failures the test collects, started with a ready reply. */
async function started(role = 'job 3') {
	const fake = fakeWorker();
	const failures: [EngineError, boolean | undefined][] = [];
	const engineWorker = new EngineWorker(fake.worker, role, {
		sketchMessage: () => {},
		sketchError: () => {},
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

test('a request that the worker never answers fails once its wait has passed the limit', async () => {
	const { engineWorker, sent } = await started('render');
	const timers = heldTimers();
	try {
		const answer = engineWorker.request({ type: 'capture' });
		expect(sent).toEqual([{ type: 'capture' }]);
		expect(timers.armed()).toBe(1);
		timers.fire();
		await expect(answer).rejects.toThrow(
			`the render worker did not answer the capture within ${WORKER_REPLY_LIMIT_MS / 1000} s`,
		);
	} finally {
		timers.restore();
	}
});

test('an answer resolves the request and takes the wait down with it', async () => {
	const { engineWorker, reply } = await started('render');
	const timers = heldTimers();
	try {
		const answer = engineWorker.request({ type: 'capture' });
		reply({ type: 'captured', width: 2, height: 2, pixels: new Uint8Array(16) });
		await expect(answer).resolves.toMatchObject({ type: 'captured', width: 2 });
		expect(timers.cleared).toHaveLength(1);
		// The wait is gone, so nothing is left to fire.
		expect(timers.armed()).toBe(0);
		timers.fire();
		await expect(answer).resolves.toMatchObject({ type: 'captured' });
	} finally {
		timers.restore();
	}
});

test('a wait on a hidden page starts over, since a hidden page draws no frames', async () => {
	const { engineWorker } = await started('render');
	const timers = heldTimers();
	const was = page.document;
	try {
		page.document = { visibilityState: 'hidden' };
		const answer = engineWorker.request({ type: 'capture' });
		const settled = answer.then(
			() => 'resolved',
			(error: Error) => error.message,
		);
		timers.fire();
		expect(await Promise.race([settled, Promise.resolve('waiting')])).toBe('waiting');
		// The wait started over, so the page has as long again to show.
		expect(timers.armed()).toBe(1);
		page.document = { visibilityState: 'visible' };
		timers.fire();
		await expect(answer).rejects.toThrow('did not answer the capture within');
	} finally {
		timers.restore();
		if (was === undefined) delete page.document;
		else page.document = was;
	}
});

test("the wait's limit sits above the time that a frame's pipelines may take", () => {
	// A capture waits inside the worker for the frame's pipelines, up to that limit, before it reads
	// the frame back and encodes it.
	expect(WORKER_REPLY_LIMIT_MS).toBeGreaterThanOrEqual(2 * BUILD_WAIT_LIMIT_MS);
});

/** The events of an engine worker that a test gives no handlers of its own. */
function unwatched() {
	const failures: EngineError[] = [];
	return {
		failures,
		events: {
			sketchMessage: () => {},
			sketchError: () => {},
			failure: (error: EngineError) => failures.push(error),
			quality: () => {},
			stats: () => {},
			labelSlot: () => {},
			jobsWanted: () => {},
		},
	};
}

test('a worker whose script did not load gets one more copy, and the messages held for it', async () => {
	const first = fakeWorker();
	const second = fakeWorker();
	const { events, failures } = unwatched();
	const engineWorker = new EngineWorker(first.worker, 'render', events, () => second.worker);
	// No message reaches a worker that has not run its script: it could not take one.
	engineWorker.send({ type: 'init', core: 'core' });
	expect(first.sent).toEqual([]);
	first.raw.onerror?.({ message: '' } as ErrorEvent);
	expect(failures).toEqual([]);
	// The copy takes the held message once its script has run, and the start goes on.
	second.reply({ type: 'progress', role: 'render', step: 'loaded' });
	expect(second.sent).toEqual([{ type: 'init', core: 'core' }]);
	second.reply({ type: 'ready', role: 'render', threaded: true, version: 'test' });
	await expect(engineWorker.ready()).resolves.toMatchObject({ type: 'ready' });
});

test('a worker whose script does not load twice fails the start with E1405', async () => {
	const first = fakeWorker();
	const second = fakeWorker();
	const { events, failures } = unwatched();
	const engineWorker = new EngineWorker(first.worker, 'render', events, () => second.worker);
	first.raw.onerror?.({ message: '' } as ErrorEvent);
	second.raw.onerror?.({ message: '' } as ErrorEvent);
	await expect(engineWorker.ready()).rejects.toThrow(
		'the render worker did not start: its script or a file it imports did not load.',
	);
	expect(failures).toEqual([]);
});

test('a worker that fails with a message is not started again', async () => {
	const first = fakeWorker();
	const { events } = unwatched();
	let copies = 0;
	const engineWorker = new EngineWorker(first.worker, 'sketch', events, () => {
		copies++;
		return fakeWorker().worker;
	});
	first.raw.onerror?.({
		message: 'Script at http://localhost/render-worker.ts cannot be accessed.',
	} as ErrorEvent);
	await expect(engineWorker.ready()).rejects.toThrow('cannot be accessed');
	expect(copies).toBe(0);
});

test('a worker that ran its script keeps the messages that follow', async () => {
	const fake = fakeWorker();
	const { events } = unwatched();
	const engineWorker = new EngineWorker(fake.worker, 'render', events, () => fake.worker);
	fake.reply({ type: 'progress', role: 'render', step: 'loaded' });
	engineWorker.send({ type: 'capture' });
	expect(fake.sent).toEqual([{ type: 'capture' }]);
});

test('a loop that fails before the worker is ready fails the start', async () => {
	const fake = fakeWorker();
	const failures: EngineError[] = [];
	const engineWorker = new EngineWorker(fake.worker, 'sketch', {
		sketchMessage: () => {},
		sketchError: () => {},
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

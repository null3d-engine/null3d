import { describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	type EndedEarly,
	MemoryGuard,
	memoryResetText,
	refreshProblem,
	refreshText,
	summaryLine,
	TIMED_PLANS,
} from '../real-browsers.ts';
import type { Check } from './plans.ts';
import { RUNS_DIR } from './report-collector.ts';
import {
	type ItemResult,
	keepsRefusingMemory,
	OOM_STOP_PAGES,
	OOM_WINDOW_PAGES,
	outOfMemory,
	type Plan,
	readResult,
	runName,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './runs.ts';

const E1109 = {
	ok: false,
	error:
		"E1109: the browser refused the engine's shared memory of 1024 MiB 7 times: Out of memory.",
};
const BROWSER_OOM = { ok: false, error: 'Out of memory' };
const PASSED = { ok: true };
const OTHER_FAILURE = { ok: false, error: 'the image differs from its reference in 3% of pixels' };

describe('the out-of-memory guard', () => {
	// Whether each page failed for lack of memory, oldest first.
	const X = true;
	const o = false;

	it('ends a turn after pages in a row that fail for lack of memory', () => {
		expect(OOM_STOP_PAGES).toBe(3);
		expect(keepsRefusingMemory([o, o, X, X])).toBe(false);
		expect(keepsRefusingMemory([o, o, X, X, X])).toBe(true);
		expect(keepsRefusingMemory([X, X, X])).toBe(true);
	});

	it('ends a turn after 3 such pages within the last 5, with others between them', () => {
		expect(OOM_WINDOW_PAGES).toBe(5);
		expect(keepsRefusingMemory([X, o, X, o, X])).toBe(true);
		expect(keepsRefusingMemory([o, o, o, X, o, X, X])).toBe(true);
		// The first failure is no longer among the last 5 pages.
		expect(keepsRefusingMemory([X, o, o, o, X, X])).toBe(false);
	});

	it('lets a run go on after a single page that fails for lack of memory', () => {
		expect(keepsRefusingMemory([X])).toBe(false);
		expect(keepsRefusingMemory([o, X, o, o, o])).toBe(false);
		expect(keepsRefusingMemory([o, o, o, o, X])).toBe(false);
	});

	it("knows E1109 and the browser's own out-of-memory error, and only on failed pages", () => {
		expect(outOfMemory(E1109)).toBe(true);
		expect(outOfMemory(BROWSER_OOM)).toBe(true);
		expect(
			outOfMemory({ ok: false, error: 'RangeError: WebAssembly.Memory(): out of memory' }),
		).toBe(true);
		expect(outOfMemory(OTHER_FAILURE)).toBe(false);
		expect(outOfMemory({ ok: true, error: E1109.error })).toBe(false);
		expect(outOfMemory(undefined)).toBe(false);
	});
});

describe('MemoryGuard', () => {
	const ids = ['a', 'b', 'room', 'c', 'd', 'e', 'f'];
	/** A run of these items, where `room` pushes the memory limit on purpose. */
	async function withPlan(test: (plan: Plan<Check>) => Promise<void> | void): Promise<void> {
		const plan = writePlan<Check>(
			`${runName('test')}-oom-guard-${process.pid}`,
			ids.map((id) => ({
				id,
				path: `/${id}`,
				timeoutSeconds: 30,
				check: id === 'room' ? { kind: 'room', maximumMiB: 4096 } : { kind: 'isolation' },
			})),
		);
		try {
			await test(plan);
		} finally {
			rmSync(join(RUNS_DIR, plan.run), { recursive: true, force: true });
		}
	}
	const store = (plan: Plan<Check>, runner: string, results: Record<string, ItemResult>) => {
		for (const [id, result] of Object.entries(results))
			writeRunnerFile(plan.run, runner, id, result);
	};

	it('ends the turn of a browser that keeps refusing memory, and records what to run again', () =>
		withPlan((plan) => {
			const stopped: string[] = [];
			const guard = new MemoryGuard(plan, new Map([['ipad-safari', { kind: 'lan' }]]), (runner) =>
				stopped.push(runner),
			);
			// One page short of a result, and a refused page that only looks for the limit.
			store(plan, 'ipad-safari', { a: PASSED, b: E1109, room: E1109, c: PASSED });
			expect(guard.endTurn('ipad-safari')).toBe(false);
			store(plan, 'ipad-safari', { d: BROWSER_OOM });
			expect(guard.endTurn('ipad-safari')).toBe(false);
			store(plan, 'ipad-safari', { e: E1109 });
			expect(guard.endTurn('ipad-safari')).toBe(true);
			expect(stopped).toEqual(['ipad-safari']);
			const ended = guard.ended.get('ipad-safari') as EndedEarly;
			expect(ended).toMatchObject({
				reason:
					"the browser keeps refusing the engine's memory (E1109 and Out of memory on 3 of its last 5 pages)",
				pages: ['b', 'd', 'e'],
				// The pages without a result, and those that failed for lack of memory.
				only: ['b', 'room', 'd', 'e', 'f'],
				todo: 'Quit and reopen Safari on the iPad, bring the runner page to the front, then run again with --only b,room,d,e,f',
			});
			expect(readResult(plan.run, 'ipad-safari', 'ended-early')).toMatchObject(ended);
		}));

	it('ends the turn on refused pages that passed pages followed before the guard looked', () =>
		withPlan((plan) => {
			const guard = new MemoryGuard(plan, new Map(), () => {});
			store(plan, 'ipad-safari', { a: E1109, b: E1109, room: PASSED, c: E1109, d: PASSED });
			store(plan, 'ipad-safari', { e: PASSED, f: PASSED });
			expect(guard.endTurn('ipad-safari')).toBe(true);
			expect(guard.ended.get('ipad-safari')?.pages).toEqual(['a', 'b', 'c']);
		}));

	it('keeps a browser going after one refused page, and watches each runner apart', () =>
		withPlan((plan) => {
			const guard = new MemoryGuard(plan, new Map(), () => {});
			store(plan, 'ipad-safari', { a: E1109, b: PASSED, room: PASSED, c: OTHER_FAILURE });
			store(plan, 'ipad-brave', { a: E1109, b: E1109 });
			expect(guard.endTurn('ipad-safari')).toBe(false);
			expect(guard.endTurn('ipad-brave')).toBe(false);
			store(plan, 'ipad-safari', { d: PASSED, e: PASSED, f: PASSED });
			expect(guard.endTurn('ipad-safari')).toBe(false);
			expect(guard.ended.size).toBe(0);
		}));

	it('names the browser, the device and the next step for each kind of runner', () => {
		const only = ['a', 'b'];
		expect(memoryResetText('mac-safari', { kind: 'mac', app: 'Safari' }, only)).toBe(
			'Quit and reopen Safari on this Mac, then run again with --only a,b',
		);
		expect(
			memoryResetText('sm-s926b-chrome-beta', { kind: 'android', browser: 'chrome-beta' }, only),
		).toBe('Quit and reopen Chrome Beta on the phone, then run again with --only a,b');
		expect(memoryResetText('ipad-brave', { kind: 'lan' }, only)).toBe(
			'Quit and reopen Brave on the iPad, bring the runner page to the front, then run again with --only a,b',
		);
	});

	it("gives --only an item's own id when it failed in a later round", () =>
		withPlan((plan) => {
			plan.items = [
				...plan.items,
				...plan.items.map((item) => ({ ...item, id: `${item.id}-round-2` })),
			];
			const guard = new MemoryGuard(plan, new Map(), () => {});
			for (const id of ids) writeRunnerFile(plan.run, 'ipad-safari', id, PASSED);
			store(plan, 'ipad-safari', {
				'a-round-2': E1109,
				'b-round-2': E1109,
				'room-round-2': PASSED,
			});
			expect(guard.endTurn('ipad-safari')).toBe(false);
			store(plan, 'ipad-safari', { 'c-round-2': E1109 });
			expect(guard.endTurn('ipad-safari')).toBe(true);
			expect(guard.ended.get('ipad-safari')?.only).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
		}));

	it('stops waiting for a runner whose turn the guard ended, and goes on with the others', () =>
		withPlan(async (plan) => {
			writeRunnerFile(plan.run, 'ipad-safari', 'device', {});
			writeRunnerFile(plan.run, 'sm-s926b-chrome', 'device', {});
			writeRunnerFile(plan.run, 'sm-s926b-chrome', 'done', {});
			const finished = await waitForRunners(plan, ['ipad-safari', 'sm-s926b-chrome'], {
				endTurn: (runner) => runner === 'ipad-safari',
			});
			expect(finished).toEqual(['sm-s926b-chrome']);
		}));

	it("says in the run's summary that a turn ended early, and how many pages never ran", () => {
		const endedEarly: EndedEarly = {
			reason: "the browser keeps refusing the engine's memory (E1109 on 3 of its last 3 pages)",
			pages: ['b', 'c', 'd'],
			todo: '',
			only: [],
			endedAt: '',
		};
		expect(summaryLine('ipad-safari', { pass: 6, skip: 0, fail: 3, notRun: 481, endedEarly })).toBe(
			"ipad-safari: 6 passed, 0 skipped, 3 failed, 481 not run; ended early: the browser keeps refusing the engine's memory (E1109 on 3 of its last 3 pages)",
		);
		expect(
			summaryLine('ipad-safari', {
				pass: 6,
				skip: 0,
				fail: 3,
				notRun: 481,
				endedEarly,
				browser: 'Safari 26',
			}),
		).toMatch(
			/^ipad-safari \(Safari 26\): 6 passed, 0 skipped, 3 failed, 481 not run; ended early: /,
		);
	});
});

describe('the refresh rate guard', () => {
	it('times frames and loads in the plans that measure them', () => {
		for (const plan of ['bench', 'startup', 'governor', 'skinning', 'overload', 'soak'])
			expect(TIMED_PLANS.has(plan)).toBe(true);
		expect(TIMED_PLANS.has('checks')).toBe(false);
	});

	it('accepts a rate that holds near the expected one', () => {
		expect(refreshProblem([59, 60, 59, 60])).toBeUndefined();
		expect(refreshProblem([120, 120])).toBeUndefined();
		expect(refreshProblem([])).toBeUndefined();
	});

	it('marks a rate well below the expected one', () => {
		expect(refreshProblem([59, 37, 59])).toBe('the display ran at 37 Hz (expected 60)');
		expect(refreshProblem([54])).toBe('the display ran at 54 Hz (expected 60)');
	});

	it('marks a rate that changes by more than a tenth between pages', () => {
		expect(refreshProblem([120, 60, 120])).toBe(
			"the display's rate changed between 60 and 120 Hz through the run",
		);
		expect(refreshProblem([60, 66])).toBeUndefined();
	});

	it('says what to check on each kind of device, and that the figures are unreliable', () => {
		const problem = 'the display ran at 37 Hz (expected 60)';
		expect(refreshText('ipad-safari', { kind: 'lan' }, problem)).toBe(
			'ipad-safari: the display ran at 37 Hz (expected 60): the iPad is hot, or Limit Frame Rate is off, or Low Power Mode or Reduce Motion is on; let it cool and check its settings. Its timing figures in this run are unreliable.',
		);
		expect(refreshText('sm-s926b-chrome', { kind: 'android', browser: 'chrome' }, problem)).toBe(
			'sm-s926b-chrome: the display ran at 37 Hz (expected 60): the phone is hot, or Motion smoothness is not Standard, or battery saver is on; let it cool and check its settings. Its timing figures in this run are unreliable.',
		);
		expect(
			summaryLine('ipad-safari', { pass: 4, skip: 0, fail: 0, unreliableTiming: problem }),
		).toBe(
			'ipad-safari: 4 passed, 0 skipped, 0 failed; timing figures unreliable: the display ran at 37 Hz (expected 60)',
		);
	});
});

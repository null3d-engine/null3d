import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { everyShader } from '../../packages/engine/src/generated/shaders.ts';
import { IMAGE_RUNS } from '../image/manifest.ts';
import { PRECISION } from '../pages/lib/depth-precision.ts';
import { glslProgramsOf } from '../pages/lib/shader-list.ts';
import {
	braveShieldsOf,
	deviceChecklist,
	parseArgs,
	planItems,
	QuietRecovery,
	summaryLine,
} from '../real-browsers.ts';
import { ENGINE_MODES, type EngineMode } from './engine-checks.ts';
import { writePng } from './images.ts';
import { isLoadPath } from './load-routes.ts';
import {
	benchPlan,
	benchSummary,
	checksPlan,
	depthPlan,
	depthSummary,
	itemsNeeded,
	judge,
	MEMORY_MAXIMUMS_MIB,
	memoryPlan,
	memorySummary,
	NO_RESULT,
	NONE_MISSING,
	overloadPlan,
	PLANS,
	parityPlan,
	REPORT_ON_TOP_PLANS,
	SHADERS_PAGE_SECONDS,
	STARTUP_RUNS,
	startupPlan,
	startupSummary,
} from './plans.ts';

/** A browser may lack WebGPU, and must have WebGL2. */
const NO_WEBGPU = { webgpu: true, webgl2: false };

import { RUNS_DIR } from './report-collector.ts';
import {
	batchTimeoutMs,
	currentItem,
	handovers,
	type ItemResult,
	inLanes,
	PAGES_PER_TAB,
	type Plan,
	type PlanItem,
	pickItems,
	quietLimitMs,
	readResult,
	readShard,
	repeatItems,
	rerunsInNewTab,
	runName,
	shardItems,
	turnBatches,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './runs.ts';
import { handoverName, handsOver } from './tab-end.ts';
import { VISUAL_LIMITS } from './visual-checks.ts';

describe('turnBatches', () => {
	it('lets one browser per device run at a time, in the order given', () => {
		const runners = [
			{ name: 'mac-safari', device: 'mac' },
			{ name: 'mac-brave-browser', device: 'mac' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'sm-s926b-chrome-beta', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
		];
		expect(turnBatches(runners)).toEqual([
			['mac-safari', 'sm-s926b-chrome', 'ipad-safari'],
			['mac-brave-browser', 'sm-s926b-chrome-beta'],
		]);
	});
});

describe('inLanes', () => {
	it('runs at most the lanes at once, and starts the next item as soon as a lane frees', async () => {
		let running = 0;
		let most = 0;
		const order: string[] = [];
		const times: Record<string, number> = { a: 60, b: 10, c: 10, d: 10 };
		await inLanes(['a', 'b', 'c', 'd'], 2, async (item) => {
			running++;
			most = Math.max(most, running);
			order.push(item);
			await Bun.sleep(times[item] ?? 0);
			running--;
		});
		expect(most).toBe(2);
		// While a runs long, the other lane takes b, c and d one after another.
		expect(order).toEqual(['a', 'b', 'c', 'd']);
	});

	it('waits for every lane, then throws the first error', async () => {
		const done: string[] = [];
		const work = inLanes(['bad', 'slow'], 2, async (item) => {
			if (item === 'bad') throw new Error('bad item');
			await Bun.sleep(30);
			done.push(item);
		});
		await expect(work).rejects.toThrow('bad item');
		expect(done).toEqual(['slow']);
	});
});

describe('waitForRunners', () => {
	const item = (id: string, timeoutSeconds = 1) => ({
		id,
		path: `/${id}`,
		timeoutSeconds,
		check: {},
	});
	/** Runs a test on a fresh run of these items, and removes the run's files after it. */
	async function withRun(ids: string[], test: (plan: Plan) => Promise<void> | void): Promise<void> {
		const run = `${runName('test')}-wait-${process.pid}-${ids.join('')}`;
		try {
			await test(
				writePlan(
					run,
					ids.map((id) => item(id)),
				),
			);
		} finally {
			rmSync(join(RUNS_DIR, run), { recursive: true, force: true });
		}
	}

	it('gives up on a runner page that started and then went quiet, as when its tab closed', () =>
		withRun(['a'], async (plan) => {
			writeRunnerFile(plan.run, 'quiet-phone', 'device', {});
			writeRunnerFile(plan.run, 'done-phone', 'device', {});
			writeRunnerFile(plan.run, 'done-phone', 'done', {});
			const quiet: [string, string | undefined][] = [];
			const finished = await waitForRunners(plan, ['quiet-phone', 'done-phone'], {
				quietMs: () => 50,
				onQuiet: (runner, _, at) => quiet.push([runner, at?.item.id]) < 0,
			});
			expect(finished).toEqual(['done-phone']);
			expect(quiet).toEqual([['quiet-phone', 'a']]);
		}));

	it('waits again for a runner whose quiet page the caller replaced', () =>
		withRun(['a', 'b'], async (plan) => {
			writeRunnerFile(plan.run, 'mac-safari', 'device', {});
			writeRunnerFile(plan.run, 'mac-safari', 'a', { ok: true });
			const quietOn: (string | undefined)[] = [];
			const finished = await waitForRunners(plan, ['mac-safari'], {
				quietMs: () => 50,
				onQuiet: (runner, _, at) => {
					quietOn.push(at?.item.id);
					// The new runner page finishes the run a moment later.
					setTimeout(() => writeRunnerFile(plan.run, runner, 'done', {}), 100);
					return true;
				},
			});
			expect(quietOn).toEqual(['b']);
			expect(finished).toEqual(['mac-safari']);
		}));

	it('gives up on a runner page that never starts within the start time, where one is given', () =>
		withRun(['a'], async (plan) => {
			const noStart: string[] = [];
			writeRunnerFile(plan.run, 'started', 'device', {});
			writeRunnerFile(plan.run, 'started', 'done', {});
			const finished = await waitForRunners(plan, ['bspixel10-chrome', 'started'], {
				startMs: 100,
				onNoStart: (runner) => noStart.push(runner),
			});
			expect(finished).toEqual(['started']);
			expect(noStart).toEqual(['bspixel10-chrome']);
		}));

	it('opens a new runner page where a runner page handed the run over, once for each handover', () =>
		withRun(['a', 'b', 'c'], async (plan) => {
			writeRunnerFile(plan.run, 'mac-safari', 'device', {});
			writeRunnerFile(plan.run, 'mac-safari', 'a', { ok: true });
			writeRunnerFile(plan.run, 'mac-safari', handoverName(1), { from: 1 });
			const handedAt: number[] = [];
			const finished = await waitForRunners(plan, ['mac-safari'], {
				quietMs: () => 60_000,
				onHandover: (runner, from) => {
					handedAt.push(from);
					// The new runner page runs b, hands over before c, and the next one finishes.
					if (from === 1)
						setTimeout(() => {
							writeRunnerFile(plan.run, runner, 'b', { ok: true });
							writeRunnerFile(plan.run, runner, handoverName(2), { from: 2 });
						}, 50);
					else setTimeout(() => writeRunnerFile(plan.run, runner, 'done', {}), 50);
					return true;
				},
			});
			expect(handedAt).toEqual([1, 2]);
			expect(finished).toEqual(['mac-safari']);
			expect(handovers(plan.run, 'mac-safari', new Set([1]))).toEqual([2]);
		}));

	it('hands the run to a new runner page around pages of their own and after a set number of pages', () => {
		const ran = (pages: number, lastOwnTab = false) => ({ pages, lastOwnTab });
		expect(handsOver({ ownTab: true }, ran(0))).toBe(false);
		expect(handsOver({ ownTab: true }, ran(1))).toBe(true);
		expect(handsOver({}, ran(1, true))).toBe(true);
		expect(handsOver({}, ran(5))).toBe(false);
		expect(handsOver({}, ran(5), PAGES_PER_TAB)).toBe(false);
		expect(handsOver({}, ran(PAGES_PER_TAB), PAGES_PER_TAB)).toBe(true);
		// Fewer pages than Safari's 8 fast slots, so one runner page never uses them all up.
		expect(PAGES_PER_TAB).toBeLessThan(8);
	});

	it('runs a page once more in a new runner page when memory that Safari kept explains its failure', () => {
		for (const problem of [
			"E1109: the browser refused the engine's shared memory of 1024 MiB 13 times over 45 seconds: Out of memory.",
			'E1302: the render worker lost its GPU: the WebGL2 context was lost, in hold mode',
			'the browser did not get back the memory of engines in removed frames: it had room for 10 shared memories before 43 starts in frames, and for 7 after',
			'RangeError: Out of memory',
		])
			expect(rerunsInNewTab('Safari', ['another problem', problem])).toBe(true);
		expect(rerunsInNewTab('Safari', ['the image differs from its reference in 812 pixels'])).toBe(
			false,
		);
		expect(rerunsInNewTab('Firefox', ['E1109: refused'])).toBe(false);
		expect(rerunsInNewTab('Chrome', ['E1302: lost'])).toBe(false);
	});

	it('ends the turn of a runner whose handover found no new runner page', () =>
		withRun(['a', 'b'], async (plan) => {
			writeRunnerFile(plan.run, 'mac-safari', 'device', {});
			writeRunnerFile(plan.run, 'mac-safari', handoverName(1), { from: 1 });
			expect(await waitForRunners(plan, ['mac-safari'], { onHandover: () => false })).toEqual([]);
		}));

	it('allows the current page its timeout, and time to open it', () => {
		expect(quietLimitMs(item('a', 95))).toBe(125_000);
	});

	it('allows a page that posts its progress its quiet time instead', () => {
		expect(quietLimitMs({ ...item('a', 300), quietSeconds: 120 })).toBe(150_000);
	});

	it('finds the page a runner works on: the first page of the plan without a result', () =>
		withRun(['a', 'b', 'c'], (plan) => {
			expect(currentItem(plan, 'mac-safari')?.index).toBe(0);
			writeRunnerFile(plan.run, 'mac-safari', 'a', { ok: true });
			expect(currentItem(plan, 'mac-safari')).toEqual({ index: 1, item: item('b') });
			writeRunnerFile(plan.run, 'mac-safari', 'b', { ok: false });
			writeRunnerFile(plan.run, 'mac-safari', 'c', { ok: true });
			expect(currentItem(plan, 'mac-safari')).toBeUndefined();
		}));
});

describe('QuietRecovery', () => {
	/** A recovery for one runner, with the plan items where it opened new runner pages. */
	function recovery(plan: Plan, canReopen = true, afterTabEnd = canReopen) {
		const opened: (number | undefined)[] = [];
		const quiet = new QuietRecovery(plan, {
			canReopen: (_, tabEnded) => (tabEnded ? afterTabEnd : canReopen),
			inspect: () => 'screen not locked',
			reopen: (_, from) => opened.push(from) > 0,
		});
		return { quiet, opened };
	}
	const plan = (ids: string[]): Plan => ({
		run: `${runName('test')}-recovery-${process.pid}-${ids.join('')}`,
		createdAt: '',
		items: ids.map((id) => ({ id, path: `/${id}`, timeoutSeconds: 30, check: {} })),
	});
	const at = (p: Plan, index: number) => ({ index, item: p.items[index] as PlanItem });

	it('runs the page again in a new runner page, and notes it on the page', () => {
		const p = plan(['a', 'b']);
		const { quiet, opened } = recovery(p);
		expect(quiet.onQuiet('mac-safari', 60, at(p, 1))).toBe(true);
		expect(opened).toEqual([1]);
		expect(quiet.noteFor('mac-safari', 'b')).toBe(
			'the runner page stopped answering on this page, and a new runner page ran it again',
		);
		expect(quiet.noteFor('mac-safari', 'a')).toBeUndefined();
	});

	it('fails a page where the runner page stops twice, and goes on from the next page', () => {
		const p = plan(['a', 'b', 'c']);
		const { quiet, opened } = recovery(p);
		try {
			quiet.onQuiet('mac-safari', 60, at(p, 1));
			expect(quiet.onQuiet('mac-safari', 61, at(p, 1))).toBe(true);
			expect(opened).toEqual([1, 2]);
			expect(readResult(p.run, 'mac-safari', 'b')).toMatchObject({
				ok: false,
				error: 'the runner page stopped answering on this page 2 times, for 61 s the last time',
			});
			expect(quiet.noteFor('mac-safari', 'b')).toBeUndefined();
		} finally {
			rmSync(join(RUNS_DIR, p.run), { recursive: true, force: true });
		}
	});

	it('ends the turn after a few new runner pages, and never replaces one it cannot open', () => {
		const p = plan(['a', 'b', 'c', 'd']);
		const { quiet, opened } = recovery(p);
		expect(quiet.onQuiet('mac-safari', 60, at(p, 0))).toBe(true);
		expect(quiet.onQuiet('mac-safari', 60, at(p, 2))).toBe(true);
		expect(quiet.onQuiet('mac-safari', 60, at(p, 3))).toBe(false);
		expect(opened).toEqual([0, 2]);
		const tablet = recovery(p, false);
		expect(tablet.quiet.onQuiet('ipad-safari', 60, at(p, 0))).toBe(false);
		expect(tablet.opened).toEqual([]);
		expect(recovery(p).quiet.onQuiet('mac-safari', 60, undefined)).toBe(false);
	});

	it('opens a new runner page where one handed the run over, without using up its reopens', () => {
		const p = plan(['a', 'b', 'c', 'd']);
		const { quiet, opened } = recovery(p);
		for (const from of [1, 2, 3]) expect(quiet.onHandover('mac-safari', from)).toBe(true);
		expect(quiet.onQuiet('mac-safari', 60, at(p, 3))).toBe(true);
		expect(opened).toEqual([1, 2, 3, 3]);
		expect(quiet.onHandover('mac-safari', 4)).toBe(false);
	});

	it('records a page that ended its tab from its progress, and goes on after it', () => {
		const p = plan(['a', 'b', 'c', 'd', 'e']);
		for (const item of p.items.slice(0, 4)) item.endsTab = true;
		// A phone: a new runner page only after a page that ended its tab.
		const { quiet, opened } = recovery(p, false, true);
		try {
			writeRunnerFile(p.run, 'sm-s926b-chrome', 'a.progress', {
				receivedAt: 'then',
				livedMiB: 1536,
				stepMiB: 32,
			});
			for (const index of [0, 1, 2])
				expect(quiet.onQuiet('sm-s926b-chrome', 150, at(p, index))).toBe(true);
			expect(opened).toEqual([undefined, undefined, undefined]);
			expect(readResult(p.run, 'sm-s926b-chrome', 'a')).toMatchObject({
				ok: true,
				end: 'tab',
				livedMiB: 1536,
				recordedBy: 'runner tool',
			});
			expect(readResult(p.run, 'sm-s926b-chrome', 'a')?.receivedAt).not.toBe('then');
			// A page without progress died before it posted any.
			expect(readResult(p.run, 'sm-s926b-chrome', 'b')).toMatchObject({ ok: true, end: 'tab' });
			// A stopped page that does not end its tab still ends a phone's turn.
			expect(quiet.onQuiet('sm-s926b-chrome', 60, at(p, 4))).toBe(false);
			const tablet = recovery(p, false, false);
			expect(tablet.quiet.onQuiet('ipad-safari', 150, at(p, 3))).toBe(false);
			expect(readResult(p.run, 'ipad-safari', 'd')).toMatchObject({ end: 'tab' });
		} finally {
			rmSync(join(RUNS_DIR, p.run), { recursive: true, force: true });
		}
	});
});

describe('shardItems', () => {
	/** A plan item whose check lists the items it needs. */
	const item = (id: string, needs: string[] = []) => ({
		id,
		path: `/${id}`,
		timeoutSeconds: 30,
		check: needs,
	});
	const needsOf = (planItem: { check: string[] }) => planItem.check;
	const shardIds = (plan: ReturnType<typeof item>[], index: number, count: number) =>
		shardItems(plan, { index, count }, needsOf).map(({ id }) => id);

	it('reads a shard written as <i>/<n>', () => {
		expect(readShard('2/3')).toEqual({ index: 2, count: 3 });
		for (const text of ['0/2', '3/2', '1', '1/2/3', 'a/b', undefined])
			expect(readShard(text)).toBeNull();
	});

	it('deals the items out evenly, in the order of the plan', () => {
		const plan = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id));
		expect(shardIds(plan, 1, 2)).toEqual(['a', 'c', 'e']);
		expect(shardIds(plan, 2, 2)).toEqual(['b', 'd']);
		expect(shardIds(plan, 1, 1)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(shardIds(plan, 3, 3)).toEqual(['c']);
	});

	it('keeps an item in the shard of the items it needs, and gives the next group to the smallest shard', () => {
		// The groups are a with d and f, b with e, and c; e also names an item the plan lacks.
		const plan = [
			item('a'),
			item('b'),
			item('c'),
			item('d', ['a']),
			item('e', ['b', 'missing']),
			item('f', ['d']),
		];
		expect(shardIds(plan, 1, 2)).toEqual(['a', 'd', 'f']);
		expect(shardIds(plan, 2, 2)).toEqual(['b', 'c', 'e']);
		// An item that needs items of two groups joins the groups into one.
		const joined = [item('a'), item('b'), item('c'), item('d', ['a', 'b'])];
		expect(shardIds(joined, 1, 2)).toEqual(['a', 'b', 'd']);
		expect(shardIds(joined, 2, 2)).toEqual(['c']);
	});
});

describe('pickItems', () => {
	const item = (id: string, needs: string[] = []) => ({
		id,
		path: `/${id}`,
		timeoutSeconds: 30,
		check: needs,
	});
	const plan = [item('a'), item('b', ['a']), item('c', ['b']), item('d')];
	const pick = (ids: string[]) => pickItems(plan, ids, (planItem) => planItem.check);

	it('keeps the named items in the order of the plan, with the items that they need', () => {
		expect(pick(['d', 'a']).map(({ id }) => id)).toEqual(['a', 'd']);
		expect(pick(['c']).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
	});

	it('fails on an item that the plan lacks', () => {
		expect(() => pick(['a', 'e', 'f'])).toThrow('the plan has no item e, f');
	});
});

describe('repeatItems', () => {
	it('runs the items round after round, each later round under ids of its own', () => {
		const items = ['a', 'b'].map((id) => ({ id, path: `/${id}`, timeoutSeconds: 30, check: id }));
		const repeated = repeatItems(items, 3);
		expect(repeated.map(({ id }) => id)).toEqual([
			'a',
			'b',
			'a-round-2',
			'b-round-2',
			'a-round-3',
			'b-round-3',
		]);
		expect(repeated.map(({ path }) => path)).toEqual(['/a', '/b', '/a', '/b', '/a', '/b']);
		expect(repeatItems(items, 1)).toEqual(items);
	});
});

describe('runName', () => {
	it('sorts by time and is safe as a folder name', () => {
		expect(runName('checks', new Date('2026-09-27T10:15:30.123Z'))).toBe('20260927-101530-checks');
	});
});

describe("the runner page's report", () => {
	it('goes over the frames of the plans that check results, and never over a timed page', () => {
		expect([...REPORT_ON_TOP_PLANS].sort()).toEqual([
			'checks',
			'depth',
			'memory',
			'parity',
			'smoke',
			'tab-memory',
		]);
		for (const plan of REPORT_ON_TOP_PLANS) expect(Object.keys(PLANS)).toContain(plan);
	});

	// Under the report, a worker's canvas barely changes the screen, and Android can lower the
	// display to 24 Hz, which fails the engine page's limit on the time between frames.
	it('stays under the frame of each page whose check limits the time between frames', () => {
		const timed = [...REPORT_ON_TOP_PLANS].flatMap((name) =>
			(PLANS[name]?.() ?? []).filter((item) => item.check.kind === 'engine'),
		);
		expect(timed.length).toBeGreaterThan(0);
		for (const item of timed)
			expect({ id: item.id, timesFrames: item.timesFrames }).toEqual({
				id: item.id,
				timesFrames: true,
			});
	});
});

describe('the checks plan', () => {
	const items = checksPlan();

	it('has unique item names, and pages on the test and benchmark pages paths', () => {
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		for (const item of items)
			expect(item.path).toMatch(
				/^(\/__null3d\/load\/warm\/\{run\}\.\{runner\}\.production)?\/(tests|bench)\/pages\//,
			);
		expect(items.find((item) => item.id === 'engine-webgl2-single-threaded')?.path).toBe(
			'/tests/pages/engine.html?gpu=webgl2&threads=off&seconds=2',
		);
		expect(batchTimeoutMs({ run: 'r', createdAt: '', items })).toBeGreaterThan(
			items.length * 30_000,
		);
	});

	it('captures a frame as a PNG file in every mode, on both GPU paths', () => {
		const captures = items.filter((item) => item.check.kind === 'capture');
		expect(captures).toHaveLength(2 * ENGINE_MODES.length);
		expect(captures[0]).toEqual({
			id: 'capture-webgpu-pipelined',
			path: '/tests/pages/capture.html?gpu=webgpu',
			timeoutSeconds: 30,
			check: { kind: 'capture', tier: 'webgpu', mode: ENGINE_MODES[0] },
		});
	});

	it('runs the engine page again on its production build in every mode, on WebGL2', () => {
		const production = items.filter((item) => item.id.startsWith('engine-production-'));
		expect(production.map(({ id }) => id)).toEqual([
			'engine-production-pipelined',
			'engine-production-low-latency',
			'engine-production-single-threaded',
			'engine-production-drawing-on-the-main-thread',
			'engine-production-sketch-on-the-main-thread',
		]);
		expect(production[1]).toEqual({
			id: 'engine-production-low-latency',
			path: '/__null3d/load/warm/{run}.{runner}.production/tests/pages/engine.html?gpu=webgl2&latency=low&seconds=2',
			timeoutSeconds: 45,
			check: { kind: 'engine', tier: 'webgl2', mode: ENGINE_MODES[1] },
			timesFrames: true,
		});
		// The runner builds the production pages for a plan that loads them, and only then.
		expect(planItems(parseArgs(['Safari']))?.some((item) => isLoadPath(item.path))).toBe(true);
		expect(
			planItems(parseArgs(['--plan', 'parity', 'Safari']))?.some((item) => isLoadPath(item.path)),
		).toBe(false);
		// Every timed run of a benchmark page loads the production build, as a developer ships it.
		// The visual checks need the debug views of a development build.
		const bench = planItems(parseArgs(['--plan', 'bench', 'Safari'])) ?? [];
		for (const item of bench) expect(isLoadPath(item.path)).toBe(item.check.kind === 'bench');
		expect(bench.filter((item) => item.check.kind === 'visual')).toHaveLength(2);
		expect(planItems(parseArgs(['--plan', 'scale', 'Safari']))).toBeUndefined();
	});

	it('starts the preset change page at its preset through the switch, and fails another start', () => {
		const change = items.find((item) => item.id === 'preset-change-webgl2');
		if (!change) throw new Error('the plan lacks the preset change page');
		expect(change.path).toBe('/tests/pages/preset-change.html?gpu=webgl2&preset=medium&to=low');
		// A phone that started at its own preset ran Low, and changed nothing.
		const result = { ok: true, tier: 'webgl2', started: 'low', mode: { preset: 'low' } };
		expect(judge(change.check, result, NONE_MISSING)).toEqual([
			'the engine started at low, not medium',
		]);
	});

	it("notes each device's quality preset, and fails one that the chooser does not give", () => {
		const quality = items.find((item) => item.id === 'quality');
		if (!quality) throw new Error('the plan lacks the quality page');
		expect(quality.path).toBe('/tests/pages/quality.html?check=fresh');
		const tablet = { coarsePointer: true, screenMinEdge: 834, deviceMemoryGB: null };
		const round = (preset: string, fps: number) => ({
			preset,
			presentedFps: 60,
			completedFps: fps,
		});
		const result = (preset: string, rounds = [round(preset, 60)]) => ({
			ok: true,
			mode: {
				preset: rounds.at(-1)?.preset,
				presetCheck: { from: preset, targetFps: 60, rounds },
				crashedStarts: 0,
			},
			tier: 'webgpu',
			hints: tablet,
		});
		const notes: string[] = [];
		const context = {
			resultOf: () => undefined,
			imageDir: '',
			note: (text: string) => notes.push(text),
		};
		expect(judge(quality.check, result('medium'), NONE_MISSING, context)).toEqual([]);
		expect(notes).toEqual([
			'quality preset medium on webgpu for a tablet (coarse pointer, smaller screen edge 834 px, no memory reading, 0 crashed starts); the preset check measured medium at 60 frames per second, against a target of 60; medium runs',
		]);
		expect(judge(quality.check, result('high'), NONE_MISSING, context)).toEqual([
			'the engine chose the high preset, where the chooser gives medium',
		]);

		// The heavy scene's page: the check must lower the chosen preset.
		const heavy = overloadPlan().find((item) => item.id === 'preset-check');
		if (!heavy) throw new Error('the plan lacks the preset check page');
		expect(heavy.path).toBe('/tests/pages/quality.html?spheres=32768&check=fresh');
		const lowered = result('medium', [round('medium', 20), round('low', 25)]);
		expect(judge(heavy.check, lowered, NONE_MISSING, context)).toEqual([]);
		expect(judge(heavy.check, result('medium'), NONE_MISSING, context)).toEqual([
			'the check kept medium for a scene too heavy for the GPU',
		]);
		// A phone starts at Low, which the engine does not check.
		const phone = {
			...result('low'),
			mode: { preset: 'low', presetCheck: null, crashedStarts: 0 },
			hints: { ...tablet, screenMinEdge: 412 },
		};
		expect(judge(heavy.check, phone, NONE_MISSING, context)).toEqual([]);
	});

	it("checks the stats overlay and the sketch's frame figures on both GPU paths", () => {
		const stats = items.filter((item) => item.check.kind === 'stats');
		expect(stats.map(({ id, path }) => [id, path])).toEqual([
			['stats-webgpu', '/tests/pages/stats.html?gpu=webgpu'],
			['stats-webgl2', '/tests/pages/stats.html?gpu=webgl2'],
		]);
		const check = (stats[0] as (typeof stats)[number]).check;
		const thread = (name: string) => ({ name, busyMs: 1.5, phases: { update: 0.25 } });
		const good = {
			ok: true,
			tier: 'webgpu',
			mode: {
				latency: 'pipelined',
				sketchThread: 'worker',
				renderThread: 'render-worker',
				jobWorkers: 1,
				preset: 'high',
			},
			gpuTimer: true,
			noPageMemory: false,
			overlay: {
				figures: {
					heading: 'webgpu  high  scale 1.00',
					fps: '60 fps',
					'target-note': '',
					display: '120 Hz',
					target: '≥60 fps · 16.7 ms',
					'mode:pipelined': '',
					sketch: '1.5 ms',
					drawing: '1.5 ms',
					jobs: '1.5 ms',
					gpu: '0.2 ms',
					memory: '78.0 MiB',
					'engine-memory': '64.0 MiB',
					'gpu-textures': '3.0 MiB',
					'gpu-buffers': '1.0 MiB',
					'js-heap': '10.0 MiB',
					'page-memory': 'Whole page, as the browser counts it: measuring',
					draws: '3',
					triangles: '37',
					objects: '6',
				} as Record<string, string>,
				expanded: 'true',
				offset: [0, 0],
				pointerEvents: 'none',
			},
			figures: {
				frames: 30,
				presentedFps: 60,
				completedFps: 60,
				cpuMs: 1.5,
				gpuMs: 0.2,
				triangles: 37,
				objects: 6,
				wasmBytes: 64 * 1024 * 1024,
				meshBytes: 4 * 1024 * 1024,
				gpuTextureBytes: 3 * 1024 * 1024,
				gpuBufferBytes: 1024 * 1024,
				tier: 'webgpu',
				preset: 'high',
				renderScale: 1,
				threads: [thread('sketch-worker'), thread('render-worker'), thread('job-0')],
			},
		};
		expect(judge(check, good, NONE_MISSING)).toEqual([]);
		const { sketch: _sketch, jobs: _jobs, gpu: _gpu, ...fewer } = good.overlay.figures;
		const bad = {
			...good,
			overlay: {
				...good.overlay,
				offset: [0, 12],
				expanded: 'false',
				figures: { ...fewer, page: '0.4 ms', memory: '70.0 MiB', triangles: '0' },
			},
			figures: {
				...good.figures,
				frames: 0,
				triangles: 0,
				meshBytes: 0,
				gpuBufferBytes: 0,
				threads: [thread('sketch-worker')],
			},
		};
		expect(judge(check, bad, NONE_MISSING)).toEqual([
			"the overlay sits 0, 12 px from the canvas's top-right corner",
			'the overlay does not start with its card open',
			'the overlay does not show sketch',
			'the overlay does not show jobs',
			'the overlay shows a page bar',
			'the overlay does not show gpu',
			'the memory parts (engine-memory, gpu-textures, gpu-buffers, js-heap) add up to 78 MiB, not 70.0 MiB',
			'the overlay shows triangles as "0"',
			'the sketch got no frame figures',
			'the figures give meshBytes 0',
			'the figures give gpuBufferBytes 0',
			"the figures give 0 triangles, fewer than the box's",
			'the figures name the threads sketch-worker',
		]);
		const noTimer = { ...good, gpuTimer: false };
		expect(judge(check, noTimer, NONE_MISSING)).toEqual(['the overlay shows gpu as "0.2 ms"']);
		expect(judge(check, { ...good, overlay: null }, NONE_MISSING)).toEqual([
			'the page shows no stats overlay',
		]);
	});

	it('checks the formats of KTX2 files on both GPU paths, and notes what each device got', () => {
		const ktx2 = items.filter((item) => item.check.kind === 'ktx2');
		expect(ktx2.map(({ id, path }) => [id, path])).toEqual([
			['ktx2-webgpu', '/tests/pages/ktx2-files.html?gpu=webgpu'],
			['ktx2-webgl2', '/tests/pages/ktx2-files.html?gpu=webgl2'],
		]);
		// A tablet's WebGL2 context with ASTC and ETC2: ETC1S data goes to ETC2, UASTC to ASTC, and
		// UASTC HDR to shared-exponent floats.
		const texture = (format: string, size: number[], bytes: number, colorSpace = 'srgb') => ({
			format,
			colorSpace,
			size,
			bytes,
		});
		const result = (uastc: string) => ({
			ok: true,
			mode: { build: 'threaded', latency: 'pipelined', renderThread: 'render-worker' },
			features: ['WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc'],
			recorded: {
				textures: [
					texture('etc2-rgb8unorm', [64, 64, 1], 2744),
					texture('etc2-rgb8unorm', [64, 64, 1], 2744),
					texture(uastc, [64, 64, 1], 5488),
					texture('rgba8unorm', [30, 20, 1], 3168, 'linear'),
					texture('etc2-rgb8unorm', [64, 64, 1], 2048),
					texture('rgb9e5ufloat', [64, 64, 1], 21844, 'linear'),
				],
				memoryBytes: 2744 * 2 + 5488 + 4 * 3168 + 2048 + 21844,
				codes: { broken: 'E1412', flipY: 'E1208', update: 'E1208' },
			},
		});
		const notes: string[] = [];
		const context = {
			resultOf: () => undefined,
			imageDir: '',
			note: (text: string) => notes.push(text),
		};
		const [, webgl2] = ktx2;
		if (!webgl2) throw new Error('the plan lacks the KTX2 page');
		expect(judge(webgl2.check, result('astc-4x4-unorm'), NONE_MISSING, context)).toEqual([]);
		expect(notes).toEqual([
			'KTX2 on webgl2: ETC1S became etc2-rgb8unorm, UASTC astc-4x4-unorm, UASTC HDR rgb9e5ufloat (compressed families: astc, etc2)',
		]);
		expect(judge(webgl2.check, result('etc2-rgba8unorm'), NONE_MISSING, context)).toEqual([
			'the formats are etc2-rgb8unorm, etc2-rgb8unorm, etc2-rgba8unorm, rgba8unorm, etc2-rgb8unorm, rgb9e5ufloat, not etc2-rgb8unorm, etc2-rgb8unorm, astc-4x4-unorm, rgba8unorm, etc2-rgb8unorm, rgb9e5ufloat',
		]);
	});

	it('splits into shards that run each item once, each with the items its check compares with, and the capabilities page first', () => {
		const ids = (plan: { id: string }[]) => plan.map(({ id }) => id).sort();
		for (const count of [2, 3, 4]) {
			const shards = Array.from(
				{ length: count },
				(_, i) => planItems(parseArgs(['--shard', `${i + 1}/${count}`, 'Safari'])) ?? [],
			);
			for (const shard of shards) expect(shard[0]?.id).toBe('capabilities');
			const once = [shards[0] ?? [], ...shards.slice(1).map((shard) => shard.slice(1))];
			expect(ids(once.flat())).toEqual(ids(items));
			// The largest group is an image test in every thread mode; each later shard adds the
			// capabilities page.
			const sizes = shards.map((shard) => shard.length);
			expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(ENGINE_MODES.length + 1);
			for (const shard of shards) {
				const inShard = new Set(shard.map(({ id }) => id));
				for (const { check } of shard)
					for (const id of itemsNeeded(check)) expect(inShard).toContain(id);
				// Each shard keeps the plan's order.
				expect(shard).toEqual(items.filter(({ id }) => inShard.has(id)));
			}
		}
		const first = planItems(parseArgs(['--shard', '1/2', 'Safari'])) ?? [];
		expect(first[0]?.id).toBe('capabilities');
		expect(first.at(-1)?.id).toBe('capabilities-reload');
	});

	it('skips a WebGPU page on a browser without WebGPU only when allowed', () => {
		const webgpu = items.find((item) => item.id === 'image-clear-webgpu');
		const webgl2 = items.find((item) => item.id === 'image-clear-webgl2');
		if (!webgpu || !webgl2) throw new Error('the plan lacks the clear pages');
		const missing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgpu in this browser.',
		};
		expect(judge(webgpu.check, missing, NO_WEBGPU)).toBe('skip');
		expect(judge(webgpu.check, missing, NONE_MISSING)).toEqual([missing.error]);
		expect(judge(webgl2.check, { ok: false, error: 'no WebGPU adapter' }, NO_WEBGPU)).toEqual([
			'no WebGPU adapter',
		]);
	});

	it('runs every run of the image test manifest, each judged by the harness', () => {
		const images = items.filter((item) => item.check.kind === 'image');
		expect(images.map((item) => item.id)).toEqual(IMAGE_RUNS.map((run) => `image-${run.id}`));
		const compat = items.find((item) => item.id === 'image-replay-textures-compat');
		if (!compat) throw new Error('the plan lacks the texture pages');
		expect(compat.path).toBe('/tests/pages/replay-textures.html?gpu=compat&preset=high');
		expect(judge(compat.check, { ok: false, error: 'no WebGPU adapter' }, NO_WEBGPU)).toBe('skip');
		const failed = { ok: true, errors: ['a view is invalid'], pixels: '', width: 0, height: 0 };
		expect(judge(compat.check, failed, NONE_MISSING)).toEqual([
			'no runner to find the references of',
		]);
		const root = mkdtempSync(join(tmpdir(), 'null3d-images-'));
		try {
			const harnessDirs = { references: join(root, 'references'), candidates: join(root, 'saved') };
			const context = {
				resultOf: () => undefined,
				imageDir: root,
				runner: { name: 'mac-safari', device: 'mac' },
				harnessDirs,
			};
			expect(judge(compat.check, failed, NONE_MISSING, context)).toEqual([
				'GPU error: a view is invalid',
				'released is undefined, not true',
				'the image is 0 x 0 pixels, not 320 x 256',
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("compares a browser's image with the real-GPU reference, and every mode with the first", () => {
		const first = items.find((item) => item.id === 'image-held-webgl2-pipelined');
		const later = items.find((item) => item.id === 'image-held-webgl2-low-latency');
		if (first?.check.kind !== 'image' || later?.check.kind !== 'image')
			throw new Error('the plan lacks the held test');
		const { size } = first.check.run;
		const [width, height] = size;
		const frame = (red: number) => {
			const data = new Uint8Array(width * height * 4);
			for (let i = 0; i < data.length; i += 4) data.set([red, 20, 30, 255], i);
			return { width, height, data };
		};
		const resultOf = (red: number, mode: (typeof ENGINE_MODES)[number]): ItemResult => ({
			ok: true,
			tier: 'webgl2',
			mode: {
				build: mode.build,
				latency: mode.latency,
				sketchThread: mode.sketchThread,
				renderThread: mode.renderThread,
				hold: 1.5,
			},
			width,
			height,
			pixels: Buffer.from(frame(red).data).toString('base64'),
		});
		const root = mkdtempSync(join(tmpdir(), 'null3d-images-'));
		try {
			const harnessDirs = { references: join(root, 'references'), candidates: join(root, 'saved') };
			writePng(join(harnessDirs.references, 'chrome-real-gpu/webgl2/held.png'), frame(10));
			const results: Record<string, ItemResult> = {
				[first.id]: resultOf(10, ENGINE_MODES[0]),
			};
			const context = {
				resultOf: (id: string) => results[id],
				imageDir: root,
				runner: { name: 'mac-firefox', device: 'mac' },
				harnessDirs,
			};
			expect(judge(first.check, results[first.id] as ItemResult, NONE_MISSING, context)).toEqual(
				[],
			);
			const [identity, reference] = judge(
				later.check,
				resultOf(200, ENGINE_MODES[1]),
				NONE_MISSING,
				context,
			) as string[];
			expect(identity).toBe(
				`${width * height} pixels differ from the image of the first thread mode, which every mode must draw`,
			);
			expect(reference).toContain(
				'100.000% of pixels differ from the reference chrome-real-gpu/webgl2/held.png, and at most 0.500% may',
			);
			expect(readdirSync(join(harnessDirs.candidates, 'mac-firefox/webgl2')).sort()).toEqual([
				'held-diff.png',
				'held-reference.png',
				'held.json',
				'held.png',
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('skips a WebGL2 page, and the shaders page, on a browser without WebGL2 only when allowed', () => {
		const webgl2 = items.find((item) => item.id === 'engine-webgl2-pipelined');
		const shaders = items.find((item) => item.id === 'shaders');
		const webgpu = items.find((item) => item.id === 'image-clear-webgpu');
		if (!webgl2 || !shaders || !webgpu) throw new Error('the plan lacks the pages');
		const noWebGL2 = { webgpu: false, webgl2: true };
		const engineMissing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgl2 in this browser.',
		};
		expect(judge(webgl2.check, engineMissing, noWebGL2)).toBe('skip');
		expect(judge(webgl2.check, engineMissing, NONE_MISSING)).toEqual([engineMissing.error]);
		const pageMissing = { ok: false, error: 'no WebGL2 context' };
		expect(judge(shaders.check, pageMissing, noWebGL2)).toBe('skip');
		expect(judge(shaders.check, pageMissing, NO_WEBGPU)).toEqual([pageMissing.error]);
		expect(judge(webgpu.check, pageMissing, noWebGL2)).toEqual([pageMissing.error]);
	});

	it('gives the shaders page more time than other pages, in proportion to its GLSL programs', async () => {
		const shaders = items.find((item) => item.id === 'shaders');
		const programs = glslProgramsOf(await everyShader()).length;
		expect(programs).toBeGreaterThan(100);
		expect(shaders?.timeoutSeconds).toBe(SHADERS_PAGE_SECONDS);
		expect(SHADERS_PAGE_SECONDS).toBeGreaterThan(30 + programs / 4);
	});

	it("runs the shader library's values on both GPU paths, and names each wrong value", () => {
		const library = items.filter((item) => item.check.kind === 'shader-library');
		expect(library.map(({ id, path }) => [id, path])).toEqual([
			['shader-library-webgpu', '/tests/pages/shader-library.html?gpu=webgpu'],
			['shader-library-webgl2', '/tests/pages/shader-library.html?gpu=webgl2'],
		]);
		const check = library[0]?.check;
		if (!check) throw new Error('the plan lacks the shader library page');
		expect(judge(check, { ok: true, cases: 3, mismatches: [] }, NONE_MISSING)).toEqual([]);
		const wrong = { function: 'math::square', expected: [4, 0], got: [4.5, 0] };
		expect(judge(check, { ok: true, cases: 3, mismatches: [wrong] }, NONE_MISSING)).toEqual([
			'math::square: expected 4, 0, got 4.5, 0',
		]);
		const failures = ['lighting: pipeline (internal): the driver failed'];
		expect(judge(check, { ok: true, cases: 3, failures, mismatches: [] }, NONE_MISSING)).toEqual(
			failures,
		);
		expect(judge(check, { ok: true, cases: 0, mismatches: [] }, NONE_MISSING)).toEqual([
			'the page ran no cases',
		]);
		expect(judge(check, { ok: false, error: 'no WebGPU adapter' }, NO_WEBGPU)).toBe('skip');
	});

	it('loads the capabilities page again last, to compare it with the first load', () => {
		expect(items[0]?.id).toBe('capabilities');
		expect(items.at(-1)).toEqual({
			id: 'capabilities-reload',
			path: '/tests/pages/capabilities.html',
			timeoutSeconds: 30,
			check: { kind: 'capabilities-reload', first: 'capabilities' },
		});
	});

	describe('the second load of the capabilities page', () => {
		const reload = items.at(-1);
		if (!reload) throw new Error('the plan has no items');
		/** A capabilities page's result with these answers by name and this supported list. */
		const loaded = (extensions: Record<string, boolean>, listed: string[]): ItemResult => ({
			ok: true,
			report: { webgl2: { extensions, supportedExtensions: listed } },
		});
		const answers = { WEBGL_multi_draw: true, EXT_color_buffer_float: true, OVR_multiview2: false };
		const listed = ['EXT_color_buffer_float', 'EXT_float_blend', 'WEBGL_multi_draw'];
		const first = loaded(answers, listed);
		/** Judges a second load against a first load, and collects what judging noted. */
		const compare = (second: ItemResult, firstLoad: ItemResult | null = first) => {
			const notes: string[] = [];
			const verdict = judge(reload.check, second, NONE_MISSING, {
				resultOf: (id) => (id === 'capabilities' ? (firstLoad ?? undefined) : undefined),
				imageDir: tmpdir(),
				note: (text) => notes.push(text),
			});
			return { verdict, notes };
		};

		it('passes the same answers by name, and only notes a supported list in another order', () => {
			expect(compare(first)).toEqual({
				verdict: [],
				notes: ['the supported extension list came in the same order in both loads'],
			});
			// Brave shuffles the list.
			expect(compare(loaded(answers, [...listed].reverse()))).toEqual({
				verdict: [],
				notes: ['the supported extension list came in another order in the second load'],
			});
			expect(compare(loaded(answers, listed.slice(1))).notes).toEqual([
				'the supported extension list named other extensions in the second load',
			]);
		});

		it('fails an extension whose answer changed between the loads', () => {
			const { WEBGL_multi_draw: _, ...fewer } = answers;
			expect(compare(loaded({ ...fewer, OVR_multiview2: true }, listed)).verdict).toEqual([
				'WEBGL_multi_draw was present in the first load and not asked for in the second',
				'OVR_multiview2 was absent in the first load and present in the second',
			]);
		});

		it('fails when the first load has no report to compare with', () => {
			expect(compare(first, null).verdict).toEqual(['no result from capabilities to compare with']);
			expect(compare(first, { ok: false, error: 'no result within 30 s' }).verdict).toEqual([
				'capabilities has no report to compare with: no result within 30 s',
			]);
			expect(judge(reload.check, first, NONE_MISSING)).toEqual([
				'no result from capabilities to compare with',
			]);
		});
	});

	it('judges isolation from the page result', () => {
		const isolation = items.find((item) => item.id === 'isolation');
		if (!isolation) throw new Error('the plan lacks the isolation page');
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: true, threaded: true }, NONE_MISSING),
		).toEqual([]);
		expect(
			judge(
				isolation.check,
				{ ok: true, crossOriginIsolated: false, threaded: false },
				NONE_MISSING,
			),
		).toEqual(['the page is not cross-origin isolated', 'the threaded build did not load']);
	});

	it('starts and stops the engine again and again in every mode, on kept canvases, and in frames', () => {
		const restarts = items.filter((item) => item.check.kind === 'restarts');
		expect(restarts.map((item) => item.path)).toEqual([
			'/tests/pages/shared-memory.html',
			'/tests/pages/shared-memory.html?latency=low',
			'/tests/pages/shared-memory.html?threads=off',
			'/tests/pages/shared-memory.html?render=main',
			'/tests/pages/shared-memory.html?sketch-thread=main',
			'/tests/pages/shared-memory.html?kinds=frame',
			'/tests/pages/shared-memory.html?kinds=frame&latency=low',
			'/tests/pages/shared-memory.html?kinds=frame&render=main',
			'/tests/pages/shared-memory.html?kinds=canvas-kept',
			'/tests/pages/shared-memory.html?kinds=frame-destroyed',
			'/tests/pages/shared-memory.html?kinds=canvas-kept&latency=low',
			'/tests/pages/shared-memory.html?kinds=frame-destroyed&latency=low',
			'/tests/pages/shared-memory.html?kinds=canvas-kept&sketch-thread=main',
			'/tests/pages/shared-memory.html?kinds=frame-destroyed&sketch-thread=main',
		]);
	});

	it('fails restarts that fail, or whose memory the browser does not get back', () => {
		const [restart] = items.filter((item) => item.check.kind === 'restarts');
		if (!restart) throw new Error('the plan lacks the restart pages');
		const engine = { cycles: 10, roomLater: 5, roomWaitMs: 31_000 };
		const result = (fields: object) => ({
			ok: true,
			room: 6,
			cycles: 10,
			kinds: { engine },
			...fields,
		});
		expect(judge(restart.check, result({}), NONE_MISSING)).toEqual([]);
		expect(
			judge(
				restart.check,
				result({ kinds: { engine: { ...engine, roomLater: 2 } } }),
				NONE_MISSING,
			),
		).toEqual([
			'the browser did not get back the memory of stopped engines within 31 s: it had room for 6 shared memories before 10 starts and stops, and for 2 after',
		]);
		expect(
			judge(
				restart.check,
				result({ kinds: { engine: { ...engine, memoriesMade: 1 } } }),
				NONE_MISSING,
			),
		).toEqual([]);
		expect(
			judge(
				restart.check,
				result({ kinds: { engine: { ...engine, memoriesMade: 3 } } }),
				NONE_MISSING,
			),
		).toEqual([
			'the 10 starts and stops made 3 shared memories, after 0 stops that were not clean: each start after a clean stop should take the memory that the page kept',
		]);
		const stops = [
			{ stopMs: 2_000, jobs: 6, jobsStopped: 5 },
			{ stopMs: 300, jobs: 6, jobsStopped: 6 },
		];
		expect(
			judge(
				restart.check,
				result({ kinds: { engine: { ...engine, memoriesMade: 2, starts: stops } } }),
				NONE_MISSING,
			),
		).toEqual([]);
		const failed = {
			cycles: 2,
			error: 'the engine start took more than 20 s',
			trail: ['10 ms core', '11 ms null3d-sketch: started'],
			roomLater: 6,
		};
		expect(judge(restart.check, result({ kinds: { engine: failed } }), NONE_MISSING)).toEqual([
			"start and stop 3 of 10 failed: the engine start took more than 20 s; the page's last steps: 10 ms core; 11 ms null3d-sketch: started",
		]);
		const notes: string[] = [];
		const context = { resultOf: () => undefined, imageDir: '', note: (t: string) => notes.push(t) };
		const lostOnce = (again: object, roomLater = 2) =>
			result({ kinds: { engine: { ...engine, roomLater, again: { ...engine, ...again } } } });
		expect(
			judge(restart.check, lostOnce({ room: 4, roomLater: 4 }, 4), NONE_MISSING, context),
		).toEqual([]);
		expect(notes).toEqual([
			'the room fell once and then held, so the browser lost address space, not memory that stopped engines hold: it had room for 6 shared memories before 10 starts and stops, and for 4 after, and for 4 after 10 more',
		]);
		expect(judge(restart.check, lostOnce({ room: 2, roomLater: 2 }), NONE_MISSING)).toEqual([
			'the browser did not get back the memory of stopped engines: it had room for 6 shared memories before 10 starts and stops, and for 2 after, and for 2 after 10 more, more than the 2 that lost address space explains',
		]);
		// Room that the second round gets back was late, not lost.
		expect(judge(restart.check, lostOnce({ room: 2, roomLater: 5 }), NONE_MISSING)).toEqual([]);
		const singleThreaded = items.find((item) => item.id === 'restarts-single-threaded');
		if (!singleThreaded) throw new Error('the plan lacks the single-threaded restart page');
		expect(
			judge(singleThreaded.check, lostOnce({ room: 2, roomLater: 2 }), NONE_MISSING, context),
		).toEqual([]);
		expect(notes.at(-1)).toBe(
			'the room fell once and then held, so the browser lost address space, not memory that stopped engines hold: it had room for 6 shared memories before 10 starts and stops, and for 2 after, and for 2 after 10 more',
		);
		expect(judge(restart.check, lostOnce({ room: 4, roomLater: 1 }), NONE_MISSING)).toEqual([
			'the browser did not get back the memory of stopped engines in two rounds: it had room for 6 shared memories before 10 starts and stops, and for 2 after, then for 1 after 10 more within 31 s',
		]);
		expect(
			judge(restart.check, lostOnce({ room: 2, ...failed, error: 'E1109: refused' }), NONE_MISSING),
		).toEqual([
			"start and stop 3 of 10 in the second round failed: E1109: refused; the page's last steps: 10 ms core; 11 ms null3d-sketch: started",
		]);
		const inFrames = items.find((item) => item.id === 'frame-restarts-pipelined');
		if (!inFrames) throw new Error('the plan lacks the restart pages with frames');
		expect(
			judge(
				inFrames.check,
				result({ kinds: { frame: { ...engine, roomLater: 0 } } }),
				NONE_MISSING,
			),
		).toEqual([
			'the browser did not get back the memory of engines in removed frames within 31 s: it had room for 6 shared memories before 10 starts in frames, and for 0 after',
		]);
		expect(judge(inFrames.check, result({}), NONE_MISSING)).toEqual(['the page started no engine']);
		// A fall that the second round held is Safari's, not a leak in the engine: a note.
		const frameNotes: string[] = [];
		const fellInFrames = (again: object) =>
			result({ kinds: { frame: { ...engine, roomLater: 4, again: { ...engine, ...again } } } });
		expect(
			judge(inFrames.check, fellInFrames({ room: 4, roomLater: 3 }), NONE_MISSING, {
				...context,
				note: (t: string) => frameNotes.push(t),
			}),
		).toEqual([]);
		expect(frameNotes).toEqual([
			'Safari kept memory from the first round of engines in removed frames, and the second round held the room: it had room for 6 shared memories before 10 starts in frames, and for 4 after, and for 3 after 10 more',
		]);
		// Room that the second round loses too still fails.
		expect(judge(inFrames.check, fellInFrames({ room: 4, roomLater: 2 }), NONE_MISSING)).toEqual([
			'the browser did not get back the memory of engines in removed frames in two rounds: it had room for 6 shared memories before 10 starts in frames, and for 4 after, then for 2 after 10 more within 31 s',
		]);
		const kept = items.find((item) => item.id === 'canvas-kept-restarts-pipelined');
		const destroyedInFrames = items.find(
			(item) => item.id === 'frame-destroyed-restarts-pipelined',
		);
		if (!kept || !destroyedInFrames)
			throw new Error('the plan lacks the restart pages that keep a worker');
		const keptNotes: string[] = [];
		expect(
			judge(
				kept.check,
				result({ kinds: { 'canvas-kept': { ...engine, roomLater: 1 } } }),
				NONE_MISSING,
				{ ...context, note: (t: string) => keptNotes.push(t) },
			),
		).toEqual([]);
		expect(keptNotes).toEqual([
			'the workers that stayed with the canvases held memory: it had room for 6 shared memories before 10 starts and stops on kept canvases, and for 1 after',
		]);
		expect(
			judge(
				kept.check,
				result({ kinds: { 'canvas-kept': { ...failed, error: 'E1109: refused' } } }),
				NONE_MISSING,
			),
		).toEqual([
			"start and stop on a kept canvas 3 of 10 failed: E1109: refused; the page's last steps: 10 ms core; 11 ms null3d-sketch: started",
		]);
		expect(
			judge(
				destroyedInFrames.check,
				result({ kinds: { 'frame-destroyed': { ...failed, error: 'E1109: refused' } } }),
				NONE_MISSING,
			),
		).toEqual([
			"start and stop in a frame 3 of 10 failed: E1109: refused; the page's last steps: 10 ms core; 11 ms null3d-sketch: started",
		]);
		// Safari keeps a removed frame's page and what it reaches, so held room there is a note.
		const destroyedNotes: string[] = [];
		const heldInFrames = (again?: object) =>
			result({
				kinds: {
					'frame-destroyed': {
						...engine,
						roomLater: 2,
						...(again && { again: { ...engine, ...again } }),
					},
				},
			});
		const noteDestroyed = { ...context, note: (t: string) => destroyedNotes.push(t) };
		expect(judge(destroyedInFrames.check, heldInFrames(), NONE_MISSING, noteDestroyed)).toEqual([]);
		expect(
			judge(
				destroyedInFrames.check,
				heldInFrames({ room: 2, roomLater: 2 }),
				NONE_MISSING,
				noteDestroyed,
			),
		).toEqual([]);
		expect(destroyedNotes).toEqual([
			'Safari kept the memory of stopped engines in removed frames within 31 s: it had room for 6 shared memories before 10 starts and stops in frames, and for 2 after',
			'Safari kept the memory of stopped engines in removed frames within 31 s: it had room for 6 shared memories before 10 starts and stops in frames, and for 2 after, and for 2 after 10 more within 31 s',
		]);
		expect(
			judge(
				destroyedInFrames.check,
				heldInFrames({ room: 2, ...failed, error: 'E1109: refused' }),
				NONE_MISSING,
			),
		).toEqual([
			"start and stop in a frame 3 of 10 in the second round failed: E1109: refused; the page's last steps: 10 ms core; 11 ms null3d-sketch: started",
		]);
	});

	it('runs the restart pages with frames in runner pages of their own', () => {
		const own = items.filter((item) => item.ownTab).map((item) => item.id);
		expect(own).toEqual(
			items
				.filter(
					(item) =>
						item.check.kind === 'restarts' &&
						(item.check.start === 'frame' || item.check.start === 'frame-destroyed'),
				)
				.map((item) => item.id),
		);
		expect(own.length).toBeGreaterThan(0);
	});

	it('quotes the last steps of a page that gave no result', () => {
		const [item] = items;
		if (!item) throw new Error('the plan is empty');
		const trail = Array.from({ length: 8 }, (_, i) => `${i} ms step ${i}`);
		expect(
			judge(item.check, { ok: false, error: 'no result within 30 s', trail }, NONE_MISSING),
		).toEqual([
			"no result within 30 s; the page's last steps: 2 ms step 2; 3 ms step 3; 4 ms step 4; 5 ms step 5; 6 ms step 6; 7 ms step 7",
		]);
	});
});

describe('the parity plan', () => {
	const items = parityPlan();
	const item = (id: string) => {
		const found = items.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`the plan lacks ${id}`);
		return found;
	};
	/** A hold page's result: a small frame of one color, as the benchmark pages publish it. */
	const holdResult = (rgb: number[], extra: Record<string, unknown> = {}): ItemResult => {
		const size = 16;
		const pixels = new Uint8Array(size * size * 4);
		for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
		return {
			ok: true,
			scene: 's1',
			n: 1000,
			width: size,
			height: size,
			pixels: Buffer.from(pixels).toString('base64'),
			...extra,
		};
	};
	const THREE_WEBGPU = 'parity-s1-threejs-webgpu';
	const NULL3D_WEBGPU = 'parity-s1-null3d-webgpu';

	it('opens every hold page once and pairs each null3d page with three.js on its tier', () => {
		expect(PLANS.parity).toBe(parityPlan);
		// Per scene: two three.js pages and three null3D pages, one per GPU tier.
		expect(items).toHaveLength(25);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		// Compatibility mode needs WebGPU, and it is compared with three.js's WebGPU page.
		expect(item('parity-s1-null3d-compat').check).toEqual({
			kind: 'parity',
			tier: 'webgpu',
			scene: 's1',
			pair: { candidate: 'null3d-compat', reference: 'threejs-webgpu' },
		});
		// Every page draws at the references' preset, which a phone would otherwise not choose.
		for (const { path } of items)
			expect(path).toMatch(/^\/bench\/pages\/.+\.html\?.+&hold&preset=high$/);
		const pairs = items.flatMap(({ id, check }) =>
			check.kind === 'parity' ? [`${id} ${check.pair.reference}`] : [],
		);
		expect(pairs).toEqual(
			['s1', 's1-static', 's1-cells', 's2', 's5'].flatMap((scene) => [
				`parity-${scene}-null3d-webgpu threejs-webgpu`,
				`parity-${scene}-null3d-compat threejs-webgpu`,
				`parity-${scene}-null3d-webgl2 threejs-webgl`,
			]),
		);
		expect(item('parity-s2-null3d-webgl2').path).toBe(
			'/bench/pages/null3d/s2.html?gpu=webgl2&hold&preset=high',
		);
	});

	it("keeps each null3D page with its scene's three.js pages, which its check compares with", () => {
		expect(itemsNeeded(item('parity-s1-threejs-webgl').check)).toEqual([]);
		expect(itemsNeeded(item('parity-s2-null3d-webgl2').check)).toEqual([
			'parity-s2-threejs-webgl',
			'parity-s2-threejs-webgpu',
		]);
		expect(itemsNeeded(item('parity-s1-static-null3d-compat').check)).toEqual([
			'parity-s1-static-threejs-webgpu',
			'parity-s1-static-threejs-webgl',
		]);
		// Each scene is one group of five pages, so two shards split the five scenes 15 to 10.
		const scenes = (index: number) => [
			...new Set(
				(planItems(parseArgs(['--plan', 'parity', '--shard', `${index}/2`, 'Safari'])) ?? []).map(
					({ id }) => id.replace(/^parity-(.+)-(threejs|null3d)-.+$/, '$1'),
				),
			),
		];
		expect(scenes(1)).toEqual(['s1', 's1-cells', 's5']);
		expect(scenes(2)).toEqual(['s1-static', 's2']);
	});

	it('passes a three.js page with a frame, and skips it without WebGPU only when allowed', () => {
		const { check } = item(THREE_WEBGPU);
		expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING)).toEqual([]);
		expect(judge(check, holdResult([10, 20, 30], { pixels: 'AAAA' }), NONE_MISSING)).toEqual([
			'the frame holds 3 bytes, not the 1024 that 16 x 16 RGBA8 pixels need',
		]);
		const fellBack = {
			ok: false,
			error: 'three.js could not start WebGPU and switched to WebGL 2. See the console.',
		};
		expect(judge(check, fellBack, NO_WEBGPU)).toBe('skip');
		expect(judge(check, fellBack, NONE_MISSING)).toEqual([fellBack.error]);
		const noGpu = { ok: false, error: 'This browser has no WebGPU. Use ?renderer=webgl.' };
		expect(judge(item('parity-s1-threejs-webgl').check, noGpu, NO_WEBGPU)).toEqual([noGpu.error]);
	});

	it('compares a null3d frame with the three.js frame of its tier from the same run', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const results: Record<string, ItemResult> = { [THREE_WEBGPU]: holdResult([10, 20, 30]) };
			const context = { resultOf: (id: string) => results[id], imageDir };
			const { check } = item(NULL3D_WEBGPU);
			expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING, context)).toEqual([]);
			const name = 's1-null3d-webgpu-vs-threejs-webgpu';
			const images = [`${name}-inputs.png`, `${name}-diff.png`];
			expect(readdirSync(imageDir).sort()).toEqual([...images].sort());
			expect(judge(check, holdResult([200, 20, 30]), NONE_MISSING, context)).toEqual([
				`against ${THREE_WEBGPU}, 100.000% of pixels differ; three.js's rule allows under 0.1%. Images: ${images.map((file) => join(imageDir, file)).join(', ')}`,
			]);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('falls back to the stored baseline where three.js cannot draw with both renderers', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const THREE_WEBGL = 'parity-s1-threejs-webgl';
			// Only the WebGL page drew: the device has no WebGPU.
			const results: Record<string, ItemResult> = {
				[THREE_WEBGL]: holdResult([10, 20, 30]),
				[THREE_WEBGPU]: { ok: false, error: 'This browser has no WebGPU' },
			};
			const { check } = item('parity-s1-null3d-webgl2');
			// A quarter of the frame differs: over three.js's rule, under a stored 30%.
			const quarter = holdResult([10, 20, 30]);
			const pixels = Buffer.from(quarter.pixels as string, 'base64');
			for (let i = 0; i < pixels.length / 4; i += 4) pixels[i] = 200;
			const frame = { ...quarter, pixels: pixels.toString('base64') };
			const resultOf = (id: string) => results[id];
			expect(judge(check, frame, NO_WEBGPU, { resultOf, imageDir })).toHaveLength(1);
			expect(
				judge(check, frame, NO_WEBGPU, { resultOf, imageDir, storedBaselines: { s1: 0.3 } }),
			).toEqual([]);
			const [problem] = judge(check, frame, NO_WEBGPU, {
				resultOf,
				imageDir,
				storedBaselines: { s1: 0.1 },
			}) as string[];
			expect(problem).toContain(
				"25.000% of pixels differ; three.js's rule allows under 0.1%, and three.js's two renderers differ by 10.000%, in bench/parity-baselines.json from a device that draws with both",
			);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('says what is missing when a frame cannot be compared', () => {
		const { check } = item(NULL3D_WEBGPU);
		const frame = holdResult([10, 20, 30]);
		const withReference = (reference: ItemResult | undefined) => ({
			resultOf: (id: string) => (id === THREE_WEBGPU ? reference : undefined),
			imageDir: join(tmpdir(), 'null3d-parity-unused'),
		});
		const noReference = [`no result from ${THREE_WEBGPU} to compare with`];
		expect(judge(check, frame, NONE_MISSING)).toEqual(noReference);
		expect(judge(check, frame, NONE_MISSING, withReference(undefined))).toEqual(noReference);
		expect(
			judge(
				check,
				frame,
				NONE_MISSING,
				withReference({ ok: false, error: 'no result within 60 s' }),
			),
		).toEqual([`${THREE_WEBGPU} has no frame to compare with: no result within 60 s`]);
		expect(
			judge(check, holdResult([10, 20, 30], { n: 10 }), NONE_MISSING, withReference(frame)),
		).toEqual(['the pages drew different object counts: 10 and 1000']);
		expect(judge(check, { ok: false, error: 'no result within 60 s' }, NONE_MISSING)).toEqual([
			'no result within 60 s',
		]);
	});
});

describe('the bench plan', () => {
	it('runs each page five times by default, and the pages take turns run by run', () => {
		const items = benchPlan();
		expect(items).toHaveLength(37);
		expect(items.slice(0, 7).map((item) => item.id)).toEqual([
			'bench-s1-null3d-webgpu-1',
			'bench-s1-null3d-webgl2-1',
			'bench-s1-null3d-webgpu-low-1',
			'bench-s1-null3d-webgl2-low-1',
			'bench-s1-threejs-webgpu-1',
			'bench-s1-threejs-webgl-1',
			'bench-s1-scene-code-1',
		]);
		expect(items.at(-3)?.id).toBe('bench-s1-scene-code-5');
		// Both latency modes run, so a device's results compare them. The first run of each null3D
		// page captures its frame after its measured seconds.
		expect(items[2]).toEqual({
			id: 'bench-s1-null3d-webgpu-low-1',
			path: '/__null3d/load/warm/{run}.{runner}.bench/bench/pages/null3d/s1.html?gpu=webgpu&latency=low&capture',
			timeoutSeconds: 95,
			check: { kind: 'bench', tier: 'webgpu', scene: 's1', page: 'null3d-webgpu-low' },
		});
		expect(items.slice(7).filter((item) => item.path.includes('capture'))).toEqual([]);
		// After the timed runs, each scene's visual check on each GPU path, at the desktop's preset.
		expect(items.at(-1)).toEqual({
			id: 'visual-s1-webgl2',
			path: '/tests/pages/visual.html?gpu=webgl2&scene=%2Fbench%2Fpages%2Fnull3d%2Fs1-sketch.ts%3Fn%3D100000&size=640x360&images&preset=high',
			timeoutSeconds: 600,
			check: { kind: 'visual', tier: 'webgl2', scene: 's1' },
		});
	});

	it('times each page for the seconds given, both to warm up and to measure', () => {
		const [item] = benchPlan({ count: 250_000, runs: 1, seconds: 300 });
		expect(item?.path).toContain('seconds=300');
		expect(item?.path).toContain('n=250000');
		expect(item?.timeoutSeconds).toBe(2 * 300 + 60);
		expect(parseArgs(['--plan', 'bench', '--seconds', '300', 'Safari']).seconds).toBe(300);
		expect(() => parseArgs(['--plan', 'memory', '--seconds', '300'])).toThrow(
			'--seconds works with --plan bench, showcase or occlusion-s6 only',
		);
		expect(parseArgs(['--plan', 'showcase', '--seconds', '60', 'Safari']).seconds).toBe(60);
		expect(parseArgs(['--plan', 'occlusion-s6', '--seconds', '5', 'Safari']).seconds).toBe(5);
	});

	it('takes the number of runs and the instance count', () => {
		const items = benchPlan({ runs: 2, count: 1000 });
		expect(items).toHaveLength(16);
		expect(items.every((item) => decodeURIComponent(item.path).includes('n=1000'))).toBe(true);
	});

	it("runs null3D's two GPU paths at each job worker count, every count in each run", () => {
		const items = benchPlan({ runs: 2, count: 300_000, jobs: [2, 4] });
		expect(PLANS.bench).toBe(benchPlan);
		expect(items.map((item) => item.id)).toEqual([
			'bench-s1-null3d-webgpu-jobs2-1',
			'bench-s1-null3d-webgl2-jobs2-1',
			'bench-s1-null3d-webgpu-jobs4-1',
			'bench-s1-null3d-webgl2-jobs4-1',
			'bench-s1-null3d-webgpu-jobs2-2',
			'bench-s1-null3d-webgl2-jobs2-2',
			'bench-s1-null3d-webgpu-jobs4-2',
			'bench-s1-null3d-webgl2-jobs4-2',
		]);
		expect(items[3]).toEqual({
			id: 'bench-s1-null3d-webgl2-jobs4-1',
			path: '/__null3d/load/warm/{run}.{runner}.bench/bench/pages/null3d/s1.html?gpu=webgl2&n=300000&jobs=4',
			timeoutSeconds: 95,
			check: { kind: 'bench', tier: 'webgl2', scene: 's1', page: 'null3d-webgl2', jobs: 4 },
		});
	});

	it('takes the pages and scenes to compare, each page on the GPU interface it draws with', () => {
		const items = benchPlan({
			runs: 1,
			pages: ['null3d-webgl2', 'null3d-webgl2-low'],
			scenes: ['s1-static', 's2'],
		});
		expect(items.map((item) => item.id)).toEqual([
			'bench-s1-static-null3d-webgl2-1',
			'bench-s1-static-null3d-webgl2-low-1',
			'bench-s2-null3d-webgl2-1',
			'bench-s2-null3d-webgl2-low-1',
			'visual-s1-static-webgl2',
			'visual-s2-webgl2',
		]);
		expect(items[1]?.path).toBe(
			'/__null3d/load/warm/{run}.{runner}.bench/bench/pages/null3d/s1-static.html?gpu=webgl2&latency=low&capture',
		);
		expect(items[1]?.check).toEqual({
			kind: 'bench',
			tier: 'webgl2',
			scene: 's1-static',
			page: 'null3d-webgl2-low',
		});
		const sweep = benchPlan({ runs: 1, jobs: [2], pages: ['null3d-webgpu-low'], scenes: ['s2'] });
		expect(sweep.map((item) => item.id)).toEqual(['bench-s2-null3d-webgpu-low-jobs2-1']);
	});

	it('fails a run with no frames, and an engine run with no CPU time', () => {
		const pages = benchPlan({ runs: 1, scenes: ['s2'] });
		const engine = pages.find(
			({ check }) => check.kind === 'bench' && check.page === 'null3d-webgpu',
		);
		const sceneCode = pages.find(
			({ check }) => check.kind === 'bench' && check.page === 'scene-code',
		);
		if (!engine || !sceneCode) throw new Error('the plan lacks the pages');
		const run = (frames: number, median: number) => ({ ok: true, frames, cpuMs: { median } });
		expect(judge(engine.check, run(1800, 0.3), NONE_MISSING)).toEqual([]);
		expect(judge(engine.check, run(0, 0), NONE_MISSING)).toEqual(['the run measured no frames']);
		expect(judge(engine.check, run(1800, 0), NONE_MISSING)).toEqual([
			'the run recorded no CPU time',
		]);
		// S2's scene code takes less than one step of the browser's timer.
		expect(judge(sceneCode.check, run(1800, 0), NONE_MISSING)).toEqual([]);
		expect(judge(sceneCode.check, run(0, 0), NONE_MISSING)).toEqual(['the run measured no frames']);
	});

	it('fails a run whose engine started another number of job workers than it asked for', () => {
		const [item] = benchPlan({ runs: 1, jobs: [4] });
		if (!item) throw new Error('the plan has no items');
		const run = (jobWorkers: number) => ({
			ok: true,
			frames: 300,
			cpuMs: { median: 2.1 },
			mode: { build: 'threaded', jobWorkers },
		});
		expect(judge(item.check, run(4), NONE_MISSING)).toEqual([]);
		expect(judge(item.check, run(8), NONE_MISSING)).toEqual([
			'started 8 job workers, not the 4 that ?jobs= asked for',
		]);
		// Without the switch, any count passes.
		const [plain] = benchPlan({ runs: 1 });
		if (!plain) throw new Error('the plan has no items');
		expect(judge(plain.check, run(8), NONE_MISSING)).toEqual([]);
	});

	it("summarizes a device's runs apart for each job worker count", () => {
		const items = benchPlan({ runs: 2, jobs: [2, 4] });
		/** A null3D run whose sketch worker takes less time with more job workers. */
		const result = (id: string): ItemResult => {
			const sketchMs = id.includes('-jobs2-') ? 3 : 2.5;
			const at = { median: sketchMs, p95: sketchMs, p99: sketchMs };
			return {
				ok: true,
				frames: 300,
				cpuMs: { ...at, mean: sketchMs },
				intervalMs: { median: 16.7, p95: 17, p99: 18 },
				stats: {
					cpuMsAllThreads: { median: sketchMs + 1 },
					gpuMs: null,
					uploadBytes: { median: 0 },
					drawCalls: { median: 1 },
					threads: {
						'sketch-worker': { busyMs: at, phases: { update: { median: 2 } } },
						'job-0': { busyMs: { median: 0.5 }, phases: {} },
					},
				},
			};
		};
		const lines = benchSummary(items, result)?.split('\n') ?? [];
		expect(lines[0]).toContain('| Scene | Job workers | Page |');
		expect(lines.slice(2)).toEqual([
			'| s1 | 2 | null3d-webgpu | 2 | 3.00 (3.00 to 3.00) | sketch-worker 3.00 | 1.00 | 1.00 |',
			'| s1 | 2 | null3d-webgl2 | 2 | 3.00 (3.00 to 3.00) | sketch-worker 3.00 | 1.00 | 1.00 |',
			'| s1 | 4 | null3d-webgpu | 2 | 2.50 (2.50 to 2.50) | sketch-worker 2.50 | 0.50 | 0.50 |',
			'| s1 | 4 | null3d-webgl2 | 2 | 2.50 (2.50 to 2.50) | sketch-worker 2.50 | 0.50 | 0.50 |',
		]);
		// Without job worker counts, the summary compares the pages as the protocol does: a row per
		// page, then how null3D compares with three.js.
		const plain = benchSummary(benchPlan({ runs: 1 }), result)?.split('\n') ?? [];
		expect(plain[0]).toContain('| Scene | Page | Runs |');
		expect(plain.slice(2, 10).map((line) => line.split(' | ')[1])).toEqual([
			'null3d-webgpu',
			'null3d-webgl2',
			'null3d-webgpu-low',
			'null3d-webgl2-low',
			'threejs-webgpu',
			'threejs-webgl',
			'scene-code',
			undefined,
		]);
		expect(plain[10]).toStartWith('s1: null3d on WebGPU takes');
		expect(benchSummary(memoryPlan({ runs: 1 }), result)).toBeUndefined();
	});

	it("judges each visual check by its scene's limits, and saves its frames in the run", () => {
		const root = mkdtempSync(join(tmpdir(), 'visual-'));
		const [visual] = benchPlan({ runs: 1, scenes: ['s4'], pages: ['null3d-webgpu'] }).slice(1);
		if (visual?.check.kind !== 'visual') throw new Error('the plan has no visual check');
		const png = Buffer.from('a PNG file').toString('base64');
		const figures = (
			changedPercent: number,
			offsetPixels: number,
			gap = 0.03,
			acne = 0.03,
		): ItemResult => ({
			ok: true,
			stability: { changedPercent, meanChangedPercent: 0, shadowedPercent: 23 },
			edges: { offsetPixels },
			contact: { feet: 300, meanGapPixels: gap, gapPercent: 1, tops: 200, meanRimPixels: 2.6 },
			acne: { pixels: 27000, meanShadowPercent: acne, shadowedPercent: 0 },
			images: { 'moving-1': png },
		});
		const context = { resultOf: () => undefined, imageDir: root };
		expect(judge(visual.check, figures(0.004, 0.09), NONE_MISSING, context)).toEqual([]);
		expect(readFileSync(join(root, 'frames', 's4-webgpu', 'moving-1.png'), 'utf8')).toBe(
			'a PNG file',
		);
		expect(judge(visual.check, figures(1.86, 0.14, 0.2, 0.72), NONE_MISSING, context)).toEqual([
			'1.860% of the pixels changed their shadow between frames, over the limit of 0.05%',
			`shadow edges stray 0.140 px from the reference's, over the limit of ${VISUAL_LIMITS.s4?.edgeOffsetPixels} px`,
			`the light between casters' feet and their shadows measures 0.200 px, over the limit of ${VISUAL_LIMITS.s4?.contactGapPixels} px`,
			`the shadow on open lit ground measures 0.720 %, over the limit of ${VISUAL_LIMITS.s4?.acnePercent} %`,
		]);
	});

	it('prints the visual figures beside the timings of the null3D pages, and marks those over', () => {
		const items = benchPlan({
			runs: 1,
			scenes: ['s4'],
			pages: ['null3d-webgpu', 'threejs-webgpu'],
		});
		const result = (id: string): ItemResult =>
			id.startsWith('visual-')
				? {
						ok: true,
						stability: { changedPercent: 1.86, meanChangedPercent: 1.8, shadowedPercent: 23 },
						edges: { offsetPixels: 0.095 },
						contact: {
							feet: 300,
							meanGapPixels: 0.03,
							gapPercent: 1,
							tops: 200,
							meanRimPixels: 2.6,
						},
						acne: { pixels: 27000, meanShadowPercent: 0.72, shadowedPercent: 0 },
					}
				: {
						ok: true,
						frames: 300,
						cpuMs: { median: 2, p95: 2, p99: 2, mean: 2 },
						intervalMs: { median: 16.7, p95: 17, p99: 18 },
					};
		const lines = benchSummary(items, result)?.split('\n') ?? [];
		expect(lines[0]).toContain(
			'| GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % |',
		);
		const cells = (line: string | undefined) => line?.split(' | ').slice(10, 14);
		expect(cells(lines[2])).toEqual([
			'1.860 OVER 0.05',
			'0.095',
			'0.030',
			`0.720 OVER ${VISUAL_LIMITS.s4?.acnePercent}`,
		]);
		expect(cells(lines[3])).toEqual(['n/a', 'n/a', 'n/a', 'n/a']);
	});
});

describe('the memory plan', () => {
	/** An engine page's result: started with shared memory, or with the single-threaded build. */
	const loaded = (build = 'threaded'): ItemResult => ({ ok: true, mode: { build, jobWorkers: 8 } });
	const ALLOCATION_ERROR = 'WebAssembly.Memory(): could not allocate memory';
	const allocationFailed: ItemResult = { ok: false, error: ALLOCATION_ERROR };

	it('counts the room and then loads the engine page 20 times at each maximum, from low to high', () => {
		const items = memoryPlan();
		expect(PLANS.memory).toBe(memoryPlan);
		expect(MEMORY_MAXIMUMS_MIB).toEqual([256, 512, 1024, 2048, 4096]);
		expect(items).toHaveLength(105);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		expect(items[0]).toEqual({
			id: 'room-256',
			path: '/tests/pages/shared-memory.html?kinds=dropped&cycles=1&room=full&maximum=4096',
			timeoutSeconds: 150,
			check: { kind: 'room', maximumMiB: 256 },
		});
		expect(items[1]).toEqual({
			id: 'memory-256-1',
			path: '/tests/pages/engine.html?memory=256&seconds=2',
			timeoutSeconds: 45,
			check: { kind: 'memory', maximumMiB: 256 },
		});
		expect(items[21]?.id).toBe('room-512');
		expect(items.at(-1)?.id).toBe('memory-4096-20');
		expect(memoryPlan({ runs: 2 }).map(({ id }) => id)).toEqual(
			MEMORY_MAXIMUMS_MIB.flatMap((maximum) => [
				`room-${maximum}`,
				`memory-${maximum}-1`,
				`memory-${maximum}-2`,
			]),
		);
		expect(memoryPlan({ runs: 0 }).map(({ id }) => id)).toEqual(
			MEMORY_MAXIMUMS_MIB.map((maximum) => `room-${maximum}`),
		);
	});

	it('passes a load only when the engine started with shared memory', () => {
		const item = memoryPlan({ runs: 1 }).find(({ check }) => check.kind === 'memory');
		if (!item) throw new Error('the plan has no loads');
		expect(judge(item.check, loaded(), NONE_MISSING)).toEqual([]);
		expect(judge(item.check, loaded('single'), NONE_MISSING)).toEqual([
			'the engine started without shared memory, so the load tested no maximum',
		]);
		expect(judge(item.check, allocationFailed, NO_WEBGPU)).toEqual([ALLOCATION_ERROR]);
	});

	it('passes a room count only when the page counted its room', () => {
		const room = memoryPlan({ runs: 0 })[0];
		if (!room) throw new Error('the plan has no room counts');
		expect(judge(room.check, { ok: true, room: 6 }, NONE_MISSING)).toEqual([]);
		expect(judge(room.check, { ok: true }, NONE_MISSING)).toEqual([
			'the page did not count its room',
		]);
	});

	it('counts the loads that started the engine at each maximum, and names the largest that always did', () => {
		const items = memoryPlan({ runs: 3 });
		const results: Record<string, ItemResult> = {};
		for (const { id } of items) results[id] = loaded();
		results['memory-2048-2'] = allocationFailed;
		results['memory-4096-1'] = allocationFailed;
		results['memory-4096-2'] = allocationFailed;
		// The browser closed the runner's tab during the last load.
		delete results['memory-4096-3'];
		results['room-256'] = { ok: true, room: 64 };
		results['room-512'] = { ok: true, room: 30 };
		results['room-1024'] = { ok: true, room: 6 };
		results['room-2048'] = { ok: true, room: 2 };
		results['room-4096'] = { ok: false, error: 'no result within 60 s' };
		expect(memorySummary(items, (id) => results[id])?.split('\n')).toEqual([
			'| Memory maximum | Loads that started the engine | Engines that fit at once | Why the other loads failed |',
			'| --- | --- | --- | --- |',
			'| 256 MiB | 3 of 3 | 64 or more | none |',
			'| 512 MiB | 3 of 3 | 30 | none |',
			'| 1024 MiB | 3 of 3 | 6 | none |',
			`| 2048 MiB | 2 of 3 | 2 | 1 load: ${ALLOCATION_ERROR} |`,
			`| 4096 MiB | 0 of 3 | not counted | 2 loads: ${ALLOCATION_ERROR}; 1 load: ${NO_RESULT} |`,
			'',
			'The largest maximum that loaded 3 of 3 times: 1024 MiB.',
		]);
		const nothing = memorySummary(items, () => allocationFailed);
		expect(nothing?.split('\n').at(-1)).toBe('No maximum loaded every time.');
		expect(memorySummary(benchPlan({ runs: 1 }), () => loaded())).toBeUndefined();
		const roomOnly = memoryPlan({ runs: 0 });
		expect(memorySummary(roomOnly, () => ({ ok: true, room: 1 }))?.split('\n')).toContain(
			'| 4096 MiB | not loaded | 1 | none |',
		);
	});
});

describe('the startup plan', () => {
	const PIPELINED = ENGINE_MODES[0] as EngineMode;
	/** A startup load's result: the engine page's times, and what the server sent. */
	const loaded = (frameDoneMs: number, build = 'threaded'): ItemResult => ({
		ok: true,
		createEngineAtMs: 40,
		mode: {
			build,
			latency: 'pipelined',
			sketchThread: 'worker',
			renderThread: 'render-worker',
			jobWorkers: 8,
		},
		capabilities: { tier: 'webgpu' },
		stats: {
			load: {
				probeMs: 30,
				coreMs: 60,
				engineStartMs: 90,
				firstFrameMs: frameDoneMs - 10,
				firstFrameDoneMs: frameDoneMs,
			},
		},
		downloads: { requests: 11, bytes: 2048, files: [] },
	});

	it('fills the cache in each mode first, then loads every mode cold and warm in each run', () => {
		const items = startupPlan();
		expect(PLANS.startup).toBe(startupPlan);
		const modes = ENGINE_MODES.length;
		expect(STARTUP_RUNS).toBe(5);
		expect(items).toHaveLength(modes + 5 * modes * 2);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		expect(items.slice(0, modes).map(({ id }) => id)).toEqual([
			'startup-pipelined-warm-first',
			'startup-low-latency-warm-first',
			'startup-single-threaded-warm-first',
			'startup-drawing-on-the-main-thread-warm-first',
			'startup-sketch-on-the-main-thread-warm-first',
		]);
		expect(items[0]).toEqual({
			id: 'startup-pipelined-warm-first',
			path: '/__null3d/load/warm/{run}.{runner}.pipelined-warm/tests/pages/engine.html?seconds=0.2',
			timeoutSeconds: 60,
			check: { kind: 'startup', mode: PIPELINED, load: 'warm', first: true },
		});
		expect(items[modes]).toEqual({
			id: 'startup-pipelined-cold-1',
			path: '/__null3d/load/cold/{run}.{runner}.pipelined-cold-1/tests/pages/engine.html?seconds=0.2',
			timeoutSeconds: 60,
			check: { kind: 'startup', mode: PIPELINED, load: 'cold' },
		});
		expect(items[modes + 1]?.path).toBe(items[0]?.path.replace('-first', ''));
		expect(items[modes + 3]?.path).toBe(
			'/__null3d/load/warm/{run}.{runner}.low-latency-warm/tests/pages/engine.html?seconds=0.2&latency=low',
		);
		expect(items.at(-1)?.id).toBe('startup-sketch-on-the-main-thread-warm-5');
		expect(startupPlan({ runs: 1 })).toHaveLength(modes + modes * 2);
		// A later warm load needs its mode's first warm load, which fills the cache.
		const needed = (index: number) => itemsNeeded((items[index] as (typeof items)[number]).check);
		expect(needed(modes + 1)).toEqual(['startup-pipelined-warm-first']);
		expect(needed(0)).toEqual([]);
		expect(needed(modes)).toEqual([]);
	});

	it('passes a load in its mode with its times and downloads', () => {
		const item = startupPlan({ runs: 1 })[ENGINE_MODES.length];
		if (!item) throw new Error('the plan has no cold load');
		expect(judge(item.check, loaded(500), NONE_MISSING)).toEqual([]);
		expect(judge(item.check, loaded(500, 'single'), NONE_MISSING)).toEqual([
			'loaded the single build',
		]);
		expect(judge(item.check, { ...loaded(500), downloads: undefined }, NO_WEBGPU)).toEqual([
			'the server counted no requests for the load',
		]);
		expect(judge(item.check, { ok: false, error: 'E1301: no usable GPU path' }, NO_WEBGPU)).toEqual(
			['E1301: no usable GPU path'],
		);
	});

	it("reports the medians of each mode's cold and warm loads, without the loads that fill the cache", () => {
		const items = startupPlan({ runs: 3 }).filter(({ check }) =>
			check.kind === 'startup' ? check.mode === PIPELINED : false,
		);
		const results: Record<string, ItemResult> = {
			'startup-pipelined-warm-first': loaded(9000),
			'startup-pipelined-cold-1': loaded(900),
			'startup-pipelined-cold-2': loaded(700),
			'startup-pipelined-cold-3': loaded(800, 'single'),
			'startup-pipelined-warm-1': loaded(300),
			'startup-pipelined-warm-2': loaded(500),
		};
		const lines = startupSummary(items, (id) => results[id])?.split('\n') ?? [];
		expect(lines.slice(0, 4)).toEqual([
			'| Thread mode | Load | GPU | Loads | Script, ms | Probe, ms | Core, ms | Ready, ms | Frame, ms | Frame done, ms | Requests | KB |',
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
			'| pipelined | cold | webgpu | 2 | 40 | 70 | 100 | 130 | 790 | 800 | 11 | 2.0 |',
			'| pipelined | warm | webgpu | 2 | 40 | 70 | 100 | 130 | 390 | 400 | 11 | 2.0 |',
		]);
		expect(lines[5]).toStartWith('Each time is a median');
		expect(startupSummary(benchPlan({ runs: 1 }), () => loaded(1))).toBeUndefined();
	});
});

describe('parseArgs', () => {
	it('runs no Brave in bun run devices, while a run can still name it', async () => {
		const scripts = (await Bun.file(join(import.meta.dir, '../../package.json')).json()).scripts;
		const devices = String(scripts.devices).split(' && ').at(-1)!.split(' ').slice(2);
		expect(devices.join(' ')).not.toContain('brave');
		expect(parseArgs(devices)).toMatchObject({ android: ['chrome'], lan: ['ipad-safari'] });
		expect(parseArgs(['--android', 'brave', '--lan', 'ipad-brave'])).toMatchObject({
			android: ['brave'],
			lan: ['ipad-brave'],
		});
	});

	it('reads the plan, the flags, the device lists and the macOS apps', () => {
		expect(
			parseArgs([
				'--allow-no-webgpu',
				'--android',
				'chrome,brave',
				'--lan',
				'ipad-safari',
				'Safari',
			]),
		).toEqual({
			plan: 'checks',
			missing: { webgpu: true, webgl2: false },
			apps: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
			cloud: [],
		});
		expect(parseArgs(['--allow-no-webgl2', 'Firefox']).missing).toEqual({
			webgpu: false,
			webgl2: true,
		});
		expect(parseArgs(['--plan', 'bench', '--n', '30000', 'Safari']).count).toBe(30000);
		expect(parseArgs(['--plan', 'bench', '--runs', '3', 'Safari']).runs).toBe(3);
		expect(parseArgs(['--plan', 'scale', '--android', 'chrome']).plan).toBe('scale');
		expect(parseArgs(['--plan', 'memory', 'Safari']).plan).toBe('memory');
		expect(parseArgs(['--plan', 'startup', '--runs', '2', 'Safari'])).toMatchObject({
			plan: 'startup',
			runs: 2,
		});
		expect(parseArgs(['--plan', 'bench', '--jobs', '2,4,6,8', 'Safari']).jobs).toEqual([
			2, 4, 6, 8,
		]);
		expect(() => parseArgs(['--n', 'many'])).toThrow('--n: use a whole number of at least 1');
		expect(() => parseArgs(['--runs', '-1'])).toThrow('--runs: use a whole number of at least 0');
		expect(() => parseArgs(['--runs', '0'])).toThrow('--runs 0 works with --plan memory only');
		expect(parseArgs(['--plan', 'memory', '--runs', '0', 'Safari']).runs).toBe(0);
		expect(() => parseArgs(['--plan', 'bench', '--jobs', '0'])).toThrow(
			'--jobs: use a comma-separated list of whole numbers above 0',
		);
		expect(() => parseArgs(['--plan', 'memory', '--jobs', '2'])).toThrow(
			'--jobs works with --plan bench only',
		);
		expect(() => parseArgs(['--plan', 'nothing'])).toThrow('no plan named nothing');
		expect(
			parseArgs(['--plan', 'bench', '--pages', 'null3d-webgl2,threejs-webgl', '--scenes', 's2']),
		).toMatchObject({ pages: ['null3d-webgl2', 'threejs-webgl'], scenes: ['s2'] });
		expect(() => parseArgs(['--plan', 'bench', '--pages', 'null3d-webgl3'])).toThrow(
			'--pages: use some of',
		);
		expect(() => parseArgs(['--plan', 'bench', '--scenes', ''])).toThrow('--scenes: use some of');
		expect(() => parseArgs(['--plan', 'parity', '--scenes', 's2'])).toThrow(
			'--scenes works with --plan bench, showcase, soak or scale only',
		);
		expect(parseArgs(['--plan', 'soak', '--scenes', 's5,s6']).scenes).toEqual(['s5', 's6']);
		expect(parseArgs(['--plan', 'showcase', '--scenes', 's6']).scenes).toEqual(['s6']);
		expect(() =>
			parseArgs(['--plan', 'bench', '--jobs', '2', '--pages', 'null3d-webgl2,threejs-webgl']),
		).toThrow('leave out threejs-webgl');
		expect(parseArgs(['--shard', '2/3', 'Safari']).shard).toEqual({ index: 2, count: 3 });
		for (const shard of ['0/2', '3/2', '1', '1/2/3', 'one/two'])
			expect(() => parseArgs(['--shard', shard])).toThrow('--shard: use <i>/<n>');
		expect(parseArgs(['--plan', 'scale', '--scenes', 's5']).scenes).toEqual(['s5']);
		expect(() => parseArgs(['--plan', 'scale', '--scenes', 's1,s4'])).toThrow(
			'the scale plan searches s1 and s5 only; leave out s4',
		);
		expect(() => parseArgs(['--plan', 'scale', '--shard', '1/2'])).toThrow(
			'--shard picks items of a fixed plan, so it does not work with --plan scale',
		);
		expect(parseArgs(['--only', 'a,b', '--rounds', '3', 'Safari'])).toMatchObject({
			only: ['a', 'b'],
			rounds: 3,
		});
		expect(() => parseArgs(['--only', ','])).toThrow('--only: name some items');
		expect(() => parseArgs(['--rounds', '0'])).toThrow(
			'--rounds: use a whole number of at least 1',
		);
		expect(() => parseArgs(['--plan', 'scale', '--rounds', '2'])).toThrow(
			'--rounds picks items of a fixed plan',
		);
		const restarts = planItems(
			parseArgs(['--only', 'restarts-sketch-on-the-main-thread', '--rounds', '2', 'Safari']),
		);
		expect(restarts?.map(({ id }) => id)).toEqual([
			'restarts-sketch-on-the-main-thread',
			'restarts-sketch-on-the-main-thread-round-2',
		]);
		expect(() => planItems(parseArgs(['--only', 'no-such-page', 'Safari']))).toThrow(
			'the plan has no item no-such-page',
		);
		expect(() => planItems(parseArgs(['--plan', 'depth', '--shard', '50/50']))).toThrow(
			'shard 50 of 50 has no items',
		);
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});

	it('gives every page of the plan the switches of --switches', () => {
		const plain = planItems(parseArgs(['--plan', 'depth'])) ?? [];
		const half = planItems(parseArgs(['--plan', 'depth', '--switches', 'half=on'])) ?? [];
		expect(half.map((item) => item.path)).toEqual(plain.map((item) => `${item.path}&half=on`));
		const bench = parseArgs(['--plan', 'bench', '--switches', 'half=on&preset=ultra']);
		expect(planItems(bench)?.every((item) => item.path.endsWith('&half=on&preset=ultra'))).toBe(
			true,
		);
		const checks = parseArgs(['--plan', 'governor', '--switches', 'render=main&display-check=off']);
		expect(checks.switches).toBe('render=main&display-check=off');
		expect(() => parseArgs(['--switches', '?half=on'])).toThrow(
			'--switches: give page switches without the ?',
		);
	});
});

describe('the device protocol', () => {
	it("takes the state of Brave's Shields", () => {
		expect(parseArgs(['--shields', 'off', '--android', 'brave']).shields).toBe('off');
		expect(parseArgs(['Safari']).shields).toBeUndefined();
		expect(() => parseArgs(['--shields', 'default'])).toThrow('--shields: use on or off');
		expect(() => parseArgs(['--shields'])).toThrow('--shields: use on or off');
	});

	it("lists the device settings to check before a run, and Brave's Shields where Brave runs", () => {
		const phone = ['sm-s926b-chrome', 'sm-s926b-brave'];
		const lines = deviceChecklist(phone, 'on');
		expect(lines[1]).toStartWith('- The display runs at a fixed refresh rate');
		expect(lines.slice(2, -1)).toEqual([
			'- Low Power Mode and battery saver are off.',
			'- The screen brightness is fixed, with automatic brightness off.',
			'- The device has rested and is cool. Nobody touches it during the run.',
		]);
		expect(lines.at(-1)).toBe("- Brave's Shields are on for this site, as --shields on records.");
		expect(deviceChecklist(phone, undefined).at(-1)).toBe(
			"- Brave's Shields are in the state you want to test. Add --shields on or --shields off to record it.",
		);
		expect(deviceChecklist(['ipad-safari'], undefined)).toEqual(lines.slice(0, -1));
	});

	it('records the Shields state for Brave only, known by its name or by its runner page', () => {
		expect(braveShieldsOf('sm-s926b-brave', undefined, 'on')).toBe('on');
		expect(braveShieldsOf('ipad-browser', { brave: true }, 'off')).toBe('off');
		expect(braveShieldsOf('mac-brave-browser', { brave: true }, undefined)).toBeNull();
		expect(braveShieldsOf('sm-s926b-chrome', { brave: false }, 'on')).toBeUndefined();
	});

	it("shows Brave's Shields in the summary line of a Brave runner", () => {
		const counts = { pass: 16, skip: 0, fail: 1 };
		expect(summaryLine('sm-s926b-chrome', counts)).toBe(
			'sm-s926b-chrome: 16 passed, 0 skipped, 1 failed',
		);
		expect(summaryLine('sm-s926b-brave', { ...counts, braveShields: 'off' })).toBe(
			'sm-s926b-brave: 16 passed, 0 skipped, 1 failed; Brave Shields off',
		);
		expect(summaryLine('ipad-brave', { ...counts, braveShields: null })).toBe(
			'ipad-brave: 16 passed, 0 skipped, 1 failed; Brave Shields not recorded',
		);
	});
});

describe('the depth plan', () => {
	const items = depthPlan();

	it("runs the manifest's depth precision tests on each tier and in each forced mode", () => {
		expect(PLANS.depth).toBe(depthPlan);
		expect(items.map((item) => item.id)).toEqual([
			'image-depth-precision-webgpu',
			'image-depth-precision-compat',
			'image-depth-precision-webgl2',
			'image-depth-precision-standard-webgl2',
			'image-depth-precision-reversed-gl-webgl2',
			'image-depth-precision-reversed-webgl2',
		]);
		expect(items.find((item) => item.id.endsWith('reversed-gl-webgl2'))?.path).toBe(
			'/tests/pages/depth-precision.html?gpu=webgl2&hold=0&preset=high&depth=reversed-gl',
		);
		expect(items.every((item) => item.check.kind === 'image')).toBe(true);
	});

	it('sums the fighting pixels by distance, and notes a browser without EXT_clip_control', () => {
		const tiles = PRECISION.distances.map((distance, k) => ({
			distance,
			pixels: 1000,
			fighting: k === 10 ? 250 : 0,
		}));
		const calm = tiles.map((tile) => ({ ...tile, fighting: 0 }));
		const results: Record<string, ItemResult> = {
			'image-depth-precision-webgpu': { ok: false, error: 'no WebGPU adapter' },
			'image-depth-precision-standard-webgl2': {
				ok: true,
				depth: 'standard',
				clipControl: true,
				fighting: 250,
				tiles,
			},
			'image-depth-precision-reversed-webgl2': {
				ok: true,
				depth: 'reversed-gl',
				clipControl: false,
				fighting: 0,
				tiles: calm,
			},
		};
		const lines = depthSummary(items, (id) => results[id])?.split('\n') ?? [];
		expect(lines[0]).toStartWith('| Test | Tier | Depth drawn | Fighting pixels | 1 m | 2.5 m |');
		expect(lines[0]).toEndWith('| 1.6 km | 4 km | 10 km |');
		expect(lines[2]).toStartWith('| depth-precision | webgpu | no WebGPU adapter |');
		expect(lines[3]).toStartWith(`| depth-precision | compat | ${NO_RESULT}`);
		expect(lines[5]).toBe(
			`| depth-precision-standard | webgl2 | standard | 250 | ${'0 | '.repeat(10)}25.0% |`,
		);
		expect(lines[7]).toBe(
			`| depth-precision-reversed | webgl2 | reversed-gl (no EXT_clip_control) | 0 | ${'0 | '.repeat(11).trimEnd()}`,
		);
	});
});

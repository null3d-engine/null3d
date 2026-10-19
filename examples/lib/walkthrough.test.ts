import { describe, expect, test } from 'bun:test';
import type { RampResult, RampStep } from './ramp';
import {
	atDisplayCap,
	startingStep,
	summaryRows,
	summaryWins,
	WalkthroughFlow,
	type WalkthroughStep,
	winsSentences,
} from './walkthrough';

/** A ramp result of the given steps, which the summary reads. */
function rampOf(steps: Array<[number, number] | [number, number, 'noFrame']>): RampResult {
	const measured: RampStep[] = steps.map(([count, fps, flag], step) => ({
		step,
		count,
		fps,
		cpuMs: null,
		...(flag === 'noFrame' && { noFrame: true }),
	}));
	return {
		floorFps: 20,
		held: measured.at(-1)?.count ?? 0,
		drew: measured.at(-1)?.count ?? 0,
		skipped: [],
		stopReason: 'maximum',
		steps: measured,
	};
}

describe('the walkthrough flow', () => {
	test('goes from the intro through both ramps to the summary', () => {
		const flow = new WalkthroughFlow('null3d');
		expect(flow.step).toBe('intro');
		expect(flow.act('start')).toEqual({
			step: 'null3d-ramp',
			engine: 'null3d',
			reload: false,
		});
		expect(flow.engine).toBe('null3d');
		expect(flow.act('done')).toEqual({
			step: 'threejs-ramp',
			engine: 'threejs',
			reload: true,
		});
		expect(flow.act('done')).toEqual({
			step: 'summary',
			engine: 'threejs',
			reload: false,
		});
		// The summary waits for the viewer: no action moves it on.
		expect(flow.act('done')).toBeNull();
		expect(flow.act('skip')).toBeNull();
		expect(flow.step).toBe('summary');
	});

	test('starts null3D from a three.js page, which loads the other page', () => {
		const flow = new WalkthroughFlow('threejs');
		expect(flow.act('start')).toEqual({
			step: 'null3d-ramp',
			engine: 'null3d',
			reload: true,
		});
	});

	test('a skip moves on as a finished ramp does', () => {
		const flow = new WalkthroughFlow('null3d');
		flow.act('start');
		expect(flow.act('skip')).toMatchObject({ step: 'threejs-ramp', engine: 'threejs' });
		expect(flow.act('skip')).toMatchObject({ step: 'summary', engine: 'threejs' });
	});

	test('a stop ends the run from every step, and nothing moves it after', () => {
		const steps: Array<[WalkthroughStep, 'null3d' | 'threejs']> = [
			['intro', 'null3d'],
			['null3d-ramp', 'null3d'],
			['threejs-ramp', 'threejs'],
			['summary', 'threejs'],
		];
		for (const [step, engine] of steps) {
			const flow = new WalkthroughFlow(engine, step);
			expect(flow.act('stop')).toMatchObject({ step: 'stopped', engine });
			expect(flow.step).toBe('stopped');
			// The run is over: no ramp, start or stop moves it again.
			for (const action of ['start', 'done', 'skip', 'stop'] as const)
				expect(flow.act(action)).toBeNull();
			expect(flow.step).toBe('stopped');
		}
	});

	test('starts again from the summary or a stop, on null3D', () => {
		for (const step of ['summary', 'stopped'] as const) {
			const flow = new WalkthroughFlow('threejs', step);
			expect(flow.act('restart')).toEqual({
				step: 'intro',
				engine: 'null3d',
				reload: true,
			});
		}
		const early = new WalkthroughFlow('null3d', 'null3d-ramp');
		expect(early.act('restart')).toBeNull();
	});

	test('reads the page that the address names', () => {
		expect(startingStep(null, 'null3d', false)).toBe('intro');
		expect(startingStep('off', 'null3d', false)).toBe('intro');
		expect(startingStep('go', 'null3d', false)).toBe('null3d-ramp');
		expect(startingStep('go', 'threejs', true)).toBe('threejs-ramp');
		// A three.js page with no first ramp has nothing to continue.
		expect(startingStep('go', 'threejs', false)).toBe('intro');
	});
});

describe('the walkthrough summary', () => {
	test('joins both ramps by count, in ascending order', () => {
		const rows = summaryRows(
			rampOf([
				[1000, 120],
				[1200, 90],
				[1440, 60],
			]),
			rampOf([
				[1000, 120],
				[1200, 60],
				[1440, 30],
			]),
			120,
		);
		expect(rows.map((row) => row.count)).toEqual([1000, 1200, 1440]);
		expect(rows.map((row) => row.ratio)).toEqual([1, 1.5, 2]);
		// 120 sits at the display's rate of 120, and is marked at its cap.
		expect(rows.map((row) => row.null3dAtCap)).toEqual([true, false, false]);
		expect(rows.map((row) => row.threejsAtCap)).toEqual([true, false, false]);
	});

	test('keeps a count that only one engine measured, with no ratio', () => {
		const rows = summaryRows(
			rampOf([
				[100, 60],
				[200, 40],
				[400, 30],
			]),
			rampOf([
				[100, 60],
				[200, 25],
			]),
			60,
		);
		expect(rows).toHaveLength(3);
		expect(rows[2]).toMatchObject({ count: 400, null3d: 30, threejs: null, ratio: null });
	});

	test('reads a count that drew no frame as no figure', () => {
		const rows = summaryRows(
			rampOf([
				[100, 60],
				[200, 0, 'noFrame'],
				[400, 30],
			]),
			rampOf([
				[100, 60],
				[200, 50],
				[400, 45],
			]),
			60,
		);
		expect(rows[1]).toMatchObject({ count: 200, null3d: null, threejs: 50, ratio: null });
		expect(rows[2]).toMatchObject({ count: 400, ratio: 30 / 45 });
	});

	test('marks a figure at the display cap within the measurement noise', () => {
		expect(atDisplayCap(120, 120)).toBe(true);
		expect(atDisplayCap(114, 120)).toBe(true);
		expect(atDisplayCap(113, 120)).toBe(false);
		expect(atDisplayCap(57, 60)).toBe(true);
		expect(atDisplayCap(56, 60)).toBe(false);
		expect(atDisplayCap(60, 0)).toBe(false);
		expect(atDisplayCap(0, 60)).toBe(false);
	});

	test('says which engine drew more frames a second, and leaves out the display cap', () => {
		const rows = summaryRows(
			rampOf([
				[100, 60],
				[200, 60],
				[400, 25],
			]),
			rampOf([
				[100, 60],
				[200, 40],
				[400, 30],
			]),
			60,
		);
		// At 100 both sit at the display's rate; at 200 and 400 the figures differ.
		expect(summaryWins(rows)).toEqual({ null3d: [200], threejs: [400], measured: [200, 400] });
		expect(winsSentences(summaryWins(rows))).toEqual([
			'null3D drew more frames a second at 1 of the 2 counts where neither engine sat at the display cap.',
			'three.js drew more frames a second at 1 of the 2 counts where neither engine sat at the display cap.',
		]);
	});

	test('says nothing about a win when every count sits at the display cap', () => {
		const rows = summaryRows(rampOf([[100, 60]]), rampOf([[100, 60]]), 60);
		const wins = summaryWins(rows);
		expect(wins.measured).toEqual([]);
		expect(winsSentences(wins)).toEqual([]);
	});
});

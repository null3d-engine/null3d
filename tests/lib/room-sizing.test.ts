import { describe, expect, test } from 'bun:test';
import { roomSteps, rowCost, type Step } from '../../packages/engine/src/gpu/environment-steps';
import { drawKind, runsWhole, type Sizing, StepPlanner } from '../pages/lib/room-sizing';

const [steps] = roomSteps(256, 6, 256);

/** Runs a planner over the map, with each step's time from a rate per kind of draw. */
function plan(sizing: Sizing, msPerUnit: (kind: string) => number) {
	const planner = new StepPlanner(steps, { sizing, slices: 32, targetMs: 6, probeShare: 1 / 16 });
	const out = [];
	for (let step = planner.next(); step; step = planner.next()) {
		const ms = step.bands.reduce((sum, band) => {
			const s = steps[band.step] as Step;
			return sum + band.rows * rowCost(s) * msPerUnit(drawKind(s));
		}, 0);
		planner.record(ms);
		out.push({ bands: step.bands, ms, probe: step.probe });
	}
	return out;
}

describe('the room planner', () => {
	for (const sizing of ['fixed', 'first', 'adaptive', 'kind', 'level'] as const)
		test(`${sizing} covers every row of every draw once, in order`, () => {
			const rows = plan(sizing, () => 1e-5).flatMap((s) =>
				s.bands.flatMap((b) => Array.from({ length: b.rows }, (_, i) => `${b.step}/${b.y + i}`)),
			);
			const all = steps.flatMap((s, k) => Array.from({ length: s.size }, (_, y) => `${k}/${y}`));
			expect(rows).toEqual(all);
		});

	test('kind keeps steps near the target when the kinds differ ten times in cost', () => {
		const rate = (kind: string) => (kind.startsWith('prefilter') ? 1e-6 : 1e-7);
		const out = plan('kind', rate);
		const sized = out.filter((s) => !s.probe);
		expect(Math.max(...sized.map((s) => s.ms))).toBeLessThan(6.5);
	});

	test('level runs each small filter level whole, in a step of its own', () => {
		const out = plan('level', () => 1e-5);
		const whole = steps.flatMap((s, k) => (runsWhole(s) ? [k] : []));
		expect(whole.map((k) => (steps[k] as Step).level)).toEqual([3, 4, 5]);
		for (const k of whole) {
			const holding = out.filter((s) => s.bands.some((b) => b.step === k));
			expect(holding.map((s) => s.bands)).toEqual([
				[{ step: k, y: 0, rows: (steps[k] as Step).size }],
			]);
		}
	});
});

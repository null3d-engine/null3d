// Sympodial leaders: a stem whose own continuation collapses runs on into its thick limb, bending a
// little at each node instead of at once; a limb runs on only into a child near its own line; and a
// grown oak's bole and limbs keep no sharp kink or loop.
import { describe, expect, it } from 'bun:test';
import { AXIS_LIMB, AXIS_STEM, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { loadPlantCode } from '../generate';
import { species } from '../species/pedunculate-oak';
import { leadOnThickest } from './leaders';
import { grower } from './models';

/** Degrees between two internodes that meet at a node: from `a` to `b`, then `b` to `c`. */
function bend(p: Float32Array, a: number, b: number, c: number): number {
	const u = [0, 1, 2].map((k) => (p[b * 3 + k] as number) - (p[a * 3 + k] as number));
	const v = [0, 1, 2].map((k) => (p[c * 3 + k] as number) - (p[b * 3 + k] as number));
	const dot =
		(u[0] as number) * (v[0] as number) +
		(u[1] as number) * (v[1] as number) +
		(u[2] as number) * (v[2] as number);
	const cosine = dot / (Math.hypot(...u) * Math.hypot(...v));
	return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/** The sharpest bend along an axis's own nodes. */
function sharpest(skeleton: MacroSkeleton, axis: number): number {
	let most = 0;
	for (
		let n = (skeleton.axes.first[axis] as number) + 1;
		n < (skeleton.axes.last[axis] as number);
		n++
	)
		most = Math.max(most, bend(skeleton.position, n - 1, n, n + 1));
	return most;
}

/**
 * An axis of four upright nodes whose continuation collapses to a twig past the third, and a limb
 * of the axis's girth that leaves the third at sixty degrees and runs on for five internodes.
 */
function collapsed(kind: number, order: number): MacroSkeleton {
	const b = new SkeletonBuilder();
	const axis = b.addAxis({ parent: -1, parentNode: -1, order, kind });
	const nodes: number[] = [];
	for (let k = 0; k < 6; k++)
		nodes.push(
			b.addNode({
				x: 0,
				y: k,
				z: 0,
				radius: k <= 3 ? 0.5 : 0.02,
				parent: k === 0 ? -1 : (nodes[k - 1] as number),
				axis,
			}),
		);
	const fork = nodes[3] as number;
	const limb = b.addAxis({
		parent: axis,
		parentNode: fork,
		parentT: 0,
		order: order + 1,
		kind: AXIS_LIMB,
	});
	const angle = (60 * Math.PI) / 180;
	let previous = fork;
	for (let k = 1; k <= 5; k++)
		previous = b.addNode({
			x: Math.sin(angle) * k,
			y: 3 + Math.cos(angle) * k,
			z: 0,
			radius: 0.48 - 0.05 * k,
			parent: previous,
			axis: limb,
		});
	return b.finish(0);
}

describe('sympodial leaders', () => {
	it('runs a collapsed stem on into its steep limb, bending at most twenty degrees at a node', () => {
		const grown = collapsed(AXIS_STEM, 0);
		const led = leadOnThickest(grown);
		// The stem now holds its own four nodes and the limb's five; the twig is a side axis.
		expect((led.axes.last[0] as number) - (led.axes.first[0] as number) + 1).toBe(9);
		expect(led.axes.count).toBe(2);
		expect(sharpest(led, 0)).toBeLessThanOrEqual(20.01);
		// The limb's internodes keep their lengths.
		const p = led.position;
		const first = led.axes.first[0] as number;
		for (let n = first + 4; n <= (led.axes.last[0] as number); n++)
			expect(
				Math.hypot(
					(p[n * 3] as number) - (p[(n - 1) * 3] as number),
					(p[n * 3 + 1] as number) - (p[(n - 1) * 3 + 1] as number),
					(p[n * 3 + 2] as number) - (p[(n - 1) * 3 + 2] as number),
				),
			).toBeCloseTo(1, 4);
	});

	it('keeps a limb whose thick child leaves steeply off its line', () => {
		const grown = collapsed(AXIS_LIMB, 1);
		const led = leadOnThickest(grown);
		expect(led).toBe(grown);
	});

	it('grows an oak whose bole bends gently and whose limbs do not loop back', async () => {
		const record = species.record;
		await loadPlantCode(record);
		for (const variant of [0, 1]) {
			const led = leadOnThickest(
				grower('self-organizing').grow({ record, seed: 11, variant, season: 'summer' }),
			);
			expect(sharpest(led, 0)).toBeLessThanOrEqual(20.01);
			// Each axis's internodes against the way it set out: a limb that turns past a right angle
			// has looped back on itself.
			const { axes, position: p } = led;
			let looped = 0;
			for (let a = 1; a < axes.count; a++) {
				const first = axes.first[a] as number;
				const start = axes.parentNode[a] as number;
				for (let n = first + 1; n <= (axes.last[a] as number); n++) {
					const u = [0, 1, 2].map(
						(k) => (p[first * 3 + k] as number) - (p[start * 3 + k] as number),
					);
					const v = [0, 1, 2].map((k) => (p[n * 3 + k] as number) - (p[(n - 1) * 3 + k] as number));
					const dot =
						(u[0] as number) * (v[0] as number) +
						(u[1] as number) * (v[1] as number) +
						(u[2] as number) * (v[2] as number);
					if (dot < 0) {
						looped++;
						break;
					}
				}
			}
			expect(looped / axes.count).toBeLessThan(0.01);
		}
	});
});

// Sympodial leaders: an axis whose own continuation collapses runs on into a thick child near its
// line, and divides into a fork where the thick child leaves steeply; a grown oak keeps no cone where
// an axis collapsed, no loop and a straight bole to its fork.
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
 * of the axis's girth that leaves the third at an angle and runs on for five internodes.
 */
function collapsed(kind: number, order: number, degrees = 60): MacroSkeleton {
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
	const angle = (degrees * Math.PI) / 180;
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

/** The cones: nodes where an axis over a fifth of a metre thick drops to under half of it at its next. */
function cones(skeleton: MacroSkeleton): number {
	const { axes, radius } = skeleton;
	let found = 0;
	for (let a = 0; a < axes.count; a++)
		for (let n = axes.first[a] as number; n < (axes.last[a] as number); n++)
			if ((radius[n] as number) > 0.2 && (radius[n + 1] as number) < 0.5 * (radius[n] as number))
				found++;
	return found;
}

describe('sympodial leaders', () => {
	it('divides a collapsed stem into a fork where its thick limb leaves steeply', () => {
		const led = leadOnThickest(collapsed(AXIS_STEM, 0));
		// The stem ends at the fork; the limb and the stem's old twig both leave its last node.
		expect((led.axes.last[0] as number) - (led.axes.first[0] as number) + 1).toBe(4);
		expect(led.axes.count).toBe(3);
		for (let a = 1; a < led.axes.count; a++)
			expect(led.axes.parentNode[a]).toBe(led.axes.last[0] as number);
		expect(cones(led)).toBe(0);
		expect(sharpest(led, 0)).toBe(0);
	});

	it('runs a collapsed limb on into a thick child near its line', () => {
		const led = leadOnThickest(collapsed(AXIS_LIMB, 1, 30));
		expect((led.axes.last[0] as number) - (led.axes.first[0] as number) + 1).toBe(9);
		expect(led.axes.count).toBe(2);
		expect(cones(led)).toBe(0);
	});

	it('grows an oak with a plumb, straight bole to its fork, and no cone or loop', async () => {
		const record = species.record;
		await loadPlantCode(record);
		for (const variant of [0, 1]) {
			const led = leadOnThickest(
				grower('self-organizing').grow({ record, seed: 11, variant, season: 'summer' }),
			);
			expect(sharpest(led, 0)).toBeLessThan(20);
			// The bole stands plumb below the crown: no internode leans more than a few degrees.
			const bole = led.position;
			for (let n = led.axes.first[0] as number; n < (led.axes.last[0] as number); n++) {
				if ((bole[n * 3 + 1] as number) >= led.crownBase) break;
				const rise = (bole[(n + 1) * 3 + 1] as number) - (bole[n * 3 + 1] as number);
				const across = Math.hypot(
					(bole[(n + 1) * 3] as number) - (bole[n * 3] as number),
					(bole[(n + 1) * 3 + 2] as number) - (bole[n * 3 + 2] as number),
				);
				expect((Math.atan2(across, rise) * 180) / Math.PI).toBeLessThan(5);
			}
			expect(cones(led)).toBe(0);
			// Each axis's internodes against the way it set out: a level limb may dip a little past a
			// right angle, but one that turns past 120 degrees has looped back on itself.
			const { axes, position: p } = led;
			let looped = 0;
			for (let a = 1; a < axes.count; a++) {
				const first = axes.first[a] as number;
				const start = axes.parentNode[a] as number;
				const u = [0, 1, 2].map((k) => (p[first * 3 + k] as number) - (p[start * 3 + k] as number));
				for (let n = first + 1; n <= (axes.last[a] as number); n++) {
					const v = [0, 1, 2].map((k) => (p[n * 3 + k] as number) - (p[(n - 1) * 3 + k] as number));
					const dot =
						(u[0] as number) * (v[0] as number) +
						(u[1] as number) * (v[1] as number) +
						(u[2] as number) * (v[2] as number);
					if (dot < -0.5 * Math.hypot(...u) * Math.hypot(...v)) {
						looped++;
						break;
					}
				}
			}
			expect(looped).toBe(0);
		}
	});
});

// The saguaro's frame as the column grower lays it: the record's arms in their tiers, spread round
// the stem or in one plane; each arm one smooth path that never turns more between two nodes than
// the shared curve allows and ends plumb; every areole and flower site set in the skin the wood
// mesher draws; and no shoot at a site that carries a flower.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { MOST_TURN } from '../core/arch';
import { AXIS_ARM, BUD_AREOLE, BUD_FLOWER, type MacroSkeleton } from '../core/graph';
import { acos } from '../core/math';
import type { Column } from '../core/record';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';

/** The saguaro's kit in a form, with its grown variants. */
async function saguaro(form?: string) {
	const module = await loadSpecies('saguaro');
	await loadPlantCode(module.record);
	const kit = buildKitNow(module, {
		placeholders: 'missing',
		detail: 'high',
		...(form ? { form } : {}),
	});
	const grow = (variant: number) => growPlantNow(kit, { seed: 11, variant, near: true });
	return { kit, grow, growth: kit.record.growth as Column };
}

/** The node positions of one axis, 3 numbers a node. */
function nodesOf(skeleton: MacroSkeleton, axis: number): number[][] {
	const out: number[][] = [];
	for (let n = skeleton.axes.first[axis] as number; n <= (skeleton.axes.last[axis] as number); n++)
		out.push([
			skeleton.position[n * 3] as number,
			skeleton.position[n * 3 + 1] as number,
			skeleton.position[n * 3 + 2] as number,
		]);
	return out;
}

/** The arms of a skeleton: each axis of the arm kind. */
function armsOf(skeleton: MacroSkeleton): number[] {
	const arms: number[] = [];
	for (let a = 0; a < skeleton.axes.count; a++)
		if ((skeleton.axes.kind[a] as number) === AXIS_ARM) arms.push(a);
	return arms;
}

/** Degrees between each pair of neighbouring segments of a run of points. */
function turns(points: readonly number[][]): number[] {
	const found: number[] = [];
	for (let i = 1; i + 1 < points.length; i++) {
		const [a, b, c] = [points[i - 1], points[i], points[i + 1]] as [number[], number[], number[]];
		const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
		const v = [0, 1, 2].map((k) => (c[k] as number) - (b[k] as number));
		const dot = u.reduce((sum, x, k) => sum + x * (v[k] as number), 0);
		const length = Math.sqrt(
			u.reduce((sum, x) => sum + x * x, 0) * v.reduce((sum, x) => sum + x * x, 0),
		);
		found.push((acos(Math.min(1, Math.max(-1, dot / length))) * 180) / Math.PI);
	}
	return found;
}

/** The distance from a point to a triangle. */
function toTriangle(p: number[], a: number[], b: number[], c: number[]): number {
	const sub = (x: number[], y: number[]) =>
		[0, 1, 2].map((k) => (x[k] as number) - (y[k] as number));
	const dot = (x: number[], y: number[]) =>
		x.reduce((sum, value, k) => sum + value * (y[k] as number), 0);
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	let nearest: number[];
	if (d1 <= 0 && d2 <= 0) nearest = a;
	else {
		const bp = sub(p, b);
		const d3 = dot(ab, bp);
		const d4 = dot(ac, bp);
		const cp = sub(p, c);
		const d5 = dot(ab, cp);
		const d6 = dot(ac, cp);
		const vc = d1 * d4 - d3 * d2;
		const vb = d5 * d2 - d1 * d6;
		const va = d3 * d6 - d5 * d4;
		if (d3 >= 0 && d4 <= d3) nearest = b;
		else if (d6 >= 0 && d5 <= d6) nearest = c;
		else if (vc <= 0 && d1 >= 0 && d3 <= 0)
			nearest = a.map((x, k) => x + (ab[k] as number) * (d1 / (d1 - d3)));
		else if (vb <= 0 && d2 >= 0 && d6 <= 0)
			nearest = a.map((x, k) => x + (ac[k] as number) * (d2 / (d2 - d6)));
		else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
			nearest = b.map((x, k) => x + ((c[k] as number) - x) * w);
		} else {
			const v = vb / (va + vb + vc);
			const w = vc / (va + vb + vc);
			nearest = a.map((x, k) => x + (ab[k] as number) * v + (ac[k] as number) * w);
		}
	}
	return Math.sqrt(dot(sub(p, nearest), sub(p, nearest)));
}

describe('the saguaro frame', () => {
	it("gives every variant the record's arms, each leaving and ending where its tier says", async () => {
		const { grow, growth } = await saguaro();
		const count = growth.arms.count as { mean: number; spread: number };
		for (let variant = 0; variant < 6; variant++) {
			const { skeleton } = grow(variant);
			const arms = armsOf(skeleton);
			expect(arms.length).toBeGreaterThanOrEqual(Math.round(count.mean - count.spread));
			expect(arms.length).toBeLessThanOrEqual(Math.round(count.mean + count.spread));
			arms.forEach((arm, k) => {
				const tier = growth.arms.tiers[k % growth.arms.tiers.length];
				if (!tier) throw new Error('the record names no tier');
				const nodes = nodesOf(skeleton, arm);
				const base = (nodes[0] as number[])[1] as number;
				const tip = (nodes[nodes.length - 1] as number[])[1] as number;
				const at = tier.at as { mean: number; spread: number };
				const top = tier.top as { mean: number; spread: number };
				// An arm leaves from the stem's node nearest its height, a node's spacing away at most.
				expect(Math.abs(base / skeleton.height - at.mean)).toBeLessThanOrEqual(at.spread + 0.02);
				expect(Math.abs(tip / skeleton.height - top.mean)).toBeLessThanOrEqual(top.spread + 0.01);
			});
		}
	});

	it('draws each arm as one smooth path that turns one way and ends plumb', async () => {
		const { grow } = await saguaro();
		for (let variant = 0; variant < 6; variant++) {
			const { skeleton } = grow(variant);
			for (const arm of armsOf(skeleton)) {
				const nodes = nodesOf(skeleton, arm);
				for (const turn of turns(nodes)) expect(turn).toBeLessThanOrEqual(MOST_TURN[0] + 1e-3);
				// Height never falls once the arm has turned upward, and the last stretch is plumb.
				const lowest = Math.min(...nodes.map((n) => n[1] as number));
				const from = nodes.findIndex((n) => n[1] === lowest);
				for (let i = from + 1; i < nodes.length; i++)
					expect((nodes[i] as number[])[1] as number).toBeGreaterThanOrEqual(
						(nodes[i - 1] as number[])[1] as number,
					);
				const [a, b] = [nodes[nodes.length - 2], nodes[nodes.length - 1]] as [number[], number[]];
				expect(Math.abs((b[0] as number) - (a[0] as number))).toBeLessThan(1e-6);
				expect(Math.abs((b[2] as number) - (a[2] as number))).toBeLessThan(1e-6);
			}
		}
	});

	it('spreads the arms round the stem, and stands them in one plane in the flat form', async () => {
		const headingsOf = (skeleton: MacroSkeleton): number[] =>
			armsOf(skeleton).map((arm) => {
				const first = skeleton.axes.first[arm] as number;
				const joint = skeleton.axes.parentNode[arm] as number;
				return Math.atan2(
					(skeleton.position[first * 3 + 2] as number) -
						(skeleton.position[joint * 3 + 2] as number),
					(skeleton.position[first * 3] as number) - (skeleton.position[joint * 3] as number),
				);
			});
		const round = await saguaro();
		for (let variant = 0; variant < 6; variant++) {
			const headings = headingsOf(round.grow(variant).skeleton).sort((a, b) => a - b);
			const even = (2 * Math.PI) / headings.length;
			headings.forEach((heading, k) => {
				const next = headings[(k + 1) % headings.length] as number;
				const gap = (next - heading + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
				// No gap between neighbours is wider than an even share and the two arms' own stray.
				expect(gap).toBeLessThanOrEqual(even + 0.4 + 1e-6);
			});
		}
		const flat = await saguaro('flat');
		for (let variant = 0; variant < 6; variant++) {
			const headings = headingsOf(flat.grow(variant).skeleton);
			for (const heading of headings) {
				const off = Math.abs(Math.sin(heading - (headings[0] as number)));
				expect(off).toBeLessThan(1e-6);
			}
		}
	});

	it(
		'sets every areole and flower site in the skin the wood mesher draws',
		async () => {
			const { kit, grow } = await saguaro();
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true, season: 'blossom' });
			const wood = asset.levels[0].parts.find((part) => part.name === 'wood');
			if (!wood) throw new Error('the level holds no wood');
			const { min, max } = kit.box;
			const place = (i: number): number[] =>
				[0, 1, 2].map(
					(k) =>
						(min[k] as number) +
						((wood.arrays.positions[i * 3 + k] as number) / 65535) *
							((max[k] as number) - (min[k] as number)),
				);
			const { indices } = wood.arrays;
			const triangles: number[][][] = [];
			for (let t = 0; t < indices.length; t += 3)
				triangles.push([
					place(indices[t] as number),
					place(indices[t + 1] as number),
					place(indices[t + 2] as number),
				]);
			const { buds } = asset.skeleton;
			const areoles: number[] = [];
			const flowers: number[] = [];
			for (let b = 0; b < buds.count; b++)
				if ((buds.kind[b] as number) === BUD_AREOLE) areoles.push(b);
				else if ((buds.kind[b] as number) === BUD_FLOWER) flowers.push(b);
			expect(flowers.length).toBeGreaterThan(0);
			// Every flower site and an even sample of the areoles, the arms' among them.
			const sample = [...flowers, ...areoles.filter((_, k) => k % 37 === 0)];
			let worst = 0;
			for (const b of sample) {
				const site = [0, 1, 2].map((k) => buds.position[b * 3 + k] as number);
				let nearest = Number.POSITIVE_INFINITY;
				for (const [a, bb, c] of triangles as [number[], number[], number[]][]) {
					// A triangle far above or below the site cannot be the nearest.
					if (Math.abs((a[1] as number) - (site[1] as number)) > 0.6) continue;
					nearest = Math.min(nearest, toTriangle(site, a, bb, c));
				}
				worst = Math.max(worst, nearest);
			}
			// A site stands 8 mm inside its crest, and a drawn crest lies up to 8 mm under the true one.
			expect(worst).toBeLessThan(0.016);
			expect(grow(0).skeleton.buds.count).toBe(buds.count);
		},
		scaledBudget(60_000),
	);

	it('draws one spine cluster at each areole and no shoot at a flower site', async () => {
		const { grow } = await saguaro();
		const { skeleton, shoots } = grow(0);
		let areoles = 0;
		for (let b = 0; b < skeleton.buds.count; b++)
			if ((skeleton.buds.kind[b] as number) === BUD_AREOLE) areoles++;
		expect(shoots.count).toBe(areoles);
	});

	it('grows the same plant each time', async () => {
		const { grow } = await saguaro();
		const a = grow(2).skeleton;
		const b = grow(2).skeleton;
		expect(a.position).toEqual(b.position);
		expect(a.radius).toEqual(b.radius);
		expect(a.buds.position).toEqual(b.buds.position);
		expect(a.buds.frame).toEqual(b.buds.frame);
	});
});

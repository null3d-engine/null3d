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
import { toTriangle } from './body.fixture';

/** The saguaro's kit, with its grown variants. */
async function saguaro() {
	const module = await loadSpecies('saguaro');
	await loadPlantCode(module.record);
	const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
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

	it('stands the first variant in one plane and spreads the others round the stem', async () => {
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
		const { grow, growth } = await saguaro();
		expect(growth.arms.plane).toBe(1);
		const primary = headingsOf(grow(0).skeleton);
		for (const heading of primary)
			expect(Math.abs(Math.sin(heading - (primary[0] as number)))).toBeLessThan(1e-6);
		// The plane holds arms to both sides.
		expect(primary.some((heading) => Math.cos(heading - (primary[0] as number)) < 0)).toBe(true);
		// It stands across the view from +Z, which a whole picture is taken from: every arm leaves
		// along the X axis, so none hides behind the stem or another arm.
		for (const heading of primary) expect(Math.abs(Math.sin(heading))).toBeLessThan(1e-6);
		for (let variant = 1; variant < 6; variant++) {
			const headings = headingsOf(grow(variant).skeleton).sort((a, b) => a - b);
			const even = (2 * Math.PI) / headings.length;
			headings.forEach((heading, k) => {
				const next = headings[(k + 1) % headings.length] as number;
				const gap = (next - heading + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
				// No gap between neighbours is wider than an even share and the two arms' own stray.
				expect(gap).toBeLessThanOrEqual(even + 0.4 + 1e-6);
			});
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

	it("draws the record's ribs round the stem and round each arm", async () => {
		const { kit, grow, growth } = await saguaro();
		const { skeleton, levels } = grow(0);
		const wood = levels[0].parts.find((part) => part.name === 'wood');
		if (!wood) throw new Error('the level holds no wood');
		const { min, max } = kit.box;
		const metres = (i: number, k: number) =>
			(min[k] as number) +
			((wood.arrays.positions[i * 3 + k] as number) / 65535) *
				((max[k] as number) - (min[k] as number));
		// The crests of the drawn section round a straight stretch of an axis: the ring of vertices
		// nearest a point of the axis, read round it, counts one crest for each place its radius
		// peaks. A ring's vertices lie in one plane square to the axis.
		const crests = (centre: readonly number[], along: readonly number[], reach: number): number => {
			const [ax, ay, az] = along as [number, number, number];
			// Two directions square to the axis, to read an angle round it.
			const side = Math.abs(ay) < 0.9 ? [0, 1, 0] : [1, 0, 0];
			const u = [
				ay * (side[2] as number) - az * (side[1] as number),
				az * (side[0] as number) - ax * (side[2] as number),
				ax * (side[1] as number) - ay * (side[0] as number),
			];
			const ul = Math.hypot(...u);
			const [ux, uy, uz] = u.map((value) => value / ul) as [number, number, number];
			const [vx, vy, vz] = [ay * uz - az * uy, az * ux - ax * uz, ax * uy - ay * ux];
			const near: { t: number; angle: number; radius: number }[] = [];
			for (let i = 0; i < wood.arrays.positions.length / 3; i++) {
				const p = [0, 1, 2].map((k) => metres(i, k) - (centre[k] as number)) as [
					number,
					number,
					number,
				];
				const t = p[0] * ax + p[1] * ay + p[2] * az;
				if (Math.abs(t) > 0.3) continue;
				const x = p[0] * ux + p[1] * uy + p[2] * uz;
				const y = p[0] * vx + p[1] * vy + p[2] * vz;
				const radius = Math.hypot(x, y);
				if (radius <= reach) near.push({ t, angle: Math.atan2(y, x), radius });
			}
			// The rings stand apart along the axis; the one nearest the point is read.
			near.sort((a, b) => a.t - b.t);
			const rings: (typeof near)[] = [];
			for (const vertex of near) {
				const ring = rings[rings.length - 1];
				if (ring && vertex.t - (ring[ring.length - 1] as typeof vertex).t < 0.004)
					ring.push(vertex);
				else rings.push([vertex]);
			}
			const middle = (ring: typeof near) => ring.reduce((sum, v) => sum + v.t, 0) / ring.length;
			const whole = rings.filter((ring) => ring.length >= 24);
			whole.sort((a, b) => Math.abs(middle(a)) - Math.abs(middle(b)));
			const nearest = whole[0];
			if (!nearest) throw new Error('no ring of the drawn wood stands near the point');
			// The seam's vertex stands twice in the ring.
			const round = nearest
				.sort((a, b) => a.angle - b.angle)
				.filter((v, k, all) => k === 0 || v.angle - (all[k - 1] as typeof v).angle > 1e-4);
			let peaks = 0;
			for (let k = 0; k < round.length; k++) {
				const before = (round[(k + round.length - 1) % round.length] as (typeof round)[number])
					.radius;
				const here = (round[k] as (typeof round)[number]).radius;
				const after = (round[(k + 1) % round.length] as (typeof round)[number]).radius;
				if (here > before + 1e-4 && here >= after - 1e-4) peaks++;
			}
			return peaks;
		};
		// A straight stretch of an axis at its middle: for the stem a pair of nodes a third of the
		// way up, and for an arm the first pair of its upright run.
		const stretch = (
			axis: number,
			arm: boolean,
		): { at: number[]; along: number[]; radius: number } => {
			const nodes = nodesOf(skeleton, axis);
			const first = skeleton.axes.first[axis] as number;
			for (let n = arm ? 1 : Math.floor(nodes.length / 3); n < nodes.length; n++) {
				const [a, b] = [nodes[n - 1], nodes[n]] as [number[], number[]];
				const step = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
				const length = Math.hypot(...step);
				const aside = Math.hypot(step[0] as number, step[2] as number);
				if (length > 0.15 && (!arm || aside < 1e-3 * length))
					return {
						at: [0, 1, 2].map((k) => ((a[k] as number) + (b[k] as number)) / 2),
						along: step.map((value) => value / length),
						radius: skeleton.radius[first + n] as number,
					};
			}
			throw new Error(`axis ${axis} has no straight stretch`);
		};
		const within = (count: number, spread: Column['ribs']) => {
			const { mean, spread: stray } =
				typeof spread === 'number' ? { mean: spread, spread: 0 } : spread;
			expect(count).toBeGreaterThanOrEqual(Math.round(mean - stray));
			expect(count).toBeLessThanOrEqual(Math.round(mean + stray));
		};
		const stem = stretch(0, false);
		within(crests(stem.at, stem.along, stem.radius * 1.2), growth.ribs);
		const arms = armsOf(skeleton);
		expect(arms.length).toBeGreaterThan(0);
		for (const arm of arms) {
			const upright = stretch(arm, true);
			within(crests(upright.at, upright.along, upright.radius * 1.2), growth.arms.ribs);
		}
	});

	it('draws the wood of an arm that is cut from the plant', async () => {
		const { kit } = await saguaro();
		const arm = growPlantNow(kit, {
			seed: 11,
			variant: 0,
			near: true,
			cutting: { part: 'branch' },
		});
		const wood = arm.levels[0].parts.find((part) => part.name === 'wood');
		// The cut arm is the piece's only axis, and its body is drawn round it.
		expect(arm.skeleton.axes.count).toBe(1);
		expect(arm.skeleton.axes.kind[0]).toBe(AXIS_ARM);
		expect((wood?.arrays.indices.length ?? 0) / 3).toBeGreaterThan(1000);
		// Still 21: it stands as it grew, its upright part plumb above its elbow.
		const points = nodesOf(arm.skeleton, 0);
		const [a, b] = [points[points.length - 3], points[points.length - 1]] as [number[], number[]];
		const rise = (b[1] as number) - (a[1] as number);
		const aside = Math.hypot(
			(b[0] as number) - (a[0] as number),
			(b[2] as number) - (a[2] as number),
		);
		expect(rise).toBeGreaterThan(0);
		expect(aside / rise).toBeLessThan(0.02);
	});

	it("turns every arm's elbow on a radius of at least the arm's own width", async () => {
		const { grow } = await saguaro();
		for (let variant = 0; variant < 6; variant++) {
			const { skeleton } = grow(variant);
			for (const arm of armsOf(skeleton)) {
				const points = nodesOf(skeleton, arm);
				const radii: number[] = [];
				for (
					let n = skeleton.axes.first[arm] as number;
					n <= (skeleton.axes.last[arm] as number);
					n++
				)
					radii.push(skeleton.radius[n] as number);
				radii.sort((x, y) => x - y);
				const width = 2 * (radii[radii.length >> 1] as number);
				let least = Number.POSITIVE_INFINITY;
				for (let i = 1; i + 1 < points.length; i++) {
					const [p, q, r] = [points[i - 1], points[i], points[i + 1]] as [
						number[],
						number[],
						number[],
					];
					const pq = Math.hypot(...[0, 1, 2].map((k) => (q[k] as number) - (p[k] as number)));
					const qr = Math.hypot(...[0, 1, 2].map((k) => (r[k] as number) - (q[k] as number)));
					const rp = Math.hypot(...[0, 1, 2].map((k) => (p[k] as number) - (r[k] as number)));
					const u = [0, 1, 2].map((k) => (q[k] as number) - (p[k] as number));
					const v = [0, 1, 2].map((k) => (r[k] as number) - (p[k] as number));
					const cross = Math.hypot(
						(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
						(u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
						(u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
					);
					if (cross < 1e-9) continue;
					least = Math.min(least, (pq * qr * rp) / (2 * cross));
				}
				expect([variant, arm, least >= 0.95 * width]).toEqual([variant, arm, true]);
			}
		}
	});

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

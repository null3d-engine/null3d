// The shoot prototypes and their rows: each phyllotaxis kind measured by the angles between its
// leaves, leaves at the record's angle from the stem and turned toward the sky, every tier the same
// shoot, shade inside the shoot, and rows on the bud sites that turn toward the sky, keep the
// record's density and grow the same bytes from the same seed.
import { describe, expect, it } from 'bun:test';
import { quatRotate } from '../core/math';
import { placeholderSkeleton } from '../core/placeholder';
import type { Phyllotaxis, Species } from '../core/record';
import { DETAILS } from '../core/types';
import { placeShoots } from './instancer';
import { builder } from './leaf-mesh';
import { OAK_MANIFEST, OAK_SHOOTS, oakRecord, testKit } from './oak.test-support';
import { type PlannedLeaf, planShoot, shootPrototypes } from './shoot';

/** A record whose shoots stand straight, with one arrangement of leaves. */
function straight(phyllotaxis: Phyllotaxis): Species {
	const base = oakRecord();
	return {
		...base,
		shoots: {
			...OAK_SHOOTS,
			phyllotaxis,
			years: 1,
			orders: 1,
			stem: { ...OAK_SHOOTS.stem, zigzag: 0 },
			classes: OAK_SHOOTS.classes.map((c) => ({ ...c, droop: 0, nodes: 8, internode: 1 })),
		},
	};
}

/** A leaf's azimuth about its stem in degrees, in the frame of the stem's side and sky. */
function azimuth(leaf: PlannedLeaf, sky: readonly number[]): number {
	const s = leaf.stem;
	const d = leaf.direction;
	const along = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
	const r = [d[0] - along * s[0], d[1] - along * s[1], d[2] - along * s[2]];
	const skyAlong =
		(sky[0] as number) * s[0] + (sky[1] as number) * s[1] + (sky[2] as number) * s[2];
	const z = [
		(sky[0] as number) - skyAlong * s[0],
		(sky[1] as number) - skyAlong * s[1],
		(sky[2] as number) - skyAlong * s[2],
	];
	const zl = Math.hypot(z[0] as number, z[1] as number, z[2] as number);
	const zn = z.map((v) => v / zl);
	// The side axis: stem × sky.
	const x = [
		s[1] * (zn[2] as number) - s[2] * (zn[1] as number),
		s[2] * (zn[0] as number) - s[0] * (zn[2] as number),
		s[0] * (zn[1] as number) - s[1] * (zn[0] as number),
	];
	const cx =
		(r[0] as number) * (x[0] as number) +
		(r[1] as number) * (x[1] as number) +
		(r[2] as number) * (x[2] as number);
	const cz =
		(r[0] as number) * (zn[0] as number) +
		(r[1] as number) * (zn[1] as number) +
		(r[2] as number) * (zn[2] as number);
	return (Math.atan2(cz, cx) * 180) / Math.PI;
}

/** The turn from one azimuth to the next, from 0 to 360 degrees. */
const step = (a: number, b: number) => (((b - a) % 360) + 360) % 360;

/** The leaves of axis 0 grouped by node, each node's azimuths. */
function azimuthsByNode(record: Species): number[][] {
	const plan = planShoot(record, 0, 1);
	const nodes: number[][] = [];
	for (const leaf of plan.leaves) {
		if (leaf.axis !== 0) continue;
		const list = nodes[leaf.node] ?? [];
		list.push(azimuth(leaf, [0, 0, 1]));
		nodes[leaf.node] = list;
	}
	return nodes.filter(Boolean);
}

/** Within a few degrees, for the stem's small wander. */
const near = (value: number, target: number, within = 8) =>
	Math.min(Math.abs(value - target), 360 - Math.abs(value - target)) <= within;

describe('the phyllotaxis of a shoot, measured by angle', () => {
	it('spirals by its divergence', () => {
		for (const divergence of [144, 137.5, 180 - 42]) {
			const nodes = azimuthsByNode(straight({ kind: 'spiral', divergence }));
			expect(nodes.length).toBeGreaterThanOrEqual(6);
			for (let k = 1; k < nodes.length; k++)
				expect(near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), divergence)).toBe(
					true,
				);
		}
	});

	it('stands alternate leaves in two ranks', () => {
		const nodes = azimuthsByNode(straight({ kind: 'distichous', flatten: 0.8 }));
		for (let k = 1; k < nodes.length; k++)
			expect(near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), 180)).toBe(true);
	});

	it('pairs opposite leaves, crossing each pair with the next when decussate', () => {
		for (const decussate of [false, true]) {
			const nodes = azimuthsByNode(straight({ kind: 'opposite', decussate }));
			for (const pair of nodes) {
				expect(pair).toHaveLength(2);
				expect(near(step(pair[0] as number, pair[1] as number), 180)).toBe(true);
			}
			for (let k = 1; k < nodes.length; k++)
				expect(
					near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), decussate ? 90 : 0),
				).toBe(true);
		}
	});

	it('rings whorled leaves evenly, each whorl turned half a gap from the last', () => {
		const nodes = azimuthsByNode(straight({ kind: 'whorled', count: 3 }));
		for (const whorl of nodes) {
			expect(whorl).toHaveLength(3);
			expect(near(step(whorl[0] as number, whorl[1] as number), 120)).toBe(true);
			expect(near(step(whorl[1] as number, whorl[2] as number), 120)).toBe(true);
		}
		for (let k = 1; k < nodes.length; k++)
			expect(near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), 60)).toBe(true);
	});

	it('crowds a spur rosette at one node on the golden angle', () => {
		const nodes = azimuthsByNode(straight({ kind: 'rosette-spur', leaves: 12 }));
		expect(nodes).toHaveLength(1);
		const rosette = nodes[0] as number[];
		expect(rosette).toHaveLength(12);
		for (let k = 1; k < rosette.length; k++)
			expect(near(step(rosette[k - 1] as number, rosette[k] as number), 137.5, 1)).toBe(true);
	});

	it('spaces fascicles on the golden angle', () => {
		const nodes = azimuthsByNode(straight({ kind: 'fascicle', needles: 2 }));
		for (let k = 1; k < nodes.length; k++)
			expect(near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), 137.5)).toBe(true);
	});

	it('angles each leaf from its stem by the class curve', () => {
		const record = straight({ kind: 'spiral', divergence: 144 });
		const plan = planShoot(record, 0, 1);
		for (const leaf of plan.leaves) {
			const cos =
				leaf.direction[0] * leaf.stem[0] +
				leaf.direction[1] * leaf.stem[1] +
				leaf.direction[2] * leaf.stem[2];
			const degrees = (Math.acos(cos) * 180) / Math.PI;
			expect(degrees).toBeGreaterThan(30);
			expect(degrees).toBeLessThan(60);
		}
	});
});

describe('the shoot prototypes', () => {
	const record = oakRecord();
	const leaves = DETAILS.map((tier) => builder.leaves(record, OAK_MANIFEST, tier));
	// Processor time, not wall time, so other work on the machine does not count.
	const started = process.cpuUsage();
	const prototypes = shootPrototypes(record, OAK_MANIFEST, leaves);
	const milliseconds = process.cpuUsage(started).user / 1000;

	it("grows the record's prototypes and their leafless twins, each at four tiers of rising detail", () => {
		// The oak is deciduous: its kit holds a leafless twin of each prototype for winter rows.
		expect(prototypes).toHaveLength(OAK_SHOOTS.prototypes * 2);
		for (const twin of prototypes.slice(OAK_SHOOTS.prototypes)) {
			expect(twin.leaves).toBe(0);
			for (const tier of twin.tiers)
				for (let i = 2; i < tier.colors.length; i += 4) expect(tier.colors[i]).not.toBe(0);
		}
		for (const prototype of prototypes.slice(0, OAK_SHOOTS.prototypes)) {
			let previous = 0;
			for (const tier of prototype.tiers) {
				expect(tier.indices.length).toBeGreaterThan(previous);
				previous = tier.indices.length;
			}
			expect(prototype.leaves).toBeGreaterThanOrEqual(4);
		}
		expect(milliseconds).toBeLessThan(1500);
	});

	it('keeps one shape at every tier', () => {
		for (const prototype of prototypes) {
			const reach = prototype.tiers.map((tier) => {
				let far = 0;
				for (let i = 0; i < tier.positions.length; i += 3)
					far = Math.max(
						far,
						Math.hypot(
							tier.positions[i] as number,
							tier.positions[i + 1] as number,
							tier.positions[i + 2] as number,
						),
					);
				return far;
			});
			for (const value of reach)
				expect(Math.abs(value - (reach[2] as number))).toBeLessThan((reach[2] as number) * 0.05);
		}
	});

	it('crowds the leaves at the shoot tip round its bud cluster', () => {
		const plan = planShoot(record, 0, 1);
		const tipAlong = Math.max(...plan.leaves.map((leaf) => leaf.along));
		const nearTip = plan.leaves.filter((leaf) => leaf.along > tipAlong * 0.75);
		expect(nearTip.length).toBeGreaterThanOrEqual(plan.leaves.length / 2);
		expect(plan.buds.length).toBeGreaterThanOrEqual(OAK_SHOOTS.bud.tipCluster);
	});

	it('turns leaves to face the sky side', () => {
		const plan = planShoot(record, 0, 1);
		let sum = 0;
		for (const leaf of plan.leaves) sum += quatRotate(leaf.rotation, 0, [0, 0, 1], [0, 0, 0])[2];
		expect(sum / plan.leaves.length).toBeGreaterThan(0.3);
	});

	it('shades vertices deep in the shoot and leaves its outside open', () => {
		const high = prototypes[0]?.tiers[2];
		if (!high) throw new Error('no prototype');
		let lowest = 255;
		let highest = 0;
		for (let i = 3; i < high.colors.length; i += 4) {
			lowest = Math.min(lowest, high.colors[i] as number);
			highest = Math.max(highest, high.colors[i] as number);
		}
		expect(lowest).toBeLessThan(160);
		expect(highest).toBeGreaterThan(220);
	});
});

describe('the shoot rows', () => {
	const record = oakRecord();
	const kit = testKit(record);
	const skeleton = placeholderSkeleton({ record, seed: 11, variant: 0, season: 'summer' });
	const input = { record, seed: 11, variant: 0, season: 'summer' as const, kit, skeleton };

	it('grows the same rows from the same seed', () => {
		const a = placeShoots(input);
		const b = placeShoots(input);
		expect(a.count).toBeGreaterThan(0);
		expect(Array.from(a.position)).toEqual(Array.from(b.position));
		expect(Array.from(a.rotation)).toEqual(Array.from(b.rotation));
		expect(placeShoots({ ...input, seed: 12 }).rotation).not.toEqual(a.rotation);
	});

	it("keeps the record's shoots per metre along the axes that carry buds", () => {
		const rows = placeShoots(input);
		const buds = skeleton.buds;
		let length = 0;
		const lastOnAxis = new Map<number, number[]>();
		for (let b = 0; b < buds.count; b++) {
			const axis = buds.axis[b] as number;
			const at = [
				buds.position[b * 3] as number,
				buds.position[b * 3 + 1] as number,
				buds.position[b * 3 + 2] as number,
			];
			const before = lastOnAxis.get(axis);
			const node = buds.node[b] as number;
			const parent = skeleton.parent[node] as number;
			const from = before ?? [
				skeleton.position[parent * 3] as number,
				skeleton.position[parent * 3 + 1] as number,
				skeleton.position[parent * 3 + 2] as number,
			];
			length += Math.hypot(
				(at[0] as number) - (from[0] as number),
				(at[1] as number) - (from[1] as number),
				(at[2] as number) - (from[2] as number),
			);
			lastOnAxis.set(axis, at);
		}
		// Between 6 and 10 a metre by vigor, with the terminal buds' one row each on top.
		expect(rows.count).toBeGreaterThan(length * 5);
		expect(rows.count).toBeLessThan(length * 11 + buds.count);
	});

	it('turns rows toward the sky by the skyward share', () => {
		const lean = (skyward: number) => {
			const rows = placeShoots({
				...input,
				record: {
					...record,
					shoots: { ...OAK_SHOOTS, placement: { ...OAK_SHOOTS.placement, skyward } },
				},
			});
			let sum = 0;
			for (let r = 0; r < rows.count; r++) {
				const z = quatRotate(rows.rotation, r * 4, [0, 0, 1], [0, 0, 0]);
				const y = quatRotate(rows.rotation, r * 4, [0, 1, 0], [0, 0, 0]);
				// The share of the most a row's +Z can face up, given its direction.
				sum += z[1] / Math.max(1e-3, Math.sqrt(1 - y[1] * y[1]));
			}
			return sum / rows.count;
		};
		expect(lean(1)).toBeGreaterThan(0.99);
		expect(lean(0.5)).toBeGreaterThan(0.5);
		expect(lean(0)).toBeLessThan(0.2);
	});

	it('drops the rows of buds below the shade-prune line', () => {
		const all = placeShoots(input).count;
		const pruned = placeShoots({
			...input,
			record: {
				...record,
				shoots: { ...OAK_SHOOTS, placement: { ...OAK_SHOOTS.placement, shadePrune: 0.8 } },
			},
		}).count;
		expect(pruned).toBeLessThan(all);
	});

	it('orders rows along a space-filling curve, each rank once', () => {
		const rows = placeShoots(input);
		const ranks = new Set(rows.order);
		expect(ranks.size).toBe(rows.count);
		expect(Math.max(...rows.order)).toBe(rows.count - 1);
	});
});

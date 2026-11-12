// The shoot prototypes and their rows: each phyllotaxis kind measured by the angles between its
// leaves, a crowded tip standing round its stem or as one fan, leaves at the record's angle from the
// stem and turned toward the sky, every tier the same shoot, shade inside the shoot, and rows on the
// bud sites that turn toward the sky, keep the record's density and grow the same bytes from the same
// seed; the crown-light prune, the lift and the bare trim.
import { describe, expect, it } from 'bun:test';
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_TERMINAL,
	type MacroSkeleton,
	NODE_STUB,
	SkeletonBuilder,
} from '../core/graph';
import { cross3, normalize3, quatRotate } from '../core/math';
import { placeholderSkeleton } from '../core/placeholder';
import type { Phyllotaxis, ShootSpec, Species } from '../core/record';
import { DETAILS, type Spread } from '../core/types';
import { lightCrown } from '../crown/visibility';
import { bareTrimmed } from '../grow/coarsen';
import { dressShoots, placeShoots, prototypesFor, pruneLight } from './instancer';
import { builder } from './leaf-mesh';
import { OAK_MANIFEST, OAK_SHOOTS, oakRecord, testKit } from './oak.test-support';
import { type PlannedLeaf, planShoot, type ShootPlan, shootPrototypes } from './shoot';

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
			// No fan swing, so the arrangement is measured as the phyllotaxis alone lays it.
			placement: { ...OAK_SHOOTS.placement, skyward: 0 },
			classes: OAK_SHOOTS.classes.map((c) => ({
				...c,
				droop: 0,
				nodes: 8,
				internode: 1,
				years: 1,
			})),
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

	it('turns each node past the opposite rank where the class sets a turn', () => {
		const turned = azimuthsByNode(straight({ kind: 'distichous', flatten: 0.8, turn: 20 }));
		for (let k = 1; k < turned.length; k++)
			expect(near(step(turned[k - 1]?.[0] as number, turned[k]?.[0] as number), 200)).toBe(true);
		// Without the turn the same record's leaves step by the opposite rank alone, in one plane.
		const flat = azimuthsByNode(straight({ kind: 'distichous', flatten: 0.8 }));
		for (let k = 1; k < flat.length; k++)
			expect(near(step(flat[k - 1]?.[0] as number, flat[k]?.[0] as number), 180)).toBe(true);
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

	it('stands a crowded tip round its stem, or as one fan when the record asks', () => {
		// A tip rosette, so the leaves crowd: an even spacing would not.
		const rosette = [
			[0, 20],
			[0.15, 0.6],
			[1, 0.3],
		] as const;
		const tip = (arrangement?: 'round' | 'fan'): Species => {
			const record = straight({ kind: 'spiral', divergence: 144 });
			const shoots = record.shoots as ShootSpec;
			return {
				...record,
				shoots: {
					...shoots,
					placement: {
						...shoots.placement,
						skyward: 0.65,
						...(arrangement ? { rosette: arrangement } : {}),
					},
					classes: shoots.classes.map((c) => ({ ...c, internode: rosette as never })),
				},
			};
		};
		// How far the crowded leaves lean out of the plane of their stem and its side: a leaf that
		// lies in that plane reads 0, and one standing over it reads 1.
		const lean = (record: Species): number => {
			const crowded = planShoot(record, 0, 1).leaves.filter((leaf) => leaf.crowded > 0.4);
			expect(crowded.length).toBeGreaterThan(2);
			const sum = crowded.reduce(
				(total, leaf) =>
					total +
					Math.abs(
						leaf.direction[0] * leaf.sky[0] +
							leaf.direction[1] * leaf.sky[1] +
							leaf.direction[2] * leaf.sky[2],
					),
				0,
			);
			return sum / crowded.length;
		};
		expect(lean(tip('fan'))).toBeLessThan(lean(tip()) * 0.6);
	});

	it('angles each leaf from its stem by the class curve', () => {
		const record = straight({ kind: 'spiral', divergence: 144 });
		const plan = planShoot(record, 0, 1);
		// The class curve's own range, and a degree either side for the stem's small wander.
		const curve = record.shoots?.classes[0]?.leafAngle;
		const values = typeof curve === 'number' ? [curve] : (curve ?? []).map(([, value]) => value);
		for (const leaf of plan.leaves) {
			const cos =
				leaf.direction[0] * leaf.stem[0] +
				leaf.direction[1] * leaf.stem[1] +
				leaf.direction[2] * leaf.stem[2];
			const degrees = (Math.acos(cos) * 180) / Math.PI;
			expect(degrees).toBeGreaterThan(Math.min(...values) - 1);
			expect(degrees).toBeLessThan(Math.max(...values) + 1);
		}
	});
});

describe('the leaf arrangement and facing a shoot class names', () => {
	/** A record whose classes all carry the class-level fields given, over a species-level spiral. */
	const withClass = (fields: Partial<ShootSpec['classes'][number]>): Species => {
		const base = straight({ kind: 'spiral', divergence: 144 });
		const shoots = base.shoots as ShootSpec;
		return {
			...base,
			shoots: { ...shoots, classes: shoots.classes.map((c) => ({ ...c, ...fields })) },
		};
	};

	it('draws as the species does when the class names neither field', () => {
		const plain = straight({ kind: 'spiral', divergence: 144 });
		const shoots = plain.shoots as ShootSpec;
		const named = withClass({ phyllotaxis: shoots.phyllotaxis, skyward: shoots.placement.skyward });
		expect(planShoot(named, 0, 1)).toEqual(planShoot(plain, 0, 1));
	});

	it("stands the leaves by the class's own arrangement", () => {
		// The species spirals by 144 degrees; the class asks for a half-turn spiral, which alternates
		// its leaves on opposite sides.
		const nodes = azimuthsByNode(withClass({ phyllotaxis: { kind: 'spiral', divergence: 180 } }));
		expect(nodes.length).toBeGreaterThanOrEqual(6);
		for (let k = 1; k < nodes.length; k++)
			expect(near(step(nodes[k - 1]?.[0] as number, nodes[k]?.[0] as number), 180)).toBe(true);
	});

	it("turns the leaves to the face the class's own share names", () => {
		// A blade whose face is turned up to the sky stands at a different rotation from one held
		// face on to a camera level with the shoot.
		const up = planShoot(withClass({ skyward: 1 }), 0, 1).leaves.map((leaf) => leaf.rotation);
		const flat = planShoot(withClass({ skyward: 0 }), 0, 1).leaves.map((leaf) => leaf.rotation);
		expect(up).toHaveLength(flat.length);
		expect(up).not.toEqual(flat);
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

	it("sets a cutting class's prototypes apart, so the crown never draws one", () => {
		const shoots = record.shoots as NonNullable<typeof record.shoots>;
		const cut = { ...(shoots.classes[0] as (typeof shoots.classes)[number]), name: 'cut' as const };
		const planned = shootPrototypes(
			{ ...record, shoots: { ...shoots, cuttingClasses: [cut] } },
			OAK_MANIFEST,
			leaves,
		);
		// Each cutting class adds its prototypes, and their leafless twins beside them.
		expect(planned).toHaveLength(prototypes.length + 4);
		expect(planned.filter((prototype) => prototype.cutting)).toHaveLength(4);
		// Every bud vigor draws the same shapes it drew before the class existed.
		for (let vigor = 0; vigor <= 1; vigor += 0.05)
			expect(prototypesFor(planned, vigor)).toEqual(prototypesFor(prototypes, vigor));
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
			// The low tier draws no buds, so its reach may fall short by the tip bud's length.
			const bud = record.shoots?.bud.length ?? 0;
			for (const value of reach)
				expect(Math.abs(value - (reach[2] as number))).toBeLessThan(
					(reach[2] as number) * 0.05 + bud,
				);
		}
	});

	it("keeps a two-ranked shoot's laterals in the plane of its leaf ranks", () => {
		const base = oakRecord();
		const shoots = base.shoots as NonNullable<typeof base.shoots>;
		const twoRanked: Species = {
			...base,
			shoots: {
				...shoots,
				phyllotaxis: { kind: 'distichous', flatten: 1 },
				orders: 3,
				years: 3,
				stem: { ...shoots.stem, zigzag: 0 },
				classes: shoots.classes.map((c) => ({ ...c, years: 3, droop: 0, internode: 1 })),
			},
		};
		const plan = planShoot(twoRanked, shoots.prototypes - 1, 1);
		expect(plan.axes.length).toBeGreaterThan(1);
		const direction = (axis: (typeof plan.axes)[number]): number[] => {
			const first = axis[0] as { at: readonly number[] };
			const last = axis[axis.length - 1] as { at: readonly number[] };
			return normalize3([
				(last.at[0] as number) - (first.at[0] as number),
				(last.at[1] as number) - (first.at[1] as number),
				(last.at[2] as number) - (first.at[2] as number),
			]) as number[];
		};
		const main = direction(plan.axes[0] as (typeof plan.axes)[number]);
		// Each lateral's direction, square to the main axis: a flat shoot keeps them on one line.
		const flat = plan.axes.slice(1).map((axis) => {
			const d = direction(axis);
			const along = d[0]! * main[0]! + d[1]! * main[1]! + d[2]! * main[2]!;
			return normalize3([
				d[0]! - along * main[0]!,
				d[1]! - along * main[1]!,
				d[2]! - along * main[2]!,
			]) as number[];
		});
		const first = flat[0] as number[];
		for (const p of flat)
			expect(Math.abs(p[0]! * first[0]! + p[1]! * first[1]! + p[2]! * first[2]!)).toBeGreaterThan(
				0.95,
			);
	});

	it('crowds the leaves at the shoot tip round its bud cluster', () => {
		const plan = planShoot(record, 0, 1);
		const tipAlong = Math.max(...plan.leaves.map((leaf) => leaf.along));
		const nearTip = plan.leaves.filter((leaf) => leaf.along > tipAlong * 0.75);
		expect(nearTip.length).toBeGreaterThanOrEqual(plan.leaves.length / 2);
		expect(plan.buds.length).toBeGreaterThanOrEqual(OAK_SHOOTS.bud.tipCluster);
	});

	it("gathers a tip cluster's buds round its terminal bud by the record's step and lean", () => {
		const shoots = record.shoots as NonNullable<typeof record.shoots>;
		const planned = (cluster?: { readonly step: number; readonly lean: number }) =>
			planShoot({ ...record, shoots: { ...shoots, bud: { ...shoots.bud, cluster } } }, 0, 1);
		// Without the field, or with the default step and lean named, the buds are as before.
		const plain = planShoot(record, 0, 1);
		expect(planned(undefined).buds).toEqual(plain.buds);
		expect(planned({ step: 0.4, lean: 32 }).buds).toEqual(plain.buds);
		const count = Math.round(shoots.bud.tipCluster) - 1;
		const clusters = (plan: ReturnType<typeof planShoot>) =>
			plan.buds.flatMap((bud, i) =>
				bud.stack === undefined ? [] : [plan.buds.slice(i, i + 1 + count)],
			);
		const dot = (a: readonly number[], b: readonly number[]) =>
			(a[0] as number) * (b[0] as number) +
			(a[1] as number) * (b[1] as number) +
			(a[2] as number) * (b[2] as number);
		const spread = (lean: number) => {
			let sum = 0;
			let n = 0;
			for (const [tip, ...below] of clusters(planned({ step: 0.15, lean })))
				for (const bud of below) {
					sum += Math.acos(Math.min(1, dot((tip as typeof bud).direction, bud.direction)));
					n++;
				}
			return sum / n;
		};
		for (const step of [0.15, 0.4]) {
			const found = clusters(planned({ step, lean: 50 }));
			expect(found.length).toBeGreaterThan(0);
			for (const [tip, ...below] of found) {
				const top = tip as NonNullable<typeof tip>;
				// Each bud stands a step of a bud's length below the last, the first a third of a
				// length under the tip, and the cluster's cone spans them all.
				below.forEach((bud, k) => {
					expect(top.along - bud.along).toBeCloseTo(shoots.bud.length * (0.35 + step * k), 9);
				});
				expect(top.stack as number).toBeCloseTo(
					shoots.bud.length * (0.35 + step * (count - 1) + 1),
					9,
				);
			}
		}
		// A wider lean turns the cluster's buds further from the terminal bud's line.
		expect(spread(50)).toBeGreaterThan(spread(32) + (10 * Math.PI) / 180);
	});

	it("opens a lit shoot's leaves into a fan by the skyward share", () => {
		// How far the leaves point toward the sky side or away from it, on average: a fan lies across.
		// Leaves along a shoot take the fan; a crowded tip takes a rosette instead, so this record
		// spaces its leaves at the shoot's own internodes.
		const shoots = record.shoots as NonNullable<typeof record.shoots>;
		const even = { ...shoots, classes: shoots.classes.map((c) => ({ ...c, internode: 1 })) };
		const lift = (skyward: number) => {
			const lit = { ...record, shoots: { ...even, placement: { ...shoots.placement, skyward } } };
			const plan = planShoot(lit, 0, 1);
			let sum = 0;
			for (const leaf of plan.leaves) sum += Math.abs(leaf.direction[2]);
			return sum / plan.leaves.length;
		};
		expect(lift(0.9)).toBeLessThan(lift(0) * 0.5);
	});

	it('gives a class its own stem girth where the record names one', () => {
		const shoots = record.shoots as NonNullable<typeof record.shoots>;
		const thick = {
			...record,
			shoots: {
				...shoots,
				classes: shoots.classes.map((c, k) =>
					k === 0 ? { ...c, stem: { radius: [0.02, 0.01] as const } } : c,
				),
			},
		};
		const own = planShoot(thick, 0, 0);
		expect(own.axes[0]?.[0]?.radius).toBeCloseTo(0.02, 6);
		const plain = planShoot(record, 0, 0);
		expect(plain.axes[0]?.[0]?.radius).toBeCloseTo(shoots.stem.radius[0], 6);
	});

	it('spreads a crowded tip round its stem rather than into one plane', () => {
		const plan = planShoot(record, 0, 1);
		const tipAlong = Math.max(...plan.leaves.map((leaf) => leaf.along));
		const tip = plan.leaves.filter((leaf) => leaf.along > tipAlong * 0.75);
		expect(tip.length).toBeGreaterThanOrEqual(5);
		// Every tip leaf's turn round one stem axis. A rosette fills the turn: no two leaves share an
		// angle, and no gap stands half a turn empty as a fan's does.
		const frame = tip[0] as PlannedLeaf;
		const side = normalize3(cross3(frame.stem, frame.sky, [0, 0, 0]));
		const angles = tip
			.map((leaf) => {
				const d = leaf.direction;
				const x = d[0] * side[0] + d[1] * side[1] + d[2] * side[2];
				const y = d[0] * frame.sky[0] + d[1] * frame.sky[1] + d[2] * frame.sky[2];
				return (Math.atan2(y, x) * 180) / Math.PI;
			})
			.sort((a, b) => a - b);
		const even = 360 / tip.length;
		for (let k = 0; k < angles.length; k++) {
			const gap =
				k === 0
					? (angles[0] as number) + 360 - (angles[angles.length - 1] as number)
					: (angles[k] as number) - (angles[k - 1] as number);
			expect(gap).toBeGreaterThan(even * 0.5);
			expect(gap).toBeLessThan(even * 1.5);
		}
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

describe('the side shoots at a joint', () => {
	/** The test oak with three years and three orders in every class, its joints' side shoots and its bends. */
	const jointed = (
		laterals?: Spread,
		lateralGap?: number,
		bend?: { length: number; angle: number },
	): Species => {
		const base = oakRecord();
		return {
			...base,
			shoots: {
				...OAK_SHOOTS,
				orders: 3,
				years: 3,
				classes: OAK_SHOOTS.classes.map((c) => ({
					...c,
					years: 3,
					...(laterals !== undefined && { laterals }),
					...(lateralGap !== undefined && { lateralGap }),
					...(bend !== undefined && { bend }),
				})),
			},
		};
	};
	/** How many side axes leave each point that one leaves from. */
	const fans = (plan: ShootPlan): number[] => {
		const starts = new Map<string, number>();
		for (const points of plan.axes.slice(1)) {
			const key = (points[0]?.at ?? []).map((v) => Math.round(v * 1e5)).join();
			starts.set(key, (starts.get(key) ?? 0) + 1);
		}
		return [...starts.values()];
	};
	/** A point of a plan as three numbers. */
	const xyz = (p: readonly number[]): [number, number, number] => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
	/** One side shoot of the shoot's own stem: where it leaves, its first step and the stem's way there. */
	interface Own {
		readonly along: number;
		readonly direction: [number, number, number];
		readonly stem: [number, number, number];
	}
	/** The side axes that leave the shoot's own stem, axis 0, in order up the stem. */
	const ownSideShoots = (plan: ShootPlan): Own[] => {
		const stem = (plan.axes[0] ?? []).map((point) => xyz(point.at));
		const out: Own[] = [];
		for (const points of plan.axes.slice(1)) {
			const first = points[0];
			const second = points[1];
			if (!first || !second) continue;
			const [px, py, pz] = xyz(first.at);
			const [qx, qy, qz] = xyz(second.at);
			// The stem's internode that holds the start: the side shoot leaves axis 0 there.
			for (let k = 1; k < stem.length; k++) {
				const [ax, ay, az] = stem[k - 1] as [number, number, number];
				const [bx, by, bz] = stem[k] as [number, number, number];
				const [ux, uy, uz] = [bx - ax, by - ay, bz - az];
				const t =
					((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / (ux * ux + uy * uy + uz * uz);
				const off = Math.hypot(px - ax - ux * t, py - ay - uy * t, pz - az - uz * t);
				if (t < -1e-6 || t > 1 + 1e-6 || off > 1e-6) continue;
				out.push({
					along: first.along,
					direction: normalize3([qx - px, qy - py, qz - pz]),
					stem: normalize3([ux, uy, uz]),
				});
				break;
			}
		}
		return out.sort((p, q) => p.along - q.along);
	};

	it('puts out the side shoots the class names at each joint', () => {
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			// Three years of three orders: the shoot's two joints put out one each, and the older side
			// shoot's own joint one more, so four axes stand where the tip cluster's fans gave more.
			const one = planShoot(jointed(1), i, 1);
			expect(one.axes).toHaveLength(4);
			expect(Math.max(...fans(one))).toBe(1);
			expect(planShoot(jointed(0), i, 1).axes).toHaveLength(1);
		}
		// Absent, each joint fans out two or three shoots from the tip cluster.
		expect(Math.min(...fans(planShoot(jointed(), 0, 1)))).toBeGreaterThanOrEqual(2);
	});

	it("turns one axis's side shoots round it from one joint to the next", () => {
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			const own = ownSideShoots(planShoot(jointed(1), i, 1));
			expect(own).toHaveLength(2);
			// Each side shoot's lean away from the stem, and the angle between the two leans.
			const [a, b] = own.map(({ direction: [dx, dy, dz], stem: [sx, sy, sz] }) => {
				const along = dx * sx + dy * sy + dz * sz;
				return normalize3([dx - along * sx, dy - along * sy, dz - along * sz]);
			}) as [[number, number, number], [number, number, number]];
			const cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
			expect((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toBeGreaterThan(60);
		}
	});

	it("spaces a joint's side shoots down the stem by the class's gap", () => {
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			const plan = planShoot(jointed(2, 0.3), i, 1);
			expect(Math.max(...fans(plan))).toBe(1);
			// Two side shoots at each of the shoot's two joints, the second a third of a unit lower.
			const own = ownSideShoots(plan);
			expect(own).toHaveLength(4);
			const stem = plan.axes[0] ?? [];
			const unit = (stem[stem.length - 1]?.along ?? 0) / 3;
			for (let k = 1; k < own.length; k++)
				expect((own[k] as Own).along - (own[k - 1] as Own).along).toBeGreaterThan(unit * 0.2);
			// With no gap the pair leaves one point.
			expect(Math.max(...fans(planShoot(jointed(2), i, 1)))).toBe(2);
		}
	});

	it("breaks a long internode into straight pieces that keep the internode's line", () => {
		const turns = (points: readonly { readonly at: readonly number[] }[]): number[] => {
			const out: number[] = [];
			for (let k = 1; k + 1 < points.length; k++) {
				const [ax, ay, az] = xyz((points[k - 1] as { at: readonly number[] }).at);
				const [bx, by, bz] = xyz((points[k] as { at: readonly number[] }).at);
				const [cx, cy, cz] = xyz((points[k + 1] as { at: readonly number[] }).at);
				const u = normalize3([bx - ax, by - ay, bz - az]);
				const v = normalize3([cx - bx, cy - by, cz - bz]);
				const cos = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
				out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
			}
			return out;
		};
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			const plain = planShoot(jointed(1), i, 1).axes[0] ?? [];
			const bent =
				planShoot(jointed(1, undefined, { length: 0.01, angle: 30 }), i, 1).axes[0] ?? [];
			// The stem's long first internodes now run as pairs of pieces, turned about the bend's angle.
			expect(bent.length).toBeGreaterThanOrEqual(plain.length + 3);
			expect(turns(bent).filter((t) => t > 25).length).toBeGreaterThan(
				turns(plain).filter((t) => t > 25).length + 2,
			);
			// The stem ends close to where it ends unbent: the pieces wind about the internode's line.
			const end = xyz((plain[plain.length - 1] as { at: readonly number[] }).at);
			const bentEnd = xyz((bent[bent.length - 1] as { at: readonly number[] }).at);
			const reach = (plain[plain.length - 1] as { along: number }).along;
			expect(
				Math.hypot(end[0] - bentEnd[0], end[1] - bentEnd[1], end[2] - bentEnd[2]),
			).toBeLessThan(reach * 0.08);
		}
	});
});

describe("a class's own leaf years", () => {
	it("leaves a class's older years bare where it names fewer leaf years than the species", () => {
		const base = oakRecord();
		const record = (leafYears?: number): Species => ({
			...base,
			shoots: {
				...OAK_SHOOTS,
				orders: 3,
				years: 3,
				leafYears: 2,
				classes: OAK_SHOOTS.classes.map((c) => ({
					...c,
					years: 3,
					laterals: 1,
					...(leafYears !== undefined && { leafYears }),
				})),
			},
		});
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			const own = planShoot(record(1), i, 1);
			const species = planShoot(record(), i, 1);
			expect(own.leaves.length).toBeLessThan(species.leaves.length);
			// Every leaf stands on its axis's newest unit: past the last year's end below the tip.
			for (const leaf of own.leaves) {
				const points = own.axes[leaf.axis] ?? [];
				const ends = points.filter((p) => p.unitEnd).map((p) => p.along);
				const newestStart = ends.length > 1 ? (ends[ends.length - 2] as number) : -Infinity;
				expect(leaf.along).toBeGreaterThan(newestStart);
			}
		}
	});
});

describe("a class's side-shoot angle limit", () => {
	it("keeps every side shoot of any order within the class's angle of the shoot's line", () => {
		const base = oakRecord();
		// Straight stems with wide leans, so a side shoot's first step runs the way it leaves.
		const record = (lateralMost?: number): Species => ({
			...base,
			shoots: {
				...OAK_SHOOTS,
				orders: 3,
				years: 3,
				stem: { ...OAK_SHOOTS.stem, zigzag: 0 },
				classes: OAK_SHOOTS.classes.map((c) => ({
					...c,
					years: 3,
					droop: 0,
					lateral: 60,
					laterals: 2,
					lateralGap: 0.3,
					bend: undefined,
					...(lateralMost !== undefined && { lateralMost }),
				})),
			},
		});
		// Degrees from the shoot's line of each side axis's first step.
		const leaving = (plan: ShootPlan): number[] =>
			plan.axes.slice(1).map((points) => {
				const a = (points[0] as { at: readonly number[] }).at;
				const b = (points[1] as { at: readonly number[] }).at;
				const d = normalize3([
					(b[0] ?? 0) - (a[0] ?? 0),
					(b[1] ?? 0) - (a[1] ?? 0),
					(b[2] ?? 0) - (a[2] ?? 0),
				]);
				return (Math.acos(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI;
			});
		let widest = 0;
		for (let i = 0; i < OAK_SHOOTS.prototypes; i++) {
			const free = leaving(planShoot(record(), i, 1));
			const held = leaving(planShoot(record(40), i, 1));
			expect(held).toHaveLength(free.length);
			widest = Math.max(widest, ...free);
			// Within the limit, give or take the few degrees a stem wanders at its first node.
			for (const angle of held) expect(angle).toBeLessThan(40 + 4);
		}
		// Without it, the leans put side shoots of the second order far past it, some pointing back.
		expect(widest).toBeGreaterThan(90);
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

	it('gives each row the scale its height in the crown sets', () => {
		const plain: Species = {
			...record,
			shoots: {
				...record.shoots!,
				placement: {
					...record.shoots!.placement,
					shadePrune: 0,
					skyPrune: 0,
					tipPrune: undefined,
					bareTrim: 0,
				},
			},
		};
		const shaped: Species = {
			...plain,
			shoots: {
				...plain.shoots!,
				placement: {
					...plain.shoots!.placement,
					scaleByHeight: [
						[0, 1],
						[1, 0.5],
					],
				},
			},
		};
		const before = placeShoots({ ...input, record: plain });
		const after = placeShoots({ ...input, record: shaped });
		expect(after.count).toBe(before.count);
		expect(after.count).toBeGreaterThan(0);
		let low = 0;
		let high = 0;
		for (let r = 0; r < after.count; r++) {
			if ((after.position[r * 3 + 1] as number) < (after.position[low * 3 + 1] as number)) low = r;
			if ((after.position[r * 3 + 1] as number) > (after.position[high * 3 + 1] as number))
				high = r;
		}
		// The scale multiplier follows the row's height in the crown: each row takes the curve at its
		// crown share, so the highest rows take half and no row is left at the plain scale.
		const top = skeleton.height - skeleton.crownBase || 1;
		let upper = 0;
		let upperCount = 0;
		let lower = 0;
		let lowerCount = 0;
		for (let r = 0; r < after.count; r++) {
			const ratio = (after.scale[r] as number) / (before.scale[r] as number);
			expect(ratio).toBeGreaterThanOrEqual(0.5);
			expect(ratio).toBeLessThanOrEqual(1);
			const share = ((after.position[r * 3 + 1] as number) - skeleton.crownBase) / top;
			if (share > 0.75) {
				upper += ratio;
				upperCount++;
			} else if (share < 0.25) {
				lower += ratio;
				lowerCount++;
			}
		}
		// The crown's top rows take the shortened scale and its skirt keeps the plain one.
		expect(upperCount).toBeGreaterThan(0);
		expect(lowerCount).toBeGreaterThan(0);
		expect(upper / upperCount).toBeLessThan(0.8);
		// The oak's rows sit above its crown base, so its lowest rows already read partway along the
		// curve; they still keep more of the plain scale than the top rows do.
		expect(lower / lowerCount).toBeGreaterThan(upper / upperCount);
		expect((after.scale[high] as number) / (before.scale[high] as number)).toBeLessThan(0.95);
		expect((after.scale[low] as number) / (before.scale[low] as number)).toBeGreaterThan(
			(after.scale[high] as number) / (before.scale[high] as number),
		);
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

	it("gathers the shoots into masses and keeps the crown's share of them", () => {
		const clumped = (spacing: number, depth: number) =>
			placeShoots({
				...input,
				record: {
					...record,
					shoots: {
						...OAK_SHOOTS,
						placement: { ...OAK_SHOOTS.placement, clump: { spacing, depth } },
					},
				},
			});
		// How unevenly the rows crowd each other: the spread of each row's neighbours over the mean.
		const crowding = (rows: ReturnType<typeof placeShoots>) => {
			const n = rows.count;
			const samples = 200;
			const counts: number[] = [];
			for (let s = 0; s < samples; s++) {
				const r = Math.floor((s * n) / samples);
				const x = rows.position[r * 3] as number;
				const y = rows.position[r * 3 + 1] as number;
				const z = rows.position[r * 3 + 2] as number;
				let near = 0;
				for (let q = 0; q < n; q++) {
					if (q === r) continue;
					const dx = (rows.position[q * 3] as number) - x;
					const dy = (rows.position[q * 3 + 1] as number) - y;
					const dz = (rows.position[q * 3 + 2] as number) - z;
					if (dx * dx + dy * dy + dz * dz <= 0.36) near++;
				}
				counts.push(near);
			}
			const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
			const variance = counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / counts.length;
			return Math.sqrt(variance) / Math.max(1e-6, mean);
		};
		const even = placeShoots(input);
		const gathered = clumped(2.5, 0.8);
		expect(crowding(gathered)).toBeGreaterThan(crowding(even) * 1.15);
		// The masses take more shoots than the bare runs lose, but not the crown's cover with them.
		expect(gathered.count).toBeGreaterThan(even.count * 0.6);
		expect(gathered.count).toBeLessThan(even.count * 1.4);
		// A clump at no depth is the even placement again.
		const flat = clumped(2.5, 0);
		expect(Math.abs(flat.count - even.count)).toBeLessThan(even.count * 0.05);
	});

	it('stands the shoots on the limb masses when the record asks', () => {
		const massed = (limbMass?: NonNullable<typeof OAK_SHOOTS.placement>['limbMass']) =>
			placeShoots({
				...input,
				record: {
					...record,
					shoots: {
						...OAK_SHOOTS,
						placement: { ...OAK_SHOOTS.placement, limbMass },
					},
				},
			});
		const even = massed();
		const gathered = massed({ order: 1, hold: 0.5, reach: 2, depth: 1 });
		// The foliage keeps to the coarse wood, so the crown carries fewer rows.
		expect(gathered.count).toBeLessThan(even.count);
		// A row's distance to the nearest coarse node: the kept rows stand nearer that wood.
		const distanceToCoarse = (rows: ReturnType<typeof placeShoots>) => {
			const axes = skeleton.axes;
			const coarse: number[] = [];
			for (let a = 0; a < axes.count; a++) if ((axes.order[a] as number) <= 1) coarse.push(a);
			const near = (r: number) => {
				let best = Number.POSITIVE_INFINITY;
				for (const a of coarse)
					for (let n = axes.first[a] as number; n <= (axes.last[a] as number); n++) {
						const dx = (rows.position[r * 3] as number) - (skeleton.position[n * 3] as number);
						const dy =
							(rows.position[r * 3 + 1] as number) - (skeleton.position[n * 3 + 1] as number);
						const dz =
							(rows.position[r * 3 + 2] as number) - (skeleton.position[n * 3 + 2] as number);
						best = Math.min(best, Math.sqrt(dx * dx + dy * dy + dz * dz));
					}
				return best;
			};
			let sum = 0;
			for (let r = 0; r < rows.count; r++) sum += near(r);
			return sum / Math.max(1, rows.count);
		};
		expect(distanceToCoarse(gathered)).toBeLessThan(distanceToCoarse(even) * 0.9);
		// Absent, the crown is the record's own, row for row; and no depth keeps it too.
		expect(Array.from(even.position)).toEqual(Array.from(massed(undefined).position));
		const flat = massed({ order: 1, hold: 0.5, reach: 2, depth: 0 });
		expect(Math.abs(flat.count - even.count)).toBeLessThan(even.count * 0.05);
		// A part of the mass thin enough bears nothing at all, so the trim takes its wood with it:
		// the crown keeps its rows nearer the coarse wood and the skeleton loses the bare stretches.
		const trimmed = (limbMass: NonNullable<typeof OAK_SHOOTS.placement>['limbMass']) =>
			dressShoots({
				...input,
				record: {
					...record,
					shoots: {
						...OAK_SHOOTS,
						placement: { ...OAK_SHOOTS.placement, bareTrim: 0.1, limbMass },
					},
				},
			});
		const setting = { order: 1, hold: 0.5, reach: 2, depth: 1 } as const;
		const solid = trimmed(setting);
		const gated = trimmed({ ...setting, bare: 0.5 });
		expect(gated.rows.count).toBeLessThan(solid.rows.count);
		expect(gated.skeleton.axes.count).toBeLessThan(solid.skeleton.axes.count);
		expect(distanceToCoarse(gated.rows)).toBeLessThanOrEqual(distanceToCoarse(solid.rows));
	});

	it('gathers the shoots of one bud into a tuft at its node when the record asks', () => {
		// The mean distance from a row to the nearest bud site: a gather holds the rows at the sites
		// and leaves the internode between them bare.
		const reach = (gather: number) => {
			const rows = placeShoots({
				...input,
				record: {
					...record,
					shoots: { ...OAK_SHOOTS, placement: { ...OAK_SHOOTS.placement, gather } },
				},
			});
			const buds = skeleton.buds;
			let sum = 0;
			for (let r = 0; r < rows.count; r++) {
				let nearest = Number.POSITIVE_INFINITY;
				for (let b = 0; b < buds.count; b++) {
					const dx = (rows.position[r * 3] as number) - (buds.position[b * 3] as number);
					const dy = (rows.position[r * 3 + 1] as number) - (buds.position[b * 3 + 1] as number);
					const dz = (rows.position[r * 3 + 2] as number) - (buds.position[b * 3 + 2] as number);
					nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy + dz * dz));
				}
				sum += nearest;
			}
			return sum / rows.count;
		};
		expect(reach(0.2)).toBeLessThan(reach(1) * 0.7);
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

	it('turns the shoots further out from their wood when the record reaches', () => {
		const lean = (reach?: number) => {
			const rows = placeShoots({
				...input,
				record: {
					...record,
					shoots: {
						...OAK_SHOOTS,
						placement: {
							...OAK_SHOOTS.placement,
							...(reach === undefined ? {} : { reach }),
						},
					},
				},
			});
			const buds = skeleton.buds;
			let sum = 0;
			let count = 0;
			for (let r = 0; r < rows.count; r++) {
				// The row's own site: the nearest bud, whose frame gives the twig's line there.
				let nearest = 0;
				let least = Number.POSITIVE_INFINITY;
				for (let b = 0; b < buds.count; b++) {
					const dx = (rows.position[r * 3] as number) - (buds.position[b * 3] as number);
					const dy = (rows.position[r * 3 + 1] as number) - (buds.position[b * 3 + 1] as number);
					const dz = (rows.position[r * 3 + 2] as number) - (buds.position[b * 3 + 2] as number);
					const away = dx * dx + dy * dy + dz * dz;
					if (away < least) {
						least = away;
						nearest = b;
					}
				}
				const wood = quatRotate(buds.frame, nearest * 4, [0, 1, 0], [0, 0, 0]);
				const shoot = quatRotate(rows.rotation, r * 4, [0, 1, 0], [0, 0, 0]);
				const dot =
					(shoot[0] as number) * (wood[0] as number) +
					(shoot[1] as number) * (wood[1] as number) +
					(shoot[2] as number) * (wood[2] as number);
				sum += Math.acos(Math.min(1, Math.max(-1, dot)));
				count++;
			}
			return sum / count;
		};
		// A record that names no reach places its shoots as the buds' own angle does.
		expect(lean()).toBe(lean(0));
		expect(lean(20)).toBeGreaterThan(lean());
		expect(lean(40)).toBeGreaterThan(lean(20));
	});

	it('drops the rows of buds below the shade-prune line', () => {
		const all = placeShoots(input).count;
		const pruned = placeShoots({
			...input,
			record: {
				...record,
				shoots: {
					...OAK_SHOOTS,
					placement: { ...OAK_SHOOTS.placement, shadePrune: 0.8, tipPrune: 0.4 },
				},
			},
		}).count;
		expect(pruned).toBeLessThan(all);
	});

	it("leaves a starved tip bare under the record's tip line, and every tip its rosette without one", () => {
		// Every bud at half the sky, and few rows of a bud's own, so a tip's rosette is the one it
		// is given.
		const dim = {
			...skeleton,
			buds: { ...skeleton.buds, light: skeleton.buds.light.map(() => 0.5) },
		};
		const { tipPrune: _line, ...placement } = OAK_SHOOTS.placement;
		const rows = (tipPrune?: number) =>
			placeShoots({
				...input,
				skeleton: dim,
				record: {
					...record,
					shoots: {
						...OAK_SHOOTS,
						placement: { ...placement, density: 0.1, ...(tipPrune !== undefined && { tipPrune }) },
					},
				},
			}).count;
		const every = rows();
		expect(every).toBeGreaterThan(0);
		// A tip at the line keeps its rosette; under it, the tip starves.
		expect(rows(0.5)).toBe(every);
		expect(rows(0.6)).toBeLessThan(every);
	});

	it('orders rows along a space-filling curve, each rank once', () => {
		const rows = placeShoots(input);
		const ranks = new Set(rows.order);
		expect(ranks.size).toBe(rows.count);
		expect(Math.max(...rows.order)).toBe(rows.count - 1);
	});

	/** The row input with the record's placement changed. */
	const placed = (placement: Partial<ShootSpec['placement']>) => ({
		...input,
		record: {
			...record,
			shoots: { ...OAK_SHOOTS, placement: { ...OAK_SHOOTS.placement, ...placement } },
		},
	});
	/** A row's place as a key, to find a kept row among all of them. */
	const key = (rows: ReturnType<typeof placeShoots>, r: number) =>
		Array.from(rows.position.subarray(r * 3, r * 3 + 3)).join(',');

	it('drops the rows whose leaves the whole crown leaves under the sky-prune line, tips too', () => {
		const all = placeShoots(input);
		expect(placeShoots(placed({ skyPrune: 0 })).count).toBe(all.count);
		const line = 0.7;
		const kept = placeShoots(placed({ skyPrune: line }));
		expect(kept.count).toBeGreaterThan(0);
		expect(kept.count).toBeLessThan(all.count);
		// The rows that stay are exactly those that saw the line through the crown of every row.
		lightCrown(input, all);
		const lit = new Set<string>();
		for (let r = 0; r < all.count; r++)
			if ((all.sky[r] as number) >= Math.round(250 * line)) lit.add(key(all, r));
		expect(kept.count).toBe(lit.size);
		for (let r = 0; r < kept.count; r++) expect(lit.has(key(kept, r))).toBe(true);
	});

	it("keeps every height's best-lit rows when the sky-prune line reads by layer", () => {
		// The height layers the unpruned crown's rows stand in, each with its rows' count.
		const layers = (rows: ReturnType<typeof placeShoots>) => {
			const out = new Map<number, number>();
			for (let r = 0; r < rows.count; r++) {
				const layer = Math.floor((rows.position[r * 3 + 1] as number) / 1);
				out.set(layer, (out.get(layer) ?? 0) + 1);
			}
			return out;
		};
		const all = layers(placeShoots(input));
		const layered = placeShoots(placed({ skyPrune: 0.9, skyPruneLayer: 1 }));
		const whole = placeShoots(placed({ skyPrune: 0.9 }));
		expect(layered.count).toBeLessThan(placeShoots(input).count);
		// A line read against the whole sky empties the shaded layers; read by layer, every layer
		// keeps its lit rim.
		const kept = layers(layered);
		const wholeKept = layers(whole);
		let emptied = 0;
		for (const layer of all.keys()) if (!wholeKept.has(layer)) emptied++;
		expect(emptied).toBeGreaterThan(0);
		let lost = 0;
		for (const layer of all.keys()) if (!kept.has(layer)) lost++;
		expect(lost).toBeLessThan(emptied);
	});

	it('prunes by a crown light found once as it does by lighting its own rows', () => {
		const lit = placed({ skyPrune: 0.7 });
		const light = pruneLight(lit);
		expect(light).toBeDefined();
		const own = placeShoots(lit);
		const once = placeShoots({ ...lit, ...(light && { pruneLight: light }) });
		expect(once.count).toBe(own.count);
		expect(Array.from(once.position)).toEqual(Array.from(own.position));
		expect(pruneLight(input)).toBeUndefined();
		// The pruned plant stands on its lowest row.
		const dressed = dressShoots(lit);
		let lowest = Number.POSITIVE_INFINITY;
		for (let r = 0; r < dressed.rows.count; r++)
			lowest = Math.min(lowest, dressed.rows.position[r * 3 + 1] as number);
		expect(dressed.skeleton.crownBase).toBeCloseTo(lowest, 5);
	});

	it("turns each row up off its bud by the record's lift", () => {
		// The mean upward part of the rows' shoot directions.
		const rise = (lift: number) => {
			const rows = placeShoots(placed({ lift }));
			let sum = 0;
			for (let r = 0; r < rows.count; r++)
				sum += quatRotate(rows.rotation, r * 4, [0, 1, 0], [0, 0, 0])[1] as number;
			return sum / rows.count;
		};
		expect(rise(30)).toBeGreaterThan(rise(0) + 0.1);
		expect(rise(-30)).toBeLessThan(rise(0) - 0.1);
		// The turn stops at the most the tropism may give.
		expect(rise(90)).toBeCloseTo(rise(30), 9);
	});

	it('trims the thin wood that bears no row, and keeps each row on its own wood', () => {
		expect(dressShoots(input).skeleton).toBe(skeleton);
		// A high sky-prune line strips the crown's inside, tips among it, so whole twigs bear nothing.
		const plain = dressShoots(placed({ skyPrune: 0.9 }));
		const trimmed = dressShoots(placed({ skyPrune: 0.9, bareTrim: 0.1 }));
		expect(plain.skeleton.position).toBe(skeleton.position);
		expect(trimmed.rows.count).toBe(plain.rows.count);
		expect(trimmed.skeleton.nodeCount).toBeLessThan(skeleton.nodeCount);
		// Each row stands where it stood, and its wind record names the same wood in the trimmed
		// skeleton: an axis that leaves from the same place.
		const base = (s: MacroSkeleton, axis: number) =>
			Array.from(
				s.position.subarray(
					(s.axes.first[axis] as number) * 3,
					(s.axes.first[axis] as number) * 3 + 3,
				),
			).join(',');
		for (let r = 0; r < trimmed.rows.count; r++) {
			expect(key(trimmed.rows, r)).toBe(key(plain.rows, r));
			expect(base(trimmed.skeleton, trimmed.rows.record[r] as number)).toBe(
				base(skeleton, plain.rows.record[r] as number),
			);
		}
	});
});

describe('the bare trim', () => {
	/**
	 * A stem with four branches off its middle node: a thin one that bears a row at its middle
	 * node, a thin one that bears none and carries a thin twig that bears none, a thick one that
	 * bears none, and one that bears none and thins past the limit after its first node; and a thin
	 * dead stub.
	 */
	function tree(): MacroSkeleton {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const stemNodes: number[] = [];
		for (let k = 0; k < 3; k++)
			stemNodes.push(
				b.addNode({
					x: 0,
					y: k,
					z: 0,
					radius: 0.3,
					parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
					axis: stem,
				}),
			);
		const branch = (radius: number, along: number, parentAxis: number, from: number, flags = 0) => {
			const axis = b.addAxis({ parent: parentAxis, parentNode: from, order: 1, kind: AXIS_LIMB });
			const nodes: number[] = [];
			for (let k = 1; k <= 3; k++)
				nodes.push(
					b.addNode({
						x: along * k,
						y: 1,
						z: 0,
						radius: radius * (1 - 0.2 * k),
						parent: k === 1 ? from : (nodes[k - 2] as number),
						axis,
						flags: k === 1 ? flags : 0,
					}),
				);
			for (const node of nodes)
				b.addBud({
					node,
					x: along,
					y: 1,
					z: 0,
					frame: [0, 0, 0, 1],
					kind: BUD_TERMINAL,
					vigor: 0.5,
					light: 1,
					axis,
					woodRadius: radius,
				});
			return { axis, nodes };
		};
		const bearing = branch(0.02, 1, stem, stemNodes[1] as number);
		const bare = branch(0.02, -1, stem, stemNodes[1] as number);
		branch(0.01, -0.5, bare.axis, bare.nodes[0] as number);
		branch(0.2, 0.5, stem, stemNodes[1] as number);
		branch(0.02, 0.3, stem, stemNodes[2] as number, NODE_STUB);
		branch(0.08, 0.2, stem, stemNodes[1] as number);
		void bearing;
		return b.finish(0);
	}

	it('keeps the stem, the thick wood, the dead stub and the bearing wood up to its row', () => {
		const skeleton = tree();
		// The bearing branch's middle node bears a row on axis 1.
		const node = (skeleton.axes.first[1] as number) + 1;
		const out = bareTrimmed(skeleton, [node], [1], 0.05, 1);
		expect(out).toBeDefined();
		const { skeleton: kept, axisOut } = out as NonNullable<typeof out>;
		expect(Array.from(axisOut)).toEqual([0, 1, -1, -1, 2, 3, 4]);
		const length = (axis: number) =>
			(kept.axes.last[axis] as number) - (kept.axes.first[axis] as number) + 1;
		// The bearing branch ends at its row; the thick one keeps all three nodes, as does the stub;
		// the one that thins keeps only its thick first node.
		expect(length(1)).toBe(2);
		expect(length(2)).toBe(3);
		expect(length(3)).toBe(3);
		expect(length(4)).toBe(1);
		expect(length(0)).toBe(3);
		// The bud sites on the trimmed wood go with it, and the crown stands on the base it is given.
		expect(kept.buds.count).toBe(2 + 3 + 3 + 1);
		expect(kept.crownBase).toBe(1);
	});

	it('trims nothing when every thin branch bears to its end', () => {
		const skeleton = tree();
		const ends = [1, 2, 3, 5, 6].map((a) => skeleton.axes.last[a] as number);
		expect(bareTrimmed(skeleton, ends, [1, 2, 3, 5, 6], 0.05, 1)).toBeUndefined();
	});

	it('cuts every branch end at its last shoot when the crop asks, and a branch left bare goes', () => {
		const skeleton = tree();
		const node = (skeleton.axes.first[1] as number) + 1;
		const out = bareTrimmed(skeleton, [node], [1], 0.05, 1, true);
		expect(out).toBeDefined();
		const { skeleton: kept, axisOut } = out as NonNullable<typeof out>;
		// The stem, the bearing branch and the dead stub stay; the thick branch with no shoot and the
		// one that thins both go, because neither carries foliage.
		expect(axisOut[0]).toBeGreaterThanOrEqual(0);
		expect(axisOut[1]).toBeGreaterThanOrEqual(0);
		expect(axisOut[2]).toBe(-1);
		expect(axisOut[3]).toBe(-1);
		expect(axisOut[4]).toBe(-1);
		expect(axisOut[5]).toBeGreaterThanOrEqual(0);
		expect(axisOut[6]).toBe(-1);
		const length = (axis: number) =>
			(kept.axes.last[axis] as number) - (kept.axes.first[axis] as number) + 1;
		expect(length(axisOut[1] as number)).toBe(2);
		expect(length(axisOut[5] as number)).toBe(3);
	});
});

describe('the plate run', () => {
	/** Internodes that crowd three leaves, open out, then crowd three more. */
	const BUNCHED: readonly (readonly [number, number])[] = [
		[0, 1.5],
		[0.15, 0.3],
		[0.45, 0.3],
		[0.6, 1.5],
		[0.8, 0.3],
		[1, 0.3],
	];
	const withCurve = (plate: boolean): Species => {
		const base = oakRecord();
		return {
			...base,
			shoots: {
				...base.shoots!,
				// A strong zigzag, so a blade that keeps its own node's frame visibly turns away.
				stem: { ...base.shoots!.stem, zigzag: 40 },
				placement: { ...base.shoots!.placement, plate },
				classes: base.shoots!.classes.map((c) => ({ ...c, internode: BUNCHED })),
			},
		};
	};
	/** The runs of consecutive crowded nodes, each with its blades. */
	const runs = (plan: ShootPlan): PlannedLeaf[][] => {
		const crowded = plan.leaves
			.filter((leaf) => leaf.crowded >= 0.4)
			.sort((a, b) => a.node - b.node);
		const groups: PlannedLeaf[][] = [];
		for (const leaf of crowded) {
			const last = groups[groups.length - 1] as PlannedLeaf[] | undefined;
			if (last && leaf.node === (last[last.length - 1] as PlannedLeaf).node + 1) last.push(leaf);
			else groups.push([leaf]);
		}
		return groups.filter((group) => group.length > 1);
	};
	const shared = (group: PlannedLeaf[]) =>
		group.every((leaf) => leaf.sky.every((v, k) => v === (group[0] as PlannedLeaf).sky[k]));

	it('holds a run of crowded nodes to one face where the record asks', () => {
		const on = runs(planShoot(withCurve(true), 0, 1));
		const off = runs(planShoot(withCurve(false), 0, 1));
		expect(on.length).toBeGreaterThan(0);
		expect(off.length).toBe(on.length);
		// With the field every blade of a run keeps the run's first face; without it they turn apart.
		for (const group of on) expect(shared(group)).toBe(true);
		expect(off.some((group) => !shared(group))).toBe(true);
	});
});

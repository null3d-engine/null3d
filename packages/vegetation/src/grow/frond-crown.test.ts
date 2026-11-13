// The directed crown of fronds, read from the plant it builds: the record's fronds, dead fronds and
// flower sites round one growing point; every socket ranked once across the plant, so a sparse plant
// keeps every rank spread round the trunk; the drawn top at the variant's height with the trunk
// taking the difference; and the frond pieces as their rules state them, read from the kit's meshes:
// each rachis on its arch at every tier, the leaflets in two ranks at their lifts, and the leaflets'
// mesh no finer than the rule names.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PrototypeArrays, ShootPrototype, SpeciesKitData } from '../asset';
import { BUD_FLOWER, type MacroSkeleton } from '../core/graph';
import { asin, quatRotate, type Vector3 } from '../core/math';
import type { FrondCrown, Species } from '../core/record';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { foliage } from '../leaf/kinds';
import {
	type PieceRule,
	type PieceStem,
	pieceKey,
	piecePrototypes,
	planPiece,
} from '../leaf/piece';
import { SURFACE_LEAF, SURFACE_PIECE, SURFACE_STEM } from '../leaf/writer';
import { azimuthOf, drawnTop, elevationOf, largestGap } from './directed.test-support';
import { radicalInverse } from './frond-crown';
import { targetHeight } from './height';

const LONG = scaledBudget(120_000);
/** The species the grower serves. */
const SPECIES = ['date-palm', 'tree-fern'] as const;
/** The variants each test grows. */
const VARIANTS = [0, 1, 2] as const;

interface Built {
	readonly kit: SpeciesKitData;
	readonly growth: FrondCrown;
	readonly record: Species;
}

const built = new Map<string, Built>();

beforeAll(async () => {
	for (const id of SPECIES) {
		const module = await loadSpecies(id);
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
		built.set(id, { kit, record: kit.record, growth: kit.record.growth as FrondCrown });
	}
}, LONG);

const of = (id: string) => built.get(id) as Built;

/**
 * The sockets of a skeleton, by bud site, with the group each stands in: the rank of living fronds
 * whose piece it carries and whose leaving angle stands nearest its own, or, for a dead frond, the
 * group after the living ranks. A rank's spread is at most half the gap to its neighbours, so the
 * nearest angle names its rank.
 */
function socketsOf(
	skeleton: MacroSkeleton,
	record: Species,
): { bud: number; rank: number; group: number }[] {
	const growth = record.growth as FrondCrown;
	const names = (record.pieces ?? []).map((piece) => piece.name);
	const { buds } = skeleton;
	const out: { bud: number; rank: number; group: number }[] = [];
	if (!buds.sockets) return out;
	for (let b = 0; b < buds.count; b++) {
		if ((buds.kind[b] as number) === BUD_FLOWER) continue;
		const piece = names[buds.sockets.piece?.[b] ?? 0];
		let group = growth.fronds.ranks.length;
		if (piece !== growth.dead?.piece) {
			const leave = elevationOf(skeleton, b);
			let nearest = Number.POSITIVE_INFINITY;
			growth.fronds.ranks.forEach((rank, r) => {
				const off = Math.abs(rank.leave - leave);
				if (rank.piece === piece && off < nearest) {
					nearest = off;
					group = r;
				}
			});
		}
		out.push({ bud: b, rank: buds.sockets.rank[b] as number, group });
	}
	return out;
}

/** The growing point's height: the top of the trunk, the skeleton's first axis. */
function growingPoint(skeleton: MacroSkeleton): number {
	return skeleton.position[(skeleton.axes.last[0] as number) * 3 + 1] as number;
}

/** The bud sites of the flower kind. */
function flowersOf(skeleton: MacroSkeleton): number {
	let count = 0;
	for (let b = 0; b < skeleton.buds.count; b++)
		if ((skeleton.buds.kind[b] as number) === BUD_FLOWER) count++;
	return count;
}

/** The distance from a point to a triangle, in metres. */
function toTriangle(p: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
	const sub = (x: Vector3, y: Vector3): Vector3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
	const dot = (x: Vector3, y: Vector3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	// The nearest point by its barycentric weights, clamped onto the triangle's edges.
	const d00 = dot(ab, ab);
	const d01 = dot(ab, ac);
	const d11 = dot(ac, ac);
	const d20 = dot(ap, ab);
	const d21 = dot(ap, ac);
	const denominator = d00 * d11 - d01 * d01;
	let v = denominator > 0 ? (d11 * d20 - d01 * d21) / denominator : 0;
	let w = denominator > 0 ? (d00 * d21 - d01 * d20) / denominator : 0;
	if (v < 0 || w < 0 || v + w > 1) {
		const along = (x: Vector3, y: Vector3) => {
			const e = sub(y, x);
			const t = Math.min(1, Math.max(0, dot(sub(p, x), e) / Math.max(1e-12, dot(e, e))));
			const q: Vector3 = [x[0] + e[0] * t, x[1] + e[1] * t, x[2] + e[2] * t];
			return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
		};
		return Math.min(along(a, b), along(b, c), along(c, a));
	}
	v = Math.max(0, v);
	w = Math.max(0, w);
	const q: Vector3 = [
		a[0] + ab[0] * v + ac[0] * w,
		a[1] + ab[1] * v + ac[1] * w,
		a[2] + ab[2] * v + ac[2] * w,
	];
	return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * The farthest the main stem a rule plans lies outside the stem triangles of the low tier's mesh, in metres: how far the coarse tube strays from
 * the planned arch.
 */
function strayFromPlan(
	record: Species,
	rule: PieceRule,
	index: number,
	coarse: PrototypeArrays,
): number {
	const axis = planPiece(record, rule, pieceKey(index, 0), 1).axes[0] ?? [];
	const point = (i: number): Vector3 => [
		coarse.positions[i * 3] as number,
		coarse.positions[i * 3 + 1] as number,
		coarse.positions[i * 3 + 2] as number,
	];
	const stem = (i: number) => (coarse.colors[i * 4 + 2] as number) === SURFACE_STEM;
	const triangles: [Vector3, Vector3, Vector3][] = [];
	for (let t = 0; t < coarse.indices.length; t += 3) {
		const a = coarse.indices[t] as number;
		const b = coarse.indices[t + 1] as number;
		const c = coarse.indices[t + 2] as number;
		if (stem(a) && stem(b) && stem(c)) triangles.push([point(a), point(b), point(c)]);
	}
	let most = 0;
	for (const { at, radius } of axis) {
		let least = Infinity;
		for (const [a, b, c] of triangles) least = Math.min(least, toTriangle([...at], a, b, c));
		most = Math.max(most, least - radius);
	}
	return most;
}

/** Whether a vertex's surface kind is a leaf's: a living leaf, or a browned piece's leaf. */
const leafKind = (kind: number) => kind === SURFACE_LEAF || kind === SURFACE_PIECE;

/** The leaf meshes a species' pieces take at every tier, low first, as the kit step builds them. */
function leavesByTier(kit: SpeciesKitData): (readonly PrototypeArrays[])[] {
	const builder = foliage(kit.record.foliage.kind);
	return DETAILS.map((tier) =>
		builder.pieceLeaves
			? builder.pieceLeaves(kit.record, kit.manifest, tier)
			: builder.leaves(kit.record, kit.manifest, tier),
	);
}

describe('the frond-crown grower', () => {
	for (const id of SPECIES) {
		describe(id, () => {
			it("lays the record's fronds, dead fronds and flower sites round one growing point", () => {
				const { kit, growth, record } = of(id);
				for (const variant of VARIANTS) {
					const asset = growPlantNow(kit, { seed: 11, variant, near: true });
					const sockets = socketsOf(asset.skeleton, record);
					const ranks = growth.fronds.ranks.length;
					const living = sockets.filter((s) => s.group < ranks).length;
					const dead = sockets.filter((s) => s.group === ranks).length;
					const { count } = growth.fronds;
					const mean = typeof count === 'number' ? count : count.mean;
					const spread = typeof count === 'number' ? 0 : count.spread;
					expect(living).toBeGreaterThanOrEqual(Math.floor(mean - spread));
					expect(living).toBeLessThanOrEqual(Math.ceil(mean + spread));
					// Every rank holds its share of the living fronds, to within one.
					for (const [r, rank] of growth.fronds.ranks.entries())
						expect(
							Math.abs(sockets.filter((s) => s.group === r).length - rank.share * living),
						).toBeLessThanOrEqual(1.5);
					if (growth.dead) expect(dead).toBeGreaterThan(0);
					if (growth.flowers) expect(flowersOf(asset.skeleton)).toBeGreaterThan(0);
					// The sockets stand on the trunk's top, no lower than the dead fronds' ring.
					const top = growingPoint(asset.skeleton);
					const lowest = top - (growth.dead?.to ?? growth.fronds.clasp) - 0.05;
					for (const { bud } of sockets) {
						const y = asset.skeleton.buds.position[bud * 3 + 1] as number;
						expect(y).toBeGreaterThanOrEqual(lowest);
						expect(y).toBeLessThanOrEqual(top + 0.05);
					}
				}
			});

			it('ranks every socket once across the plant, so the sparsest plant keeps every rank spread round the trunk', () => {
				const { kit, growth, record } = of(id);
				for (const variant of VARIANTS) {
					const full = growPlantNow(kit, { seed: 11, variant, near: true });
					const ranks = socketsOf(full.skeleton, record).map((s) => s.rank);
					expect([...ranks].sort((a, b) => a - b)).toEqual(ranks.map((_, i) => i));
					const sparse = growPlantNow(kit, { seed: 11, variant, near: true, sparse: 1 });
					const kept = socketsOf(sparse.skeleton, record);
					for (let r = 0; r < growth.fronds.ranks.length; r++)
						expect(kept.some((s) => s.group === r)).toBe(true);
					const living = kept.filter((s) => s.group < growth.fronds.ranks.length);
					expect(living.length).toBeLessThan(socketsOf(full.skeleton, record).length);
					// No half of the trunk's circle is left without a living frond.
					expect(largestGap(living.map((s) => azimuthOf(sparse.skeleton, s.bud)))).toBeLessThan(
						180,
					);
					if (growth.flowers) expect(flowersOf(sparse.skeleton)).toBeGreaterThan(0);
				}
			});

			it("lays each rank's fronds over its stated spread", () => {
				const { kit, growth, record } = of(id);
				for (const variant of VARIANTS) {
					const { skeleton } = growPlantNow(kit, { seed: 11, variant, near: true });
					growth.fronds.ranks.forEach((rank, r) => {
						if (rank.spread === undefined) return;
						const leaves = socketsOf(skeleton, record)
							.filter((s) => s.group === r)
							.map((s) => elevationOf(skeleton, s.bud));
						if (leaves.length < 3) return;
						expect(Math.min(...leaves)).toBeGreaterThanOrEqual(rank.leave - rank.spread - 0.01);
						expect(Math.max(...leaves)).toBeLessThanOrEqual(rank.leave + rank.spread + 0.01);
						// An even spread covers more than half its width with three fronds or more.
						expect(Math.max(...leaves) - Math.min(...leaves)).toBeGreaterThan(rank.spread);
					});
				}
			});

			it("stands the drawn top at the variant's height, the trunk taking the difference", () => {
				const { kit, record } = of(id);
				const rises: number[] = [];
				const trunks: number[] = [];
				const targets: number[] = [];
				for (const variant of VARIANTS) {
					const asset = growPlantNow(kit, { seed: 11, variant, near: true });
					const target = targetHeight(record, 11, variant);
					const top = drawnTop(kit, asset);
					expect(Math.abs(top - target) / target).toBeLessThan(0.03);
					rises.push(top - growingPoint(asset.skeleton));
					trunks.push(growingPoint(asset.skeleton));
					targets.push(target);
				}
				// The crown keeps its measured size whatever the variant's height: its rise strays only by
				// its fronds' own spread of angles, within two hundredths of the plant's height, while the
				// trunk moves by the whole difference between the variants' heights.
				const height = Math.max(...targets);
				for (const rise of rises)
					expect(Math.abs(rise - (rises[0] as number))).toBeLessThan(0.02 * height);
				for (const [v, trunk] of trunks.entries())
					expect(
						Math.abs(
							trunk - (trunks[0] as number) - ((targets[v] as number) - (targets[0] as number)),
						),
					).toBeLessThan(0.02 * height);
			});
		});
	}
});

describe('the frond pieces', () => {
	for (const id of SPECIES) {
		describe(id, () => {
			it(
				'draws each rachis on its arch at every tier, and the far tier without its rings draws a chord',
				() => {
					const { kit, record } = of(id);
					const rules = record.pieces ?? [];
					expect(rules.length).toBeGreaterThan(0);
					// The far tier's main stem against the plan's own: within two hundredths of the frond's
					// length of the arch it was planned on.
					for (const [r, rule] of rules.entries()) {
						const prototype = kit.prototypes.find(
							(p: ShootPrototype) => p.piece?.name === rule.name && p.piece.part === 0,
						) as ShootPrototype;
						const stray = strayFromPlan(record, rule, r, prototype.tiers[0] as PrototypeArrays);
						expect(stray).toBeLessThan(0.02 * prototype.length);
					}
					// The same arched rule with no ring bend: its far tier runs straight from foot to tip.
					const r = rules.findIndex((rule) => (rule.stem.droop ?? 0) >= 40);
					const arched = rules[r] as PieceRule;
					const unringed = ({ rings: _rings, ...stem }: PieceStem): PieceStem => stem;
					const plain: PieceRule = {
						...arched,
						stem: unringed(arched.stem),
					};
					const [control] = piecePrototypes(record, [plain], leavesByTier(kit));
					const built = control as NonNullable<typeof control>;
					expect(
						strayFromPlan(record, plain, r, built.tiers[0] as PrototypeArrays),
					).toBeGreaterThan(0.05 * built.length);
				},
				LONG,
			);

			it("holds each living frond's leaflets in two ranks at the lifts its rule names", () => {
				const { record } = of(id);
				for (const [r, rule] of (record.pieces ?? []).entries()) {
					const lifts = rule.stem.leaves?.ranked;
					if (!lifts) continue;
					const plan = planPiece(record, rule, pieceKey(r, 0), 1);
					let first = 0;
					let second = 0;
					for (const leaf of plan.leaves) {
						const up =
							leaf.radial[0] * leaf.sky[0] +
							leaf.radial[1] * leaf.sky[1] +
							leaf.radial[2] * leaf.sky[2];
						const lift = (asin(Math.min(1, Math.max(-1, up))) * 180) / Math.PI;
						expect(Math.min(...lifts.map((l) => Math.abs(l - lift)))).toBeLessThan(0.5);
						const side: Vector3 = [
							leaf.stem[1] * leaf.sky[2] - leaf.stem[2] * leaf.sky[1],
							leaf.stem[2] * leaf.sky[0] - leaf.stem[0] * leaf.sky[2],
							leaf.stem[0] * leaf.sky[1] - leaf.stem[1] * leaf.sky[0],
						];
						if (leaf.radial[0] * side[0] + leaf.radial[1] * side[1] + leaf.radial[2] * side[2] > 0)
							first++;
						else second++;
					}
					expect(first).toBe(second);
				}
			});

			it(
				"draws a narrow leaflet as a card far off and folded at its midrib near, at the picture's count",
				() => {
					const { kit, record } = of(id);
					const leaf = record.foliage.kind === 'blade' ? record.foliage.leaf : undefined;
					if (!leaf?.narrow) return;
					const tiers = leavesByTier(kit);
					const leafTriangles = (mesh: PrototypeArrays) => {
						let count = 0;
						for (let t = 0; t < mesh.indices.length; t += 3)
							if (leafKind(mesh.colors[(mesh.indices[t] as number) * 4 + 2] as number)) count++;
						return count;
					};
					// One leaflet: two triangles at the low and medium tiers, four at the high and ultra tiers,
					// whose two halves stand at the leaf's fold to each other.
					expect(tiers.map((tier) => leafTriangles(tier[0] as PrototypeArrays))).toEqual([
						2, 2, 4, 4,
					]);
					const near = tiers[DETAILS.indexOf('high')]?.[0] as PrototypeArrays;
					const normals = new Set<string>();
					for (let i = 0; i < near.normals.length; i += 3)
						normals.add(
							[0, 1, 2].map((k) => Math.round((near.normals[i + k] as number) * 20)).join(','),
						);
					expect(normals.size).toBeGreaterThanOrEqual(2);
					// Every frond's leaflets take that mesh at each tier the kit holds.
					for (const prototype of kit.prototypes.filter((p: ShootPrototype) => p.piece))
						for (const tier of ['low', 'medium', 'high'] as const) {
							const t = DETAILS.indexOf(tier);
							expect(leafTriangles(prototype.tiers[t] as PrototypeArrays)).toBe(
								prototype.leaves * leafTriangles(tiers[t]?.[0] as PrototypeArrays),
							);
						}
					// A living frond holds its picture's count: the palm about 80 leaflets a side, the fern 30
					// or more pinna pairs.
					const least = id === 'date-palm' ? 150 : 60;
					const living = kit.prototypes.filter(
						(p: ShootPrototype) => p.piece && !p.piece.name.includes('dead'),
					);
					for (const prototype of living) expect(prototype.leaves).toBeGreaterThanOrEqual(least);
				},
				LONG,
			);
		});
	}
});

describe('the dead fronds', () => {
	it('draw their leaves browned to the full, and the living fronds not at all', () => {
		for (const id of SPECIES) {
			const { kit, record } = of(id);
			for (const prototype of kit.prototypes.filter((p: ShootPrototype) => p.piece)) {
				const rule = (record.pieces ?? []).find((r) => r.name === prototype.piece?.name);
				const mesh = prototype.tiers[DETAILS.indexOf('high')] as PrototypeArrays;
				let browned = 0;
				let living = 0;
				for (let i = 0; i < mesh.colors.length / 4; i++) {
					const kind = mesh.colors[i * 4 + 2] as number;
					if (kind === SURFACE_PIECE) {
						browned++;
						expect(mesh.uvs1[i * 2 + 1]).toBeCloseTo(rule?.browning ?? 0, 5);
					} else if (kind === SURFACE_LEAF) living++;
				}
				if (rule?.browning) expect(living).toBe(0);
				else expect(browned).toBe(0);
				expect(browned + living).toBeGreaterThan(0);
			}
		}
	});
});

describe('the frond roll', () => {
	it('turns each frond of a rolled rule about its own line by the stated roll, and no other', () => {
		for (const id of SPECIES) {
			const { kit, record } = of(id);
			const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const rows = asset.shoots;
			for (let r = 0; r < rows.count; r++) {
				const prototype = kit.prototypes[rows.prototype[r] as number] as ShootPrototype;
				const rule = (record.pieces ?? []).find((p) => p.name === prototype.piece?.name);
				if (!rule) continue;
				const line: Vector3 = [0, 0, 0];
				const sky: Vector3 = [0, 0, 0];
				quatRotate(rows.rotation, r * 4, [0, 1, 0], line);
				quatRotate(rows.rotation, r * 4, [0, 0, 1], sky);
				// The unrolled sky side: the world's up made square to the line.
				const along = line[1];
				const level: Vector3 = [-line[0] * along, 1 - line[1] * along, -line[2] * along];
				const size = Math.hypot(level[0], level[1], level[2]);
				const cos = (sky[0] * level[0] + sky[1] * level[1] + sky[2] * level[2]) / size;
				const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
				expect(Math.abs(angle - Math.abs(rule.roll ?? 0))).toBeLessThan(0.5);
			}
		}
	});
});

describe('the radical inverse', () => {
	it('spreads every leading run of indices evenly over the unit range', () => {
		for (const count of [2, 4, 8, 16]) {
			const values = Array.from({ length: count }, (_, i) => radicalInverse(i)).sort(
				(a, b) => a - b,
			);
			for (const [i, value] of values.entries()) expect(value).toBeCloseTo(i / count, 9);
		}
	});
});

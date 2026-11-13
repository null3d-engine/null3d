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
import { type PieceRule, pieceKey, piecePrototypes, planPiece } from '../leaf/piece';
import { SURFACE_LEAF, SURFACE_STEM } from '../leaf/writer';
import { radicalInverse } from './frond-crown';
import { targetHeight } from './height';

const LONG = scaledBudget(120_000);
/** The species the grower serves. */
const SPECIES = ['date-palm'] as const;
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

/** The sockets of a skeleton, by bud site, with the group each stands in. */
function socketsOf(skeleton: MacroSkeleton): { bud: number; rank: number; group: number }[] {
	const { buds } = skeleton;
	const out: { bud: number; rank: number; group: number }[] = [];
	for (let b = 0; b < buds.count; b++)
		if ((buds.kind[b] as number) !== BUD_FLOWER && buds.sockets)
			out.push({
				bud: b,
				rank: buds.sockets.rank[b] as number,
				group: buds.sockets.lobe[b] as number,
			});
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

/** The azimuth of a bud site round the trunk's axis, in degrees. */
function azimuthOf(skeleton: MacroSkeleton, bud: number): number {
	const heading: Vector3 = [0, 0, 0];
	quatRotate(skeleton.buds.frame, bud * 4, [0, 1, 0], heading);
	return (Math.atan2(heading[2], heading[0]) * 180) / Math.PI;
}

/** The largest gap in degrees between neighbouring azimuths round a circle. */
function largestGap(azimuths: readonly number[]): number {
	const sorted = azimuths.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
	let gap = 0;
	for (let i = 0; i < sorted.length; i++) {
		const next = i + 1 < sorted.length ? (sorted[i + 1] as number) : (sorted[0] as number) + 360;
		gap = Math.max(gap, next - (sorted[i] as number));
	}
	return gap;
}

/** The highest drawn point of a plant's near level: its wood and every row's prototype. */
function drawnTop(kit: SpeciesKitData, asset: ReturnType<typeof growPlantNow>): number {
	let top = asset.skeleton.height;
	const rows = asset.shoots;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const mesh = kit.prototypes[rows.prototype[r] as number]?.tiers[DETAILS.indexOf('high')];
		if (!mesh) continue;
		const scale = rows.scale[r] as number;
		for (let i = 0; i < mesh.positions.length; i += 3) {
			local[0] = (mesh.positions[i] as number) * scale;
			local[1] = (mesh.positions[i + 1] as number) * scale;
			local[2] = (mesh.positions[i + 2] as number) * scale;
			quatRotate(rows.rotation, r * 4, local, world);
			top = Math.max(top, (rows.position[r * 3 + 1] as number) + world[1]);
		}
	}
	return top;
}

/** The vertices of one surface kind in a prototype's mesh. */
function verticesOf(mesh: PrototypeArrays, kind: number): Vector3[] {
	const out: Vector3[] = [];
	for (let i = 0; i < mesh.positions.length / 3; i++)
		if ((mesh.colors[i * 4 + 2] as number) === kind)
			out.push([
				mesh.positions[i * 3] as number,
				mesh.positions[i * 3 + 1] as number,
				mesh.positions[i * 3 + 2] as number,
			]);
	return out;
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
 * The farthest any stem vertex of `fine` lies from the stem triangles of `coarse`, in metres: how far
 * the coarse mesh's stem strays from the fine mesh's path.
 */
function strayOf(fine: PrototypeArrays, coarse: PrototypeArrays): number {
	const point = (mesh: PrototypeArrays, i: number): Vector3 => [
		mesh.positions[i * 3] as number,
		mesh.positions[i * 3 + 1] as number,
		mesh.positions[i * 3 + 2] as number,
	];
	const stem = (mesh: PrototypeArrays, i: number) =>
		(mesh.colors[i * 4 + 2] as number) === SURFACE_STEM;
	const triangles: [Vector3, Vector3, Vector3][] = [];
	for (let t = 0; t < coarse.indices.length; t += 3) {
		const [a, b, c] = [coarse.indices[t], coarse.indices[t + 1], coarse.indices[t + 2]] as [
			number,
			number,
			number,
		];
		if (stem(coarse, a) && stem(coarse, b) && stem(coarse, c))
			triangles.push([point(coarse, a), point(coarse, b), point(coarse, c)]);
	}
	let most = 0;
	for (const p of verticesOf(fine, SURFACE_STEM)) {
		let least = Infinity;
		for (const [a, b, c] of triangles) least = Math.min(least, toTriangle(p, a, b, c));
		most = Math.max(most, least);
	}
	return most;
}

/** The species' leaf meshes at every tier, low first, as the kit step builds them. */
function leavesByTier(kit: SpeciesKitData): (readonly PrototypeArrays[])[] {
	const builder = foliage(kit.record.foliage.kind);
	return DETAILS.map((tier) => builder.leaves(kit.record, kit.manifest, tier));
}

describe('the frond-crown grower', () => {
	for (const id of SPECIES) {
		describe(id, () => {
			it("lays the record's fronds, dead fronds and flower sites round one growing point", () => {
				const { kit, growth } = of(id);
				for (const variant of VARIANTS) {
					const asset = growPlantNow(kit, { seed: 11, variant, near: true });
					const sockets = socketsOf(asset.skeleton);
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
				const { kit, growth } = of(id);
				for (const variant of VARIANTS) {
					const full = growPlantNow(kit, { seed: 11, variant, near: true });
					const ranks = socketsOf(full.skeleton).map((s) => s.rank);
					expect([...ranks].sort((a, b) => a - b)).toEqual(ranks.map((_, i) => i));
					const sparse = growPlantNow(kit, { seed: 11, variant, near: true, sparse: 1 });
					const kept = socketsOf(sparse.skeleton);
					for (let r = 0; r < growth.fronds.ranks.length; r++)
						expect(kept.some((s) => s.group === r)).toBe(true);
					const living = kept.filter((s) => s.group < growth.fronds.ranks.length);
					expect(living.length).toBeLessThan(socketsOf(full.skeleton).length);
					// No half of the trunk's circle is left without a living frond.
					expect(largestGap(living.map((s) => azimuthOf(sparse.skeleton, s.bud)))).toBeLessThan(
						180,
					);
					if (growth.flowers) expect(flowersOf(sparse.skeleton)).toBeGreaterThan(0);
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
				// its fronds' own spread of angles, within a hundredth of the plant's height, while the
				// trunk moves by the whole difference between the variants' heights.
				const height = Math.max(...targets);
				for (const rise of rises)
					expect(Math.abs(rise - (rises[0] as number))).toBeLessThan(0.01 * height);
				for (const [v, trunk] of trunks.entries())
					expect(
						Math.abs(
							trunk - (trunks[0] as number) - ((targets[v] as number) - (targets[0] as number)),
						),
					).toBeLessThan(0.01 * height);
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
					const pieces = kit.prototypes.filter((p: ShootPrototype) => p.piece);
					expect(pieces.length).toBeGreaterThan(0);
					// The coarse tube has fewer sides, so its surface stands inside the fine one's by up to half
					// a radius: within two hundredths of the frond's length is on the arch.
					for (const prototype of pieces) {
						const [low, , high] = prototype.tiers;
						expect(strayOf(high as PrototypeArrays, low as PrototypeArrays)).toBeLessThan(
							0.02 * prototype.length,
						);
					}
					// The same arched rule with no ring bend: its far tier runs straight from foot to tip.
					const arched = (record.pieces ?? []).find(
						(rule) => (rule.stem.droop ?? 0) >= 40,
					) as PieceRule;
					const { rings: _rings, ...straight } = arched.stem;
					const plain: PieceRule = { ...arched, stem: straight };
					const [control] = piecePrototypes(record, [plain], leavesByTier(kit));
					const [low, , high] = (control as NonNullable<typeof control>).tiers;
					expect(strayOf(high as PrototypeArrays, low as PrototypeArrays)).toBeGreaterThan(
						0.05 * (control as NonNullable<typeof control>).length,
					);
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
				"meshes the leaflets no finer than the rule names, at the fact sheet's count",
				() => {
					const { kit, record } = of(id);
					const tiers = leavesByTier(kit);
					// The leaf-kind vertices of one leaf mesh; its stalk is of another kind.
					const perLeaf = (tier: number) =>
						verticesOf(tiers[tier]?.[0] as PrototypeArrays, SURFACE_LEAF).length;
					for (const prototype of kit.prototypes.filter((p: ShootPrototype) => p.piece)) {
						const rule = (record.pieces ?? []).find(
							(r) => r.name === prototype.piece?.name,
						) as PieceRule;
						const most = rule.leafDetail ? DETAILS.indexOf(rule.leafDetail) : DETAILS.length - 1;
						const high = prototype.tiers[DETAILS.indexOf('high')] as PrototypeArrays;
						expect(verticesOf(high, SURFACE_LEAF).length).toBe(
							prototype.leaves * perLeaf(Math.min(most, DETAILS.indexOf('high'))),
						);
					}
					// A living frond holds at least the fact sheet's least, a hundred leaflets a side.
					const living = kit.prototypes.filter(
						(p: ShootPrototype) => p.piece && !p.piece.name.includes('dead'),
					);
					for (const prototype of living) expect(prototype.leaves).toBeGreaterThanOrEqual(200);
					// The same rule with no finest mesh takes the high tier's own leaf mesh.
					const rule = (record.pieces ?? [])[0] as PieceRule;
					const { leafDetail: _finest, ...fine } = rule;
					const [own] = piecePrototypes(record, [fine], tiers);
					const ownHigh = (own as NonNullable<typeof own>).tiers[
						DETAILS.indexOf('high')
					] as PrototypeArrays;
					expect(verticesOf(ownHigh, SURFACE_LEAF).length).toBe(
						(own as NonNullable<typeof own>).leaves * perLeaf(DETAILS.indexOf('high')),
					);
					expect(perLeaf(DETAILS.indexOf('high'))).toBeGreaterThan(perLeaf(0));
				},
				LONG,
			);
		});
	}
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

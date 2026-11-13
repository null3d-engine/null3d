// The frond-colony grower on the bracken. Its frame: every frond on a foot of its own, spread
// evenly over the patch and joined by the buried rhizome; each stalk plumb and straight, turned
// over at its top in one smooth curve; the fronds' sizes as the record ranges them; the season's
// ages; one plant size through the year. Its leaves: each a kit piece that is one body and begins
// at its socket, on the end of its own stalk, in an order that thins the patch without leaving a
// leaf off a stalk or a stalk off the rhizome.
import { describe, expect, it } from 'bun:test';
import { plantAssetDigest } from '../asset';
import { MOST_TURN } from '../core/arch';
import { speciesBox } from '../core/box';
import { speciesProblems } from '../core/check';
import { AXIS_ROOT, AXIS_STIPE, type MacroSkeleton, skeletonBuffers } from '../core/graph';
import { hashAt, hashBytes } from '../core/hash';
import type { FrondColony } from '../core/record';
import { loadSpecies } from '../core/registry';
import { DETAILS, type Season, spreadMax, spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { SURFACE_PIECE } from '../leaf/writer';
import { bodies, toMesh } from './body.fixture';
import { brackenRecord } from './bracken.fixture';
import { growFrondColony } from './frond-colony';
import { targetHeight } from './height';
import { classOf, keptAt, ownMesh, placeOf, standing, staying } from './pieces.fixture';

/** A hash of every array a skeleton holds. */
function digest(skeleton: MacroSkeleton): number {
	let hash = hashAt(skeleton.nodeCount, skeleton.axes.count, skeleton.buds.count);
	for (const buffer of skeletonBuffers(skeleton)) hash = hashBytes(new Uint8Array(buffer), hash);
	return hash;
}

function grow(season: Season = 'summer', variant = 0, seed = 11): MacroSkeleton {
	return growFrondColony({ record: brackenRecord, seed, variant, season });
}

const colony = brackenRecord.growth as FrondColony;
const HEIGHT = spreadMean(brackenRecord.size.height);

/** A skeleton's stalks, each as its nodes from the rhizome up. */
function stalksOf(skeleton: MacroSkeleton): number[][][] {
	const out: number[][][] = [];
	for (let a = 0; a < skeleton.axes.count; a++) {
		if ((skeleton.axes.kind[a] as number) !== AXIS_STIPE) continue;
		const nodes: number[][] = [];
		for (let n = skeleton.axes.first[a] as number; n <= (skeleton.axes.last[a] as number); n++)
			nodes.push([0, 1, 2].map((k) => skeleton.position[n * 3 + k] as number));
		out.push(nodes);
	}
	return out;
}

/** Degrees a step between two points stands above level. */
function elevation(a: readonly number[], b: readonly number[]): number {
	const dx = (b[0] as number) - (a[0] as number);
	const dy = (b[1] as number) - (a[1] as number);
	const dz = (b[2] as number) - (a[2] as number);
	return (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
}

/** Degrees between each pair of neighbouring steps of a run of points. */
function turns(points: readonly number[][]): number[] {
	const found: number[] = [];
	for (let i = 1; i + 1 < points.length; i++) {
		const [a, b, c] = [points[i - 1], points[i], points[i + 1]] as [number[], number[], number[]];
		const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
		const v = [0, 1, 2].map((k) => (c[k] as number) - (b[k] as number));
		const dot = u.reduce((sum, x, k) => sum + x * (v[k] as number), 0);
		const length = Math.hypot(...u) * Math.hypot(...v);
		found.push((Math.acos(Math.min(1, Math.max(-1, dot / length))) * 180) / Math.PI);
	}
	return found;
}

const summer = grow();

describe("the frond colony's frame", () => {
	it('takes a record the check passes', () => {
		expect(speciesProblems(brackenRecord)).toEqual([]);
	});

	it('stands every frond on a foot of its own, spread over the whole patch', () => {
		const feet = stalksOf(summer).map((nodes) => nodes[0] as number[]);
		expect(feet.length).toBeGreaterThanOrEqual(15);
		expect(feet.length).toBeLessThanOrEqual(17);
		// No two feet share a place: a patch of singles, not of bunches.
		let nearest = Number.POSITIVE_INFINITY;
		for (let a = 0; a < feet.length; a++)
			for (let b = a + 1; b < feet.length; b++)
				nearest = Math.min(
					nearest,
					Math.hypot(
						(feet[a]?.[0] ?? 0) - (feet[b]?.[0] ?? 0),
						(feet[a]?.[2] ?? 0) - (feet[b]?.[2] ?? 0),
					),
				);
		expect(nearest).toBeGreaterThan(0.08 * HEIGHT);
		// The feet fill the record's ellipse: none outside it, and each quarter holds its share.
		const quarters = [0, 0, 0, 0];
		for (const foot of feet) {
			const x = (foot[0] as number) / ((colony.patch.long * HEIGHT) / 2);
			const z = (foot[2] as number) / ((colony.patch.short * HEIGHT) / 2);
			expect(x * x + z * z).toBeLessThanOrEqual(1 + 1e-9);
			quarters[(x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0)] =
				(quarters[(x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0)] ?? 0) + 1;
		}
		for (const held of quarters) expect(held).toBeGreaterThanOrEqual(2);
		const across = feet.map((foot) => foot[0] as number);
		expect(Math.max(...across) - Math.min(...across)).toBeGreaterThan(
			0.7 * colony.patch.long * HEIGHT,
		);
	});

	it('joins every foot to the rhizome, each to a foot that stands before it', () => {
		const { axes } = summer;
		const roots: number[] = [];
		for (let a = 0; a < axes.count; a++) if ((axes.kind[a] as number) === AXIS_ROOT) roots.push(a);
		const stalks = stalksOf(summer);
		expect(roots.length).toBe(stalks.length);
		roots.forEach((a, k) => {
			// A piece of rhizome hangs on one that came before it, so any leading run hangs together.
			const parent = axes.parent[a] as number;
			if (k === 0) expect(parent).toBe(-1);
			else expect(roots.indexOf(parent)).toBeLessThan(k);
			expect(roots.indexOf(parent)).toBeGreaterThanOrEqual(k === 0 ? -1 : 0);
			// It ends under its own frond's foot, at the rhizome's depth.
			const end = axes.last[a] as number;
			const foot = stalks[k]?.[0] as number[];
			for (let c = 0; c < 3; c++)
				expect(summer.position[end * 3 + c]).toBeCloseTo(foot[c] as number, 6);
			expect(foot[1]).toBeCloseTo(-colony.rhizome.depth, 6);
		});
	});

	it('stands each stalk plumb and straight and turns it over in one smooth curve at its top', () => {
		for (const nodes of stalksOf(summer)) {
			const count = nodes.length;
			// Its lower third stands within the record's lean of plumb.
			const lean = 90 - elevation(nodes[0] as number[], nodes[Math.floor(count / 3)] as number[]);
			expect(lean).toBeLessThanOrEqual(spreadMax(colony.stipe.lean) + 0.5);
			// No step turns more than the shared curve allows, so the bend has no kink.
			for (const turn of turns(nodes))
				expect(turn).toBeLessThanOrEqual((MOST_TURN[0] as number) + 0.5);
		}
	});

	it("holds each grown leaf on its stalk's end, between level and the record's most tilt", () => {
		const { buds, axes } = summer;
		let leaves = 0;
		for (let b = 0; b < buds.count; b++) {
			if (buds.sockets === undefined) continue;
			leaves++;
			const axis = buds.axis[b] as number;
			const last = axes.last[axis] as number;
			// The socket stands on the stalk's last node.
			for (let k = 0; k < 3; k++)
				expect(buds.position[b * 3 + k]).toBeCloseTo(summer.position[last * 3 + k] as number, 6);
			// The stalk's end points the way the leaf is held. A crozier's stalk still stands up.
			const held = elevation(
				[0, 1, 2].map((k) => summer.position[(last - 1) * 3 + k] as number),
				[0, 1, 2].map((k) => summer.position[last * 3 + k] as number),
			);
			expect(held).toBeGreaterThanOrEqual(colony.tilt[0] - 4);
			if (held < 60) expect(held).toBeLessThanOrEqual(colony.tilt[1] + 4);
		}
		expect(leaves).toBe(stalksOf(summer).length);
	});

	it("grows most fronds tall and the record's few short ones at the front edge", () => {
		const stalks = stalksOf(summer);
		const tops = stalks.map((nodes) => Math.max(...nodes.map((node) => node[1] as number)));
		const tallest = Math.max(...tops);
		const shortCount = Math.round(colony.heights.shortShare * stalks.length);
		const byFront = stalks
			.map((nodes, f) => ({ f, z: nodes[0]?.[2] as number }))
			.sort((a, b) => b.z - a.z)
			.map((entry) => entry.f);
		byFront.forEach((f, place) => {
			// A crozier is smaller than its place says, so only the upper bound binds it.
			const share = (tops[f] as number) / tallest;
			if (place < shortCount) expect(share).toBeLessThanOrEqual(colony.heights.short[1] + 0.12);
			else expect(share).toBeLessThanOrEqual(1);
		});
		expect(shortCount).toBeGreaterThan(0);
	});

	it('ages its fronds by the season, and keeps one size through the year', () => {
		const sockets = (skeleton: MacroSkeleton) => {
			let count = 0;
			for (let b = 0; b < skeleton.buds.count; b++)
				if (skeleton.buds.sockets !== undefined) count++;
			return count;
		};
		const winter = grow('winter');
		// A broken winter stalk has lost its leaf; the rest lie down.
		expect(sockets(winter)).toBeLessThanOrEqual(sockets(summer));
		let lying = 0;
		for (const nodes of stalksOf(winter)) {
			const end = nodes[nodes.length - 1] as number[];
			const start = nodes[0] as number[];
			const length = Math.hypot(...[0, 1, 2].map((k) => (end[k] as number) - (start[k] as number)));
			if ((end[1] as number) - (start[1] as number) < 0.25 * length) lying++;
		}
		expect(lying).toBeGreaterThan(stalksOf(winter).length / 2);
		for (const season of ['blossom', 'autumn', 'winter'] as const)
			expect(Math.abs(grow(season).height - summer.height) / summer.height).toBeLessThan(0.02);
	});

	it('grows the same bytes twice, and other bytes for another variant or seed', () => {
		const first = digest(summer);
		expect(digest(grow())).toBe(first);
		expect(digest(grow('summer', 1))).not.toBe(first);
		expect(digest(grow('summer', 0, 12))).not.toBe(first);
	});

	it('stays inside the species box in every season and variant', () => {
		const box = speciesBox(brackenRecord);
		for (const season of ['summer', 'autumn', 'winter', 'blossom'] as const)
			for (let variant = 0; variant < brackenRecord.variants; variant++) {
				const { min, max } = grow(season, variant).bounds;
				for (let k = 0; k < 3; k++) {
					expect(min[k] as number).toBeGreaterThan(box.min[k] as number);
					expect(max[k] as number).toBeLessThan(box.max[k] as number);
				}
			}
	});
});

describe("the bracken's leaves at their sockets", async () => {
	const module = await loadSpecies('bracken');
	await loadPlantCode(module.record);
	const growth = module.record.growth as FrondColony;
	const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
	const options = { seed: 11, variant: 0, near: true } as const;
	const asset = growPlantNow(kit, options);
	const grown = { kit, asset };
	const stalkWidth = growth.frond.petiole.width;

	it('builds every leaf as one body that begins at its socket, under the vertex cap', () => {
		expect(kit.prototypes.length).toBeGreaterThan(0);
		DETAILS.forEach((detail, tier) => {
			const built =
				detail === kit.detail ? kit : buildKitNow(module, { detail, placeholders: 'missing' });
			for (const prototype of built.prototypes) {
				const mesh = prototype.tiers[tier];
				if (!mesh) throw new Error(`${prototype.piece?.name ?? ''} has no ${detail} tier`);
				expect(mesh.positions.length / 3).toBeGreaterThan(0);
				expect(mesh.positions.length / 3).toBeLessThanOrEqual(65_535);
				// A leaf is one sheet: two parts of it join only where they share an edge or lie
				// within a stalk's width.
				expect([prototype.piece?.name ?? '', detail, bodies(mesh, stalkWidth)]).toEqual([
					prototype.piece?.name ?? '',
					detail,
					1,
				]);
				expect(toMesh(mesh, [0, 0, 0])).toBeLessThanOrEqual(stalkWidth);
				for (let i = 0; i < mesh.positions.length / 3; i++) {
					expect(mesh.colors[i * 4 + 2]).toBe(SURFACE_PIECE);
					expect(mesh.uvs1[i * 2] as number).toBeGreaterThanOrEqual(0);
					expect(mesh.uvs1[i * 2] as number).toBeLessThanOrEqual(1);
				}
			}
		});
	});

	it('holds a grown leaf in three shapes, a young and a browning leaf in two stages, and a dead one', () => {
		const names = kit.prototypes.map((prototype) =>
			(prototype.piece?.name ?? '').replace(/-\d+$/, ''),
		);
		const count = (name: string) => names.filter((held) => held === name).length;
		expect(count('leaf-grown')).toBe(3);
		expect(count('leaf-young')).toBe(2);
		expect(count('leaf-brown')).toBe(2);
		expect(names).toContain('leaf-lying');
		// A browning leaf carries its browning to the material, and a grown one carries none.
		const tier = DETAILS.indexOf(kit.detail);
		const browning = (name: string) => {
			const mesh = kit.prototypes.find((prototype) => (prototype.piece?.name ?? '') === name)
				?.tiers[tier];
			if (!mesh) throw new Error(`no ${name}`);
			let most = 0;
			for (let i = 1; i < mesh.uvs1.length; i += 2) most = Math.max(most, mesh.uvs1[i] as number);
			return most;
		};
		expect(browning('leaf-grown-1')).toBe(0);
		expect(browning('leaf-brown-1')).toBeGreaterThan(browning('leaf-brown-0'));
		expect(browning('leaf-brown-0')).toBeGreaterThan(0);
	});

	it('puts its sockets in the order the patch thins by', () => {
		const stay = staying(asset);
		expect(stay.length).toBe(asset.shoots.count);
		for (let r = 1; r < stay.length; r++)
			expect(stay[r] as number).toBeLessThanOrEqual(stay[r - 1] as number);
		// The sockets stand in the order of their thinning rank, and row r stands at socket r.
		const sockets = asset.skeleton.buds.sockets;
		for (let b = 0; b < stay.length; b++) expect(sockets?.rank[b]).toBe(b);
		expect(keptAt(asset, 1)).toBe(growth.least);
	});

	for (const sparseness of [0, 0.5, 1] as const)
		it(`is one body at sparseness ${sparseness}: every kept leaf on its stalk, every stalk on the rhizome`, () => {
			const kept = keptAt(asset, sparseness);
			const wood = ownMesh(grown, 0, 'wood');
			expect(wood.indices.length).toBeGreaterThan(0);
			const { skeleton } = asset;
			const scale = skeleton.height / grow().height;
			let seen = 0;
			for (let b = 0; b < skeleton.buds.count && seen < kept; b++) {
				if (skeleton.buds.sockets === undefined) continue;
				// The leaf stands on the drawn end of its stalk.
				expect(toMesh(wood, placeOf(asset, seen))).toBeLessThanOrEqual(stalkWidth * scale);
				// Its stalk's foot stands in the drawn rhizome, at each level.
				const first = skeleton.axes.first[skeleton.buds.axis[b] as number] as number;
				const foot = [0, 1, 2].map((k) => skeleton.position[first * 3 + k] as number);
				for (const level of [0, 1, 2] as const)
					expect(toMesh(ownMesh(grown, level), foot)).toBeLessThanOrEqual(
						2 * growth.rhizome.radius * scale,
					);
				seen++;
			}
			expect(seen).toBe(kept);
		});

	it('keeps its least patch over the whole footprint', () => {
		const least = keptAt(asset, 1);
		const across = (count: number) => {
			const xs: number[] = [];
			for (let r = 0; r < count; r++) xs.push(placeOf(asset, r)[0] as number);
			return Math.max(...xs) - Math.min(...xs);
		};
		expect(least).toBe(growth.least);
		// Five fronds still stand over more than half of the patch's long way.
		expect(across(least)).toBeGreaterThan(0.5 * across(asset.shoots.count));
	});

	it('stands as tall as its record asks, in a box that holds its leaves', () => {
		const target = targetHeight(module.record, options.seed, options.variant);
		const { top, min, max } = standing(grown);
		expect(Math.abs(Math.max(top, asset.skeleton.bounds.max[1]) - target) / target).toBeLessThan(
			0.05,
		);
		const { bounds } = asset.skeleton;
		const width = (max[0] as number) - (min[0] as number);
		for (const k of [0, 2]) {
			expect(bounds.min[k] as number).toBeLessThanOrEqual((min[k] as number) + 0.05 * width);
			expect(bounds.max[k] as number).toBeGreaterThanOrEqual((max[k] as number) - 0.05 * width);
			expect(bounds.min[k] as number).toBeGreaterThanOrEqual((min[k] as number) - 0.15 * width);
			expect(bounds.max[k] as number).toBeLessThanOrEqual((max[k] as number) + 0.15 * width);
		}
	});

	it('draws its stalks as wood, its leaves as rows and its rhizome as its own mesh', () => {
		for (const level of asset.levels) {
			const names = level.parts.map((part) => part.name);
			expect(names).toContain('wood');
			expect(names).toContain('foliage');
		}
		expect(asset.shoots.count).toBeGreaterThanOrEqual(growth.least);
		for (let r = 0; r < asset.shoots.count; r++) expect(classOf(grown, r)).toMatch(/^leaf-/);
	});

	it('cuts a frond that keeps its leaf', () => {
		const cut = buildKitNow(module, { detail: 'high', placeholders: 'missing', cutting: true });
		const frond = growPlantNow(cut, { ...options, cutting: { part: 'branch' } });
		expect(frond.shoots.count).toBe(1);
		expect(frond.levels[0].parts.map((part) => part.name)).toContain('wood');
	});

	it('grows the same plant each time, and another for another variant or season', () => {
		const first = plantAssetDigest(asset);
		expect(plantAssetDigest(growPlantNow(kit, options))).toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, variant: 1 }))).not.toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, season: 'winter' }))).not.toBe(first);
	});
});

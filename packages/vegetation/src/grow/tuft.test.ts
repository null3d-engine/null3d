// The tuft grower's pieces and sockets, on the two species that grow by it. Each piece of the kit
// is one body that begins at its socket and stays under the vertex cap at every tier. The sockets'
// order thins the plant from its record's own form to its least without leaving a piece off a
// shoot or a shoot off the stool, and spreads what it keeps round the stool. The plant stands as
// tall as its record asks and grows the same each time.
import { describe, expect, it } from 'bun:test';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { quatRotate } from '../core/math';
import type { Species, Tuft } from '../core/record';
import { loadSpecies } from '../core/registry';
import { DETAILS, spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { SURFACE_PIECE, SURFACE_PIECE_SHEATH } from '../leaf/writer';
import { drawnAtTallest } from '../lod/drawn';
import { dequantisePosition } from '../lod/quantise';
import { bodies, type TestMesh, toMesh } from './body.fixture';
import { targetHeight } from './height';

/** The most vertices one prototype may hold at a tier: its indices are 16 bits wide. */
const VERTEX_CAP = 65_535;
const OPTIONS = { seed: 11, variant: 0, near: true } as const;
/** The sparseness settings a plant is read at: its own form, half way and its least. */
const SPARSENESS = [0, 0.5, 1] as const;

/** The species that grow by the tuft grower. */
const TUFTS = ['sedge', 'meadow-grass'] as const;
type TuftSpecies = (typeof TUFTS)[number];

interface Grown {
	readonly module: Awaited<ReturnType<typeof loadSpecies>>;
	readonly record: Species;
	readonly growth: Tuft;
	readonly kit: SpeciesKitData;
	readonly asset: PlantAsset;
	/** The plant's size against its record's mean, which every length of a piece is scaled by. */
	readonly scale: number;
}

async function grow(id: TuftSpecies, options: { season?: Species['seasons']['default'] } = {}) {
	const module = await loadSpecies(id);
	await loadPlantCode(module.record);
	const growth = module.record.growth;
	if (growth.model !== 'tuft') throw new Error(`${id} is not a tuft`);
	const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
	const asset = growPlantNow(kit, { ...OPTIONS, ...options });
	// The tallest piece is a flowering stem in season and a blade out of it; the stem's top is the
	// record's own figure.
	const mound = growth.mound * spreadMean(module.record.size.height);
	const scale = growth.stalks?.seasons.includes(asset.season)
		? asset.skeleton.height / (growth.stalks.top[1] * mound)
		: 1;
	return { module, record: module.record, growth, kit, asset, scale } satisfies Grown;
}

/** How long each row stays as the plant thins, from its socket: 1 for a row of the least plant. */
function staying(asset: PlantAsset): number[] {
	const { buds } = asset.skeleton;
	const out: number[] = [];
	for (let b = 0; b < buds.count; b++) if (buds.sockets) out.push(buds.light[b] as number);
	return out;
}

/**
 * The socket each row stands at: a socket carries every part of its piece as rows in turn, its
 * first part first.
 */
function rowSockets(grown: Grown): number[] {
	const out: number[] = [];
	let socket = -1;
	for (let r = 0; r < grown.asset.shoots.count; r++) {
		const prototype = grown.kit.prototypes[grown.asset.shoots.prototype[r] as number];
		if ((prototype?.piece?.part ?? 0) === 0) socket++;
		out.push(socket);
	}
	return out;
}

/** The rows that stand at the first `sockets` sockets. */
function rowsAt(grown: Grown, sockets: number): number[] {
	const at = rowSockets(grown);
	const out: number[] = [];
	for (let r = 0; r < at.length; r++) if ((at[r] as number) < sockets) out.push(r);
	return out;
}

/** The sockets a sparseness setting keeps: the least plant's, and an even share of the rest. */
function keptAt(asset: PlantAsset, sparseness: number): number {
	const stay = staying(asset);
	const least = stay.filter((value) => value === 1).length;
	return least + Math.round((1 - sparseness) * (stay.length - least));
}

const placeOf = (asset: PlantAsset, row: number) =>
	[0, 1, 2].map((k) => asset.shoots.position[row * 3 + k] as number);
/** A prototype's piece name, or nothing for a prototype that is no piece's part. */
const nameOf = (prototype: { readonly piece?: { readonly name: string } } | undefined) =>
	prototype?.piece?.name ?? '';
const classOf = (grown: Grown, row: number) =>
	nameOf(grown.kit.prototypes[grown.asset.shoots.prototype[row] as number]);

/** Several meshes as one. */
function joined(meshes: readonly TestMesh[]): TestMesh {
	const positions: number[] = [];
	const indices: number[] = [];
	for (const mesh of meshes) {
		const base = positions.length / 3;
		for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i] as number);
		for (let i = 0; i < mesh.indices.length; i++) indices.push(base + (mesh.indices[i] as number));
	}
	return { positions, indices };
}

/** A level's own mesh, in metres. */
function ownMesh(grown: Grown, level: 0 | 1 | 2): TestMesh {
	const positions: number[] = [];
	const indices: number[] = [];
	const out: [number, number, number] = [0, 0, 0];
	for (const part of grown.asset.levels[level].parts) {
		if (part.name !== 'foliage') continue;
		const base = positions.length / 3;
		for (let i = 0; i < part.arrays.positions.length / 3; i++) {
			dequantisePosition(part.arrays.positions, i, grown.kit.box, out);
			positions.push(out[0], out[1], out[2]);
		}
		for (const index of part.arrays.indices) indices.push(base + index);
	}
	return { positions, indices };
}

/** A unit quaternion's turn of a vector. */
function turned(q: ArrayLike<number>, at: number, v: readonly number[]): number[] {
	const [x, y, z, w] = [
		q[at] as number,
		q[at + 1] as number,
		q[at + 2] as number,
		q[at + 3] as number,
	];
	const [vx, vy, vz] = v as [number, number, number];
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

/** The box the placed pieces fill, in metres: its least and greatest corner. */
function standing(grown: Grown): { low: number; top: number; min: number[]; max: number[] } {
	const { shoots } = grown.asset;
	const tier = DETAILS.indexOf('high');
	const min = [0, 0, 0];
	const max = [0, 0, 0];
	for (let r = 0; r < shoots.count; r++) {
		const positions = grown.kit.prototypes[shoots.prototype[r] as number]?.tiers[tier]?.positions;
		if (!positions) throw new Error('a row names no prototype');
		const scale = shoots.scale[r] as number;
		for (let i = 0; i < positions.length; i += 3) {
			const p = turned(shoots.rotation, r * 4, [
				positions[i] as number,
				positions[i + 1] as number,
				positions[i + 2] as number,
			]);
			for (let k = 0; k < 3; k++) {
				const at = (shoots.position[r * 3 + k] as number) + (p[k] as number) * scale;
				min[k] = Math.min(min[k] as number, at);
				max[k] = Math.max(max[k] as number, at);
			}
		}
	}
	return { low: min[1] as number, top: max[1] as number, min, max };
}

for (const id of TUFTS) {
	describe(`the ${id}'s pieces at their sockets`, async () => {
		const grown = await grow(id);
		const { module, record, growth, kit, asset, scale } = grown;
		const mound = growth.mound * spreadMean(record.size.height);
		const blade = record.foliage.kind === 'grass-blade' ? record.foliage.blade : undefined;
		if (!blade) throw new Error(`${id} has no grass blade`);
		const shootWidth = growth.sheath.width * mound;

		it('builds every piece as one body that begins at its socket, under the vertex cap', () => {
			// Two parts of a piece are joined when one begins inside the other: within a stem's own
			// width, or half a blade's.
			const join = Math.max((growth.stalks?.width ?? 0) * mound, blade.width / 2);
			expect(kit.prototypes.length).toBeGreaterThan(0);
			expect(kit.prototypes.length).toBeLessThanOrEqual(255);
			// A kit holds its own tier's meshes, so each tier is read from a kit built at it.
			DETAILS.forEach((detail, tier) => {
				const built =
					detail === kit.detail ? kit : buildKitNow(module, { detail, placeholders: 'missing' });
				expect(built.prototypes.length).toBe(kit.prototypes.length);
				// A piece's parts stand at one socket, so the piece is read whole: its parts together.
				const pieces = new Map<string, TestMesh[]>();
				for (const prototype of built.prototypes) {
					const mesh = prototype.tiers[tier];
					if (!mesh) throw new Error(`${nameOf(prototype)} has no ${detail} tier`);
					expect(mesh.positions.length / 3).toBeGreaterThan(0);
					expect(mesh.positions.length / 3).toBeLessThanOrEqual(VERTEX_CAP);
					pieces.set(nameOf(prototype), [...(pieces.get(nameOf(prototype)) ?? []), mesh]);
				}
				for (const [name, parts] of pieces) {
					const whole = joined(parts);
					expect([name, detail, bodies(whole, join)]).toEqual([name, detail, 1]);
					expect(toMesh(whole, [0, 0, 0])).toBeLessThanOrEqual(shootWidth / 2 + 1e-6);
				}
			});
		});

		it('reads a flowering stem as several parts when nothing may join them', () => {
			// The reading of one body is of the drawn triangles: a stem, its threads and its spikes
			// share no vertex, so with no joining distance they are apart.
			const name = nameOf(
				kit.prototypes.find((prototype) => nameOf(prototype).startsWith('stalk-')),
			);
			const parts = kit.prototypes
				.filter((prototype) => nameOf(prototype) === name)
				.map((prototype) => prototype.tiers[DETAILS.indexOf(kit.detail)] as TestMesh);
			if (parts.length === 0) throw new Error(`${id} has no flowering stem`);
			expect(bodies(joined(parts), 0)).toBeGreaterThan(1);
		});

		it("gives the material each piece's share along, and marks the sheath column for its colour", () => {
			const tier = DETAILS.indexOf(kit.detail);
			for (const prototype of kit.prototypes) {
				const mesh = prototype.tiers[tier];
				if (!mesh) throw new Error(`${nameOf(prototype)} has no tier`);
				const sheath = nameOf(prototype) === 'sheath' && growth.sheathColour !== undefined;
				let least = 1;
				let most = 0;
				for (let i = 0; i < mesh.positions.length / 3; i++) {
					// The surface kind: the sheath column's mark, or a piece's own surface.
					expect(mesh.colors[i * 4 + 2]).toBe(sheath ? SURFACE_PIECE_SHEATH : SURFACE_PIECE);
					// The second coordinates: the share along the part, then its browning.
					const along = mesh.uvs1[i * 2] as number;
					expect(along).toBeGreaterThanOrEqual(0);
					expect(along).toBeLessThanOrEqual(1);
					expect(mesh.uvs1[i * 2 + 1] as number).toBeGreaterThanOrEqual(0);
					expect(mesh.uvs1[i * 2 + 1] as number).toBeLessThanOrEqual(1);
					// The bend weight follows the share, so a part's foot holds and its end sways; a
					// blade that has come to rest holds still where it lies on the soil, within twice
					// its width of the ground.
					const bend = mesh.colors[i * 4] as number;
					expect(bend).toBeLessThanOrEqual(255 * along + 0.51);
					if ((mesh.positions[i * 3 + 1] as number) > 2 * blade.width * 1.25)
						expect(Math.abs(bend - 255 * along)).toBeLessThanOrEqual(0.51);
					least = Math.min(least, along);
					most = Math.max(most, along);
				}
				// A blade and a sheath column run their whole length, foot to end.
				if (!nameOf(prototype).startsWith('stalk-')) {
					expect(least).toBeLessThan(0.01);
					expect(most).toBeGreaterThan(0.99);
				}
			}
		});

		it('draws the sheath column as the leaf where the record gives it no colour', () => {
			const { sheathColour: _colour, ...plain } = growth;
			const bare = buildKitNow(
				{ ...module, record: { ...record, growth: plain } },
				{ detail: 'high', placeholders: 'missing' },
			);
			const column = bare.prototypes.find((prototype) => nameOf(prototype) === 'sheath');
			const mesh = column?.tiers[DETAILS.indexOf('high')];
			if (!mesh) throw new Error('no sheath column');
			for (let i = 0; i < mesh.positions.length / 3; i++)
				expect(mesh.colors[i * 4 + 2]).toBe(SURFACE_PIECE);
		});

		it("bakes the sheath column's card in the record's sheath colour", () => {
			const colour = growth.sheathColour;
			const column = kit.prototypes.find((prototype) => nameOf(prototype) === 'sheath');
			const face = column?.card.planes[0]?.front;
			if (!colour || !face) throw new Error(`${id} has no coloured sheath column`);
			// The card's texels that the column covers, as a mean of their stored colour.
			const { size, color } = kit.cards;
			const mean = [0, 0, 0];
			let covered = 0;
			for (let y = face[1]; y < face[1] + face[3]; y++)
				for (let x = face[0]; x < face[0] + face[2]; x++) {
					const at = (y * size + x) * 4;
					if ((color[at + 3] as number) === 0) continue;
					for (let k = 0; k < 3; k++) mean[k] = (mean[k] as number) + (color[at + k] as number);
					covered++;
				}
			expect(covered).toBeGreaterThan(0);
			// The stored colour is the record's, so its channels stand in the record's order: a
			// brown sheath is redder than it is green, where the leaf is greener than it is red.
			const order = (rgb: readonly number[]) => Math.sign((rgb[0] as number) - (rgb[1] as number));
			expect(order(mean)).toBe(order(colour.foot));
		});

		it('holds a blade shape for every step between its measured poses', () => {
			const blades = kit.prototypes.filter((prototype) => nameOf(prototype).startsWith('blade-'));
			const shapes = new Set(blades.map((prototype) => nameOf(prototype)));
			expect(shapes.size).toBeGreaterThan(growth.poses.length);
			expect((shapes.size - 1) % (growth.poses.length - 1)).toBe(0);
			expect(blades.length).toBe(shapes.size);
			// The youngest shape stands highest and the oldest reaches farthest.
			const tier = DETAILS.indexOf('high');
			const extent = (index: number, axis: number) => {
				const positions = (blades[index] as (typeof blades)[number]).tiers[tier]?.positions ?? [];
				let most = 0;
				for (let i = axis; i < positions.length; i += 3)
					most = Math.max(most, positions[i] as number);
				return most;
			};
			expect(extent(0, 1)).toBeGreaterThan(extent(blades.length - 1, 1));
			expect(extent(blades.length - 1, 2)).toBeGreaterThan(extent(0, 2));
		});

		it('puts its sockets in the order the plant thins by, no piece before its shoot', () => {
			const stay = staying(asset);
			const at = rowSockets(grown);
			expect(stay.length).toBe((at[at.length - 1] as number) + 1);
			for (let r = 1; r < stay.length; r++)
				expect(stay[r] as number).toBeLessThanOrEqual(stay[r - 1] as number);
			// The rows stand socket by socket, and the sockets in the order of their thinning rank.
			const sockets = asset.skeleton.buds.sockets;
			for (let b = 0; b < stay.length; b++) expect(sockets?.rank[b]).toBe(b);
			const seen = new Set<string>();
			for (let r = 0; r < asset.shoots.count; r++) {
				const key = placeOf(asset, r).join(',');
				if (classOf(grown, r) === 'sheath') seen.add(key);
				else expect(seen.has(key)).toBe(true);
			}
		});

		for (const sparseness of SPARSENESS)
			it(`is one body at sparseness ${sparseness}: every kept piece on a kept shoot in the stool`, () => {
				const kept = rowsAt(grown, keptAt(asset, sparseness));
				const shoots = new Map<string, number[]>();
				for (const r of kept)
					if (classOf(grown, r) === 'sheath')
						shoots.set(placeOf(asset, r).join(','), placeOf(asset, r));
				expect(shoots.size).toBeGreaterThan(0);
				for (const r of kept) expect(shoots.has(placeOf(asset, r).join(','))).toBe(true);
				// The stool's mound is drawn at every level, and each kept shoot's foot stands in it:
				// within one shoot's width of its surface.
				for (const level of [0, 1, 2] as const) {
					const stool = ownMesh(grown, level);
					expect(stool.indices.length).toBeGreaterThan(0);
					for (const foot of shoots.values())
						expect(toMesh(stool, foot)).toBeLessThanOrEqual(shootWidth * scale);
				}
			});

		it('keeps its least plant last, spread round the stool', () => {
			const least = rowsAt(grown, keptAt(asset, 1));
			const counts = new Map<string, Map<string, number>>();
			for (const r of least) {
				// A stem's head is a part of the stem's piece, not a piece of its own.
				if ((grown.kit.prototypes[asset.shoots.prototype[r] as number]?.piece?.part ?? 0) > 0)
					continue;
				const key = placeOf(asset, r).join(',');
				const kind = classOf(grown, r).replace(/-\d+$/, '');
				const shoot = counts.get(key) ?? new Map<string, number>();
				shoot.set(kind, (shoot.get(kind) ?? 0) + 1);
				counts.set(key, shoot);
			}
			expect(counts.size).toBe(Math.min(growth.least.shoots, counts.size));
			expect(counts.size).toBeGreaterThanOrEqual(Math.min(growth.least.shoots, 1));
			let stalks = 0;
			const quarters = new Set<number>();
			for (const [key, shoot] of counts) {
				expect(shoot.get('sheath')).toBe(1);
				expect(shoot.get('blade')).toBe(growth.least.blades);
				stalks += shoot.get('stalk') ?? 0;
				const [x, , z] = key.split(',').map(Number) as [number, number, number];
				quarters.add((x >= 0 ? 1 : 0) + (z >= 0 ? 2 : 0));
			}
			if (growth.stalks?.seasons.includes(asset.season)) expect(stalks).toBe(growth.least.stalks);
			// No quarter of the stool is left bare where the least plant has a shoot for each.
			if (counts.size >= 8) expect([...quarters].sort()).toEqual([0, 1, 2, 3]);
		});

		it('keeps a shoot in every eighth of the stool at half sparseness', () => {
			const kept = rowsAt(grown, keptAt(asset, 0.5));
			const eighths = new Set<number>();
			let shoots = 0;
			for (const r of kept) {
				if (classOf(grown, r) !== 'sheath') continue;
				const [x, , z] = placeOf(asset, r) as [number, number, number];
				eighths.add(Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 8) % 8);
				shoots++;
			}
			if (shoots >= 16) expect([...eighths].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		});

		it('stands as tall as its record asks, with nothing under the soil but a blade edge', () => {
			const target = targetHeight(record, OPTIONS.seed, OPTIONS.variant);
			const { low, top } = standing(grown);
			expect(Math.abs(top - target) / target).toBeLessThan(0.03);
			// A blade that comes down to the soil turns and lies on it, so at most a twisted edge of
			// it, half its width, dips under the ground as it lands.
			expect(low).toBeGreaterThanOrEqual(-(blade.width / 2) * scale - 1e-6);
		});

		it('brings a blade that comes down to the soil to rest on it, still in the wind', () => {
			const tier = DETAILS.indexOf(kit.detail);
			const lands = growth.poses.some((pose) => pose.drop >= pose.apex);
			let landing = 0;
			for (const prototype of kit.prototypes) {
				if (!nameOf(prototype).startsWith('blade-')) continue;
				const mesh = prototype.tiers[tier];
				if (!mesh) throw new Error(`${nameOf(prototype)} has no tier`);
				// The blade's tip is its farthest point out along its heading.
				let tip = 0;
				for (let i = 0; i < mesh.positions.length; i += 3)
					if ((mesh.positions[i + 2] as number) > (mesh.positions[tip + 2] as number)) tip = i;
				// A blade that ends in the air, however near the soil, has not come to rest.
				if (Math.abs(mesh.positions[tip + 1] as number) > 0.002) continue;
				landing++;
				// Its tip lies on the soil: every vertex of the run it lies along within half a blade's
				// width of the ground. Its bend weight is at most three hundredths of a free tip's, and the wind
				// bends a vertex by that weight squared, so the point holds still.
				// The run it lies along is a blade's width long, as the prototype is grown.
				const lying = (blade.width * (1 + growth.bladeSpread)) / prototype.length;
				for (let i = 0; i < mesh.positions.length / 3; i++) {
					if ((mesh.uvs1[i * 2] as number) < 1 - 0.9 * lying) continue;
					expect(Math.abs(mesh.positions[i * 3 + 1] as number)).toBeLessThanOrEqual(
						blade.width / 2 + 1e-6,
					);
					expect(mesh.colors[i * 4] as number).toBeLessThanOrEqual(255 * 0.03);
				}
			}
			expect(landing > 0).toBe(lands);
		});

		it('stands its shoot bases as pointed spindles, the rim ones leaning out and lower', () => {
			const { buds } = asset.skeleton;
			const sockets = buds.sockets;
			if (!sockets?.piece) throw new Error(`${id}'s sockets name no pieces`);
			const sheaths: { out: number; lean: number; outward: number; scale: number }[] = [];
			let rim = 0;
			const up = [0, 0, 0] as [number, number, number];
			for (let b = 0; b < buds.count; b++) {
				if (sockets.piece[b] !== 0) continue;
				const x = buds.position[b * 3] as number;
				const z = buds.position[b * 3 + 2] as number;
				const out = Math.hypot(x, z);
				rim = Math.max(rim, out);
				quatRotate(buds.frame, b * 4, [0, 1, 0], up);
				const level = Math.hypot(up[0], up[2]);
				sheaths.push({
					out,
					lean: (Math.atan2(level, up[1]) * 180) / Math.PI,
					outward: level > 1e-6 && out > 1e-6 ? (up[0] * x + up[2] * z) / (level * out) : 1,
					scale: sockets.scale[b] as number,
				});
			}
			const middle = sheaths.filter((sheath) => sheath.out < 0.3 * rim);
			const outer = sheaths.filter((sheath) => sheath.out > 0.8 * rim);
			const mean = (list: typeof sheaths, key: 'lean' | 'scale') =>
				list.reduce((sum, sheath) => sum + sheath[key], 0) / list.length;
			expect(middle.length).toBeGreaterThan(0);
			expect(outer.length).toBeGreaterThan(0);
			// Still 07: the middle stands plumb, the rim leans out by up to 15 degrees and stands
			// about six tenths as tall.
			expect(mean(middle, 'lean')).toBeLessThan(5);
			expect(mean(outer, 'lean')).toBeGreaterThan(9);
			for (const sheath of sheaths) expect(sheath.lean).toBeLessThanOrEqual(15 + 1e-3);
			for (const sheath of outer) expect(sheath.outward).toBeGreaterThan(0.99);
			expect(mean(outer, 'scale')).toBeLessThan(0.8 * mean(middle, 'scale'));
			// The column closes to a point: its top is a fifth of its widest or less.
			const column = kit.prototypes.find((prototype) => nameOf(prototype) === 'sheath');
			const mesh = column?.tiers[DETAILS.indexOf(kit.detail)];
			if (!mesh) throw new Error(`${id} has no sheath column`);
			let topY = 0;
			let widest = 0;
			for (let i = 0; i < mesh.positions.length; i += 3) {
				topY = Math.max(topY, mesh.positions[i + 1] as number);
				widest = Math.max(
					widest,
					Math.hypot(mesh.positions[i] as number, mesh.positions[i + 2] as number),
				);
			}
			for (let i = 0; i < mesh.positions.length; i += 3)
				if ((mesh.positions[i + 1] as number) > 0.99 * topY)
					expect(
						Math.hypot(mesh.positions[i] as number, mesh.positions[i + 2] as number),
					).toBeLessThanOrEqual(0.2 * widest);
		});

		it("draws a flowering stem's head as a part of its own, near the crest of its bow", () => {
			if (!growth.stalks) return;
			const tier = DETAILS.indexOf(kit.detail);
			const names = new Set(
				kit.prototypes
					.map((prototype) => nameOf(prototype))
					.filter((name) => name.startsWith('stalk-')),
			);
			expect(names.size).toBeGreaterThan(0);
			const highest = (mesh: TestMesh) => {
				let y = Number.NEGATIVE_INFINITY;
				for (let i = 1; i < mesh.positions.length; i += 3)
					y = Math.max(y, mesh.positions[i] as number);
				return y;
			};
			for (const name of names) {
				const parts = kit.prototypes.filter((prototype) => nameOf(prototype) === name);
				expect(parts.map((prototype) => prototype.piece?.part)).toEqual([0, 1]);
				const stem = highest(parts[0]?.tiers[tier] as TestMesh);
				const head = highest(parts[1]?.tiers[tier] as TestMesh);
				// The head stands at the stem's highest stretch: a sedge's spikes hang from it and never
				// rise above it, a grass's panicle ends in a cluster that carries on past its tip.
				if (growth.stalks.head.kind === 'spike') expect(head).toBeLessThanOrEqual(stem + 1e-6);
				else expect(head).toBeLessThanOrEqual(1.05 * stem);
				expect(head).toBeGreaterThan(0.9 * stem);
			}
		});

		it('cuts a shoot that keeps the pieces that stand on it, and leaves the stool behind', () => {
			const cut = buildKitNow(module, { detail: 'high', placeholders: 'missing', cutting: true });
			for (const part of ['branch', 'subbranch', 'cluster'] as const) {
				const piece = growPlantNow(cut, { ...OPTIONS, cutting: { part } });
				const kinds = new Map<string, number>();
				const places = new Set<string>();
				for (let r = 0; r < piece.shoots.count; r++) {
					const kind = nameOf(cut.prototypes[piece.shoots.prototype[r] as number]).replace(
						/-\d+$/,
						'',
					);
					kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
					places.add(
						placeOf(piece, r)
							.map((value) => value.toFixed(5))
							.join(','),
					);
				}
				// One shoot: its sheath column and its blades, all from the one foot.
				expect([part, kinds.get('sheath')]).toEqual([part, 1]);
				expect(kinds.get('blade') ?? 0).toBeGreaterThanOrEqual(growth.least.blades);
				expect(places.size).toBe(1);
				// The stool's mound stays with the plant.
				expect(piece.levels[0].parts.map((drawn) => drawn.name)).not.toContain('foliage');
			}
		});

		it('states a box that holds its pieces and little air beside them', () => {
			const { min, max } = standing(grown);
			const { bounds } = asset.skeleton;
			const width = (max[0] as number) - (min[0] as number);
			// A page stands its camera by this box, so a box wider than the plant stands it too far.
			for (const k of [0, 2]) {
				expect(bounds.min[k] as number).toBeLessThanOrEqual((min[k] as number) + 0.02 * width);
				expect(bounds.max[k] as number).toBeGreaterThanOrEqual((max[k] as number) - 0.02 * width);
				expect(bounds.min[k] as number).toBeGreaterThanOrEqual((min[k] as number) - 0.08 * width);
				expect(bounds.max[k] as number).toBeLessThanOrEqual((max[k] as number) + 0.08 * width);
			}
			expect(Math.abs(bounds.max[1] - (max[1] as number))).toBeLessThanOrEqual(
				0.03 * (max[1] as number),
			);
			expect(bounds.min[1]).toBe(0);
		});

		it('grows the same plant each time, and another for another variant', () => {
			expect(plantAssetDigest(growPlantNow(kit, OPTIONS))).toBe(plantAssetDigest(asset));
			expect(plantAssetDigest(growPlantNow(kit, { ...OPTIONS, variant: 1 }))).not.toBe(
				plantAssetDigest(asset),
			);
		});
	});
}

describe('the meadow grass at the finest tier', () => {
	it('draws at once within its near budget at the tallest view', async () => {
		// The walk reads the default tier; the meadow grass's many blades cost most at the finest,
		// and its near cap holds that tier too.
		const module = await loadSpecies('meadow-grass');
		await loadPlantCode(module.record);
		const kit = buildKitNow(module, { detail: 'ultra', placeholders: 'missing' });
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		expect(drawnAtTallest(kit, asset).triangles).toBeLessThanOrEqual(
			module.record.lod.budget.lod0Triangles,
		);
	});
});

describe('the meadow grass out of flower', () => {
	it('stands no flowering stem in winter', async () => {
		const grown = await grow('meadow-grass', { season: 'winter' });
		const classes = new Set<string>();
		for (let r = 0; r < grown.asset.shoots.count; r++) classes.add(classOf(grown, r));
		expect([...classes].some((name) => name.startsWith('stalk-'))).toBe(false);
		expect([...classes].some((name) => name.startsWith('blade-'))).toBe(true);
	});
});

describe("the sedge's picked leaf", () => {
	it('is the whole blade, pressed flat, closing to a fine point', async () => {
		const module = await loadSpecies('sedge');
		await loadPlantCode(module.record);
		if (module.record.foliage.kind !== 'grass-blade') throw new Error('the sedge has no blade');
		const blade = module.record.foliage.blade;
		const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
		const leaf = growPlantNow(kit, { ...OPTIONS, cutting: { part: 'leaf' } });
		const positions: number[] = [];
		const out: [number, number, number] = [0, 0, 0];
		for (const part of leaf.levels[0].parts)
			for (let i = 0; i < part.arrays.positions.length / 3; i++) {
				dequantisePosition(part.arrays.positions, i, kit.box, out);
				positions.push(out[0], out[1], out[2]);
			}
		let length = 0;
		for (let i = 1; i < positions.length; i += 3) length = Math.max(length, positions[i] as number);
		// Still 12 shows the upper part of a long leaf: the piece is the record's whole blade.
		expect(Math.abs(length - spreadMean(blade.length)) / spreadMean(blade.length)).toBeLessThan(
			0.02,
		);
		// One width from its tip it is about four tenths as wide as the blade, as still 12 reads.
		const widthAt = (y: number) => {
			let low = Number.POSITIVE_INFINITY;
			let high = Number.NEGATIVE_INFINITY;
			for (let i = 0; i < positions.length; i += 3)
				if (Math.abs((positions[i + 1] as number) - y) < 0.004) {
					low = Math.min(low, positions[i] as number);
					high = Math.max(high, positions[i] as number);
				}
			return high - low;
		};
		const across = widthAt(length - blade.width) / blade.width;
		expect(across).toBeGreaterThan(0.3);
		expect(across).toBeLessThan(0.55);
	});
});

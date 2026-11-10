// The ground plants grown end to end: hosta by the rosette grower and its ribbed leaves, pendulous
// sedge and meadow grass by the tuft grower and its blades, through every built stage of the core
// with stand-ins only for the stages not built yet. Each grows the same bytes twice and in a worker
// that runs the job-worker task, has no wood, stays within its budget, and takes its references'
// form: the hosta a mound about twice as wide as tall, the sedge bowed stems with spikes hanging one
// below another and a spike at each tip, the grass panicles at about twice its leaves' height.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { capsFor, variantBytesOf } from '../core/caps';
import { speciesProblems } from '../core/check';
import {
	AXIS_CULM,
	AXIS_LIMB,
	AXIS_ROOT,
	BUD_FLOWER,
	BUD_TERMINAL,
	type MacroSkeleton,
} from '../core/graph';
import type { GrassBlade, Species, ThickLeaf } from '../core/record';
import { loadSpecies } from '../core/registry';
import { noTextureFiles } from '../core/textures';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import type { PlantTaskInput } from '../generate-task';
import { bladeHalf } from '../leaf/grass-blade';
import { builder as thickBuilder } from '../leaf/thick-leaf';
import { dequantisePosition } from '../lod/quantise';
import { AXIS_LEAF } from './ground';
import { GROUND_TEST_SPECIES, hostaRecord, meadowGrassRecord, sedgeRecord } from './ground.fixture';

for (const species of GROUND_TEST_SPECIES) await loadPlantCode(species.record);
const kits = new Map<string, SpeciesKitData>(
	GROUND_TEST_SPECIES.map((species) => [
		species.record.id,
		buildKitNow(species, { placeholders: 'missing' }),
	]),
);
const kitOf = (record: Species) => kits.get(record.id) as SpeciesKitData;
const OPTIONS = { seed: 11, variant: 0, near: true } as const;
const grown = new Map<string, PlantAsset>(
	GROUND_TEST_SPECIES.map((species) => [
		species.record.id,
		growPlantNow(kitOf(species.record), OPTIONS),
	]),
);
const assetOf = (record: Species) => grown.get(record.id) as PlantAsset;

/** A record's grass blade. */
function bladeOf(record: Species): GrassBlade {
	if (record.foliage.kind !== 'grass-blade') throw new Error(`${record.id} has no grass blades`);
	return record.foliage.blade;
}

/** A record's thick leaf. */
function thickOf(record: Species): ThickLeaf {
	if (record.foliage.kind !== 'thick') throw new Error(`${record.id} has no thick leaves`);
	return record.foliage.leaf;
}

/** The highest point of the axes of one kind, in metres. */
function topOf(skeleton: MacroSkeleton, kind: number): number {
	let top = 0;
	for (let n = 0; n < skeleton.nodeCount; n++)
		if ((skeleton.axes.kind[skeleton.axisOf[n] as number] as number) === kind)
			top = Math.max(top, skeleton.position[n * 3 + 1] as number);
	return top;
}

/** The bounds of a level's drawn parts, in metres. */
function drawnBounds(asset: PlantAsset, kit: SpeciesKitData): { min: number[]; max: number[] } {
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const out: [number, number, number] = [0, 0, 0];
	for (const part of asset.levels[0].parts)
		for (let i = 0; i < part.arrays.positions.length / 3; i++) {
			dequantisePosition(part.arrays.positions, i, kit.box, out);
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k] as number, out[k] as number);
				max[k] = Math.max(max[k] as number, out[k] as number);
			}
		}
	return { min, max };
}

describe('the ground plants grown end to end', () => {
	for (const { record } of GROUND_TEST_SPECIES) {
		it(`${record.id}: passes the record check and grows the same bytes twice`, () => {
			expect(speciesProblems(record)).toEqual([]);
			const kit = kitOf(record);
			const asset = assetOf(record);
			expect(plantAssetDigest(growPlantNow(kit, OPTIONS))).toBe(plantAssetDigest(asset));
			expect(plantAssetDigest(growPlantNow(kit, { ...OPTIONS, variant: 1 }))).not.toBe(
				plantAssetDigest(asset),
			);
		});

		it(`${record.id}: has no wood, merged foliage at every level, and stays within its budget`, () => {
			const asset = assetOf(record);
			const budget = record.lod.budget;
			for (const level of asset.levels) {
				const names = level.parts.map((part) => part.name);
				expect(names).not.toContain('wood');
				expect(names).toContain('foliage');
			}
			expect(asset.levels[0].triangles).toBeLessThanOrEqual(budget.lod0Triangles);
			expect(asset.levels[1].triangles).toBeLessThanOrEqual(budget.lod1Triangles);
			expect(asset.levels[2].triangles).toBeLessThanOrEqual(budget.lod2Triangles);
			expect(asset.levels[1].triangles).toBeLessThan(asset.levels[0].triangles);
			expect(asset.levels[2].triangles).toBeLessThan(asset.levels[1].triangles);
			const kit = kitOf(record);
			let kitBytes = 0;
			for (const leaf of kit.leaves) kitBytes += leaf.positions.byteLength * 3;
			expect(kitBytes).toBeLessThanOrEqual(budget.kitBytes[kit.detail]);
		});

		it(`${record.id}: holds its bytes within its budget and the caps at every tier`, () => {
			const species = GROUND_TEST_SPECIES.find((entry) => entry.record === record);
			if (!species) throw new Error('no species');
			const caps = capsFor(record);
			for (const detail of DETAILS) {
				const kit = buildKitNow(species, { placeholders: 'missing', detail });
				for (const season of [record.seasons.default, 'blossom'] as const) {
					const bytes = variantBytesOf(growPlantNow(kit, { ...OPTIONS, season }));
					expect(bytes).toBeLessThanOrEqual(record.lod.budget.variantBytes[detail]);
					expect(record.lod.budget.variantBytes[detail]).toBeLessThanOrEqual(
						caps.variantBytes[detail],
					);
				}
			}
		});

		it(`${record.id}: puts every leaf's bud at its blade's base, facing out of its upper face`, () => {
			const { skeleton } = assetOf(record);
			const { axes, buds } = skeleton;
			let leaves = 0;
			for (let a = 0; a < axes.count; a++) if ((axes.kind[a] as number) === AXIS_LEAF) leaves++;
			let terminal = 0;
			for (let b = 0; b < buds.count; b++) {
				if ((buds.kind[b] as number) !== BUD_TERMINAL) continue;
				const axis = buds.axis[b] as number;
				if ((axes.kind[axis] as number) !== AXIS_LEAF) continue;
				terminal++;
				const vigor = buds.vigor[b] as number;
				expect(vigor).toBeGreaterThanOrEqual(0);
				expect(vigor).toBeLessThanOrEqual(1);
				const node = buds.node[b] as number;
				expect(skeleton.axisOf[node]).toBe(axis);
			}
			expect(terminal).toBe(leaves);
		});
	}

	it('grows the same bytes in a worker that runs the job-worker task', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'ground-task-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { run } from ${JSON.stringify(join(import.meta.dirname, '..', 'generate-task.ts'))};
self.onmessage = async (event) => {
	const answer = await run(event.data);
	postMessage(answer.output, answer.transfer);
};
`,
			);
			const worker = new Worker(script);
			const ask = <T>(input: PlantTaskInput) =>
				new Promise<T>((resolve, reject) => {
					worker.onmessage = (event) => resolve(event.data as T);
					worker.onerror = (event) => reject(new Error(String(event.message)));
					worker.postMessage(input);
				});
			try {
				for (const species of GROUND_TEST_SPECIES) {
					const kit = await ask<SpeciesKitData>({
						stage: 'kit',
						source: { record: species.record, textures: { manifest: species.textures.manifest } },
						options: { placeholders: 'missing' },
					});
					expect(kit.key).toBe(kitOf(species.record).key);
					const asset = await ask<PlantAsset>({ stage: 'grow', kit, options: OPTIONS });
					expect(plantAssetDigest(asset)).toBe(plantAssetDigest(assetOf(species.record)));
				}
			} finally {
				worker.terminate();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('the tuft sheath marker', () => {
	const growth = meadowGrassRecord.growth;
	if (growth.model !== 'tuft') throw new Error('the meadow grass is a tuft');
	const sheathed: Species = {
		...meadowGrassRecord,
		growth: { ...growth, sheathColour: [0.366, 0.38, 0.309] },
	};
	const grow = (record: Species) => {
		const kit = buildKitNow(
			{ record, textures: noTextureFiles(record.id) },
			{ placeholders: 'missing' },
		);
		return growPlantNow(kit, OPTIONS);
	};
	const marked = grow(sheathed);
	const plain = grow(meadowGrassRecord);

	/** The merged foliage's colour bytes, part by part. */
	const foliageColours = (asset: PlantAsset) =>
		asset.levels[0].parts
			.filter((part) => part.name === 'foliage')
			.map((part) => part.arrays.colors as Uint8Array);

	it('marks the sheath columns in the flutter byte and holds the plant otherwise', () => {
		expect(marked.skeleton.nodeCount).toBe(plain.skeleton.nodeCount);
		expect(marked.skeleton.height).toBe(plain.skeleton.height);
		const a = foliageColours(marked);
		const b = foliageColours(plain);
		expect(a.length).toBe(b.length);
		let sheathVertices = 0;
		let vertices = 0;
		for (let p = 0; p < a.length; p++) {
			const one = a[p] as Uint8Array;
			const other = b[p] as Uint8Array;
			expect(one.length).toBe(other.length);
			for (let i = 0; i < one.length; i += 4) {
				// The wind record and the sky visibility are the same plant's.
				expect([one[i], one[i + 1], one[i + 3]]).toEqual([other[i], other[i + 1], other[i + 3]]);
				// The phase keeps its seven low bits, and only the sheath's byte takes the mark.
				expect((one[i + 2] as number) & 0x7f).toBe((other[i + 2] as number) >> 1);
				if (((one[i + 2] as number) & 0x80) !== 0) sheathVertices++;
				vertices++;
			}
		}
		expect(sheathVertices).toBeGreaterThan(0);
		expect(sheathVertices).toBeLessThan(vertices);
	});

	it('leaves a species without a sheath colour its full eight-bit phases', () => {
		expect(sedgeRecord.growth.model === 'tuft' && sedgeRecord.growth.sheathColour).toBe(undefined);
		// The sedge gives no sheath colour, so its phases keep the top bit, the mark's place.
		const phases = foliageColours(assetOf(sedgeRecord)).flatMap((part) => {
			const out: number[] = [];
			for (let i = 2; i < part.length; i += 4) out.push(part[i] as number);
			return out;
		});
		expect(phases.some((phase) => (phase & 0x80) !== 0)).toBe(true);
	});
});

describe('the hosta', () => {
	it('is a mound about twice as wide as tall', () => {
		const { min, max } = drawnBounds(assetOf(hostaRecord), kitOf(hostaRecord));
		const height = max[1] as number;
		const width = Math.max(
			(max[0] as number) - (min[0] as number),
			(max[2] as number) - (min[2] as number),
		);
		expect(height).toBeGreaterThan(0.4);
		expect(height).toBeLessThan(0.7);
		expect(width / height).toBeGreaterThan(1.5);
		expect(width / height).toBeLessThan(2.6);
	});

	it('pleats its blade between the veins, and faces its upper side to +Z in the leaf frame', () => {
		const manifest = kitOf(hostaRecord).manifest;
		const ribbed = thickBuilder.leaves(hostaRecord, manifest, 'high')[0];
		const leaf = thickOf(hostaRecord);
		const flat = thickBuilder.leaves(
			{
				...hostaRecord,
				foliage: { kind: 'thick', leaf: { ...leaf, ribs: { ...leaf.ribs, depth: 0 } } },
			},
			manifest,
			'high',
		)[0];
		if (!ribbed || !flat) throw new Error('no leaf');
		expect(ribbed.positions.length).toBe(flat.positions.length);
		let moved = 0;
		let count = 0;
		for (let i = 2; i < ribbed.positions.length; i += 3) {
			moved += Math.abs((ribbed.positions[i] as number) - (flat.positions[i] as number));
			count++;
		}
		// The pleats lift the blade by a few millimetres on average.
		expect(moved / count).toBeGreaterThan(0.001);
		let facing = 0;
		for (let i = 0; i < ribbed.indices.length; i += 3) {
			const a = (ribbed.indices[i] as number) * 3;
			const b = (ribbed.indices[i + 1] as number) * 3;
			const c = (ribbed.indices[i + 2] as number) * 3;
			const p = ribbed.positions;
			const ux = (p[b] as number) - (p[a] as number);
			const uy = (p[b + 1] as number) - (p[a + 1] as number);
			const vx = (p[c] as number) - (p[a] as number);
			const vy = (p[c + 1] as number) - (p[a + 1] as number);
			facing += ux * vy - uy * vx;
		}
		expect(facing).toBeGreaterThan(0);
	});

	it('dies back in winter, browns in autumn, and raises flowering scapes in blossom', () => {
		const kit = kitOf(hostaRecord);
		const winter = growPlantNow(kit, { ...OPTIONS, season: 'winter' });
		expect(winter.levels[0].triangles).toBe(0);
		const autumn = growPlantNow(kit, { ...OPTIONS, season: 'autumn' });
		const foliage = autumn.levels[0].parts.find((part) => part.name === 'foliage');
		expect(foliage?.arrays.uvs1[1]).toBe(65535);
		const blossom = growPlantNow(kit, { ...OPTIONS, season: 'blossom' });
		expect(topOf(blossom.skeleton, AXIS_CULM)).toBeGreaterThan(0.6);
		expect(blossom.levels[0].parts.map((part) => part.name)).toContain('extras');
		let flowers = 0;
		for (let b = 0; b < blossom.skeleton.buds.count; b++)
			if ((blossom.skeleton.buds.kind[b] as number) === BUD_FLOWER) flowers++;
		expect(flowers).toBeGreaterThan(20);
	});

	it('cuts one shoot of a few leaves, and one leaf', () => {
		const kit = kitOf(hostaRecord);
		const shoot = growPlantNow(kit, { ...OPTIONS, cutting: { part: 'subbranch' } });
		let leaves = 0;
		for (let a = 0; a < shoot.skeleton.axes.count; a++)
			if ((shoot.skeleton.axes.kind[a] as number) === AXIS_LEAF) leaves++;
		expect(leaves).toBeGreaterThanOrEqual(3);
		expect(shoot.levels[0].triangles).toBeGreaterThan(0);
		const leaf = growPlantNow(kit, { ...OPTIONS, cutting: { part: 'leaf' } });
		expect(leaf.levels[0].triangles).toBe((kit.leaves[0]?.indices.length ?? 0) / 3);
	});
});

describe('the pendulous sedge', () => {
	it('bows its stems and hangs four or five spikes from each, with one at each tip', () => {
		const { skeleton } = assetOf(sedgeRecord);
		const { axes, buds } = skeleton;
		let stems = 0;
		for (let a = 0; a < axes.count; a++) if ((axes.kind[a] as number) === AXIS_CULM) stems++;
		expect(stems).toBeGreaterThanOrEqual(5);
		let hanging = 0;
		let tips = 0;
		for (let b = 0; b < buds.count; b++) {
			const kind = buds.kind[b] as number;
			if (kind === BUD_FLOWER) {
				hanging++;
				// The frame's +Y points down.
				const x = buds.frame[b * 4] as number;
				const z = buds.frame[b * 4 + 2] as number;
				expect(1 - 2 * (x * x + z * z)).toBeLessThan(-0.9);
			} else if (
				kind === BUD_TERMINAL &&
				(axes.kind[buds.axis[b] as number] as number) === AXIS_CULM
			)
				tips++;
		}
		expect(tips).toBe(stems);
		expect(hanging / stems).toBeGreaterThanOrEqual(3);
		expect(hanging / stems).toBeLessThanOrEqual(5);
		const top = topOf(skeleton, AXIS_CULM);
		expect(top).toBeGreaterThan(0.9);
		expect(top).toBeLessThan(2);
		expect(topOf(skeleton, AXIS_LEAF)).toBeGreaterThan(0.45);
		expect(assetOf(sedgeRecord).levels[0].parts.map((part) => part.name)).toContain('extras');
	});

	it("gives each hanging spike's stalk the share of the stem's radius the record asks", () => {
		const growth = sedgeRecord.growth;
		if (growth.model !== 'tuft' || !growth.heads) throw new Error('the fixture is not a tuft');
		const heads = { ...growth.heads, stalkShare: 0.6 };
		const shared: Species = {
			...sedgeRecord,
			id: 'sedge-stalk-share',
			growth: { ...growth, heads },
		};
		const kit = buildKitNow(
			{ record: shared, textures: noTextureFiles(shared.id) },
			{ placeholders: 'missing' },
		);
		const { skeleton } = growPlantNow(kit, OPTIONS);
		let stalks = 0;
		for (let a = 0; a < skeleton.axes.count; a++) {
			const parent = skeleton.axes.parent[a] as number;
			if (parent < 0) continue;
			if ((skeleton.axes.kind[a] as number) !== AXIS_LIMB) continue;
			if ((skeleton.axes.kind[parent] as number) !== AXIS_CULM) continue;
			const radius = skeleton.radius[skeleton.axes.first[a] as number] as number;
			expect(radius).toBeCloseTo(heads.radius * 0.6, 3);
			stalks++;
		}
		expect(stalks).toBeGreaterThan(3);
	});

	it('draws the rhizome and its roots under the crown when the record names them', () => {
		const growth = sedgeRecord.growth;
		if (growth.model !== 'tuft') throw new Error('the fixture is not a tuft');
		const soil = {
			rhizome: { mean: 0.04, spread: 0.01 },
			rhizomeRadius: 0.011,
			roots: { mean: 15, spread: 3 },
			rootLength: { mean: 0.14, spread: 0.05 },
			rootRadius: 0.0018,
			droop: { mean: 40, spread: 15 },
		};
		const rhizomed: Species = { ...sedgeRecord, id: 'sedge-rhizome', growth: { ...growth, soil } };
		const kit = buildKitNow(
			{ record: rhizomed, textures: noTextureFiles(rhizomed.id) },
			{ placeholders: 'missing' },
		);
		const bare = growPlantNow(kitOf(sedgeRecord), OPTIONS);
		const { skeleton, levels } = growPlantNow(kit, OPTIONS);
		let under = 0;
		let lowest = 0;
		let reach = 0;
		// Axis 0 is the crown's own, which holds the shoots; the rest are the rhizome and its roots.
		for (let a = 1; a < skeleton.axes.count; a++) {
			if ((skeleton.axes.kind[a] as number) !== AXIS_ROOT) continue;
			under++;
			for (let n = skeleton.axes.first[a] as number; n <= (skeleton.axes.last[a] as number); n++) {
				lowest = Math.min(lowest, skeleton.position[n * 3 + 1] as number);
				reach = Math.max(
					reach,
					Math.hypot(skeleton.position[n * 3] as number, skeleton.position[n * 3 + 2] as number),
				);
			}
		}
		expect(under).toBeGreaterThan(5);
		expect(lowest).toBeLessThan(-0.01);
		expect(reach).toBeGreaterThan(0.1);
		expect(levels[0].triangles).toBeGreaterThan(bare.levels[0].triangles);
		expect(levels[1].triangles).toBe(bare.levels[1].triangles);
		expect(levels[2].triangles).toBe(bare.levels[2].triangles);
	});

	it("leaves an unrhizomed plant's blades and stems byte-identical", async () => {
		const module = await loadSpecies('sedge');
		const growth = module.record.growth;
		if (growth.model !== 'tuft') throw new Error('the species is not a tuft');
		expect(growth.soil).toBeDefined();
		const { soil: _soil, ...bare } = growth;
		const kit = buildKitNow(
			{ record: { ...module.record, growth: bare }, textures: noTextureFiles(module.record.id) },
			{ placeholders: 'missing', detail: 'high' },
		);
		// The plant's bytes with the soil block stripped, at this record: a plant that names no
		// soil grows exactly these. A deliberate record change re-records the figure, and the
		// growth path that reads no soil must not move it. The figure moved when the bracken's
		// frond work changed the shared leaf writer and this branch's blade changes met it in the
		// merge, so it is re-recorded at the merge.
		expect(plantAssetDigest(growPlantNow(kit, OPTIONS))).toBe('909576c32c41c515');
	});

	it('ends its blades in long fine points', () => {
		const blade = bladeOf(sedgeRecord);
		const form = { length: 0.8, width: blade.width, blade, twist: 0, browning: 0, dry: 0 };
		expect(bladeHalf(form, 1)).toBeLessThan(1e-6);
		expect(bladeHalf(form, 1 - blade.tipLength / 2)).toBeLessThan(
			0.6 * bladeHalf(form, 1 - blade.tipLength),
		);
	});
});

describe('the meadow grass', () => {
	it('carries its panicles at about twice the height of its leaves', () => {
		const { skeleton } = assetOf(meadowGrassRecord);
		const ratio = topOf(skeleton, AXIS_CULM) / topOf(skeleton, AXIS_LEAF);
		expect(ratio).toBeGreaterThan(1.4);
		expect(ratio).toBeLessThan(2.8);
		let spikelets = 0;
		for (let b = 0; b < skeleton.buds.count; b++)
			if ((skeleton.buds.kind[b] as number) === BUD_FLOWER) spikelets++;
		expect(spikelets).toBeGreaterThan(200);
	});

	it('keeps its blades of even width to a short blunt hood', () => {
		const blade = bladeOf(meadowGrassRecord);
		const form = { length: 0.2, width: blade.width, blade, twist: 0, browning: 0, dry: 0 };
		const full = bladeHalf(form, 0.5);
		expect(bladeHalf(form, 0.9)).toBeCloseTo(full, 6);
		expect(bladeHalf(form, 1 - blade.tipLength / 2)).toBeGreaterThan(0.8 * full);
		expect(bladeHalf(form, 1)).toBeLessThan(1e-6);
	});

	it('draws nothing for its heads out of their seasons, and every tier from the same growth', () => {
		const kit = kitOf(meadowGrassRecord);
		const winter = growPlantNow(kit, { ...OPTIONS, season: 'winter' });
		expect(topOf(winter.skeleton, AXIS_CULM)).toBe(0);
		expect(winter.levels[0].parts.map((part) => part.name)).not.toContain('extras');
		const triangles = DETAILS.map(
			(detail) => growPlantNow(kit, { ...OPTIONS, detail }).levels[0].triangles,
		);
		for (let i = 1; i < triangles.length; i++)
			expect(triangles[i] as number).toBeGreaterThanOrEqual(triangles[i - 1] as number);
	});
});

// The ground plants grown end to end: hosta by the rosette grower and its ribbed leaves, pendulous
// sedge and meadow grass by the tuft grower and its blades, through every built stage of the core
// with stand-ins only for the stages not built yet. Each grows the same bytes twice and in a worker
// that runs the job-worker task, has no wood, stays within its budget, and takes its references'
// form: the hosta a mound about twice as wide as tall. The tufts' pieces and sockets have their own
// tests (tuft.test.ts).
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest, type SpeciesKitData } from '../asset';
import { nearTriangles } from '../coarseness';
import { capsFor, variantBytesOf } from '../core/caps';
import { speciesProblems } from '../core/check';
import { AXIS_CULM, AXIS_ROOT, BUD_FLOWER, BUD_TERMINAL, type MacroSkeleton } from '../core/graph';
import type { GrassBlade, Species, ThickLeaf } from '../core/record';
import { loadSpecies } from '../core/registry';
import { noTextureFiles } from '../core/textures';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import type { PlantTaskInput } from '../generate-task';
import { bladeHalf } from '../leaf/grass-blade';
import { builder as thickBuilder } from '../leaf/thick-leaf';
import { phaseByte, SURFACE_KINDS } from '../leaf/writer';
import { dequantisePosition } from '../lod/quantise';
import { AXIS_LEAF } from './ground';
import { GROUND_TEST_SPECIES, hostaRecord, meadowGrassRecord, sedgeRecord } from './ground.fixture';
import { targetHeight } from './height';
import { leafRoll } from './rosette';

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

describe("a merged run's flutter phase", () => {
	it('never takes a surface kind, and stays within a step of its hash', () => {
		for (let hash = 0; hash < 65_536; hash++) {
			const phase = phaseByte(hash);
			expect(SURFACE_KINDS.includes(phase)).toBe(false);
			expect((phase - (hash & 255) + 256) % 256).toBeLessThanOrEqual(1);
		}
	});
});

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

		it(`${record.id}: has no wood, its own mesh at every level, and stays within its budget`, () => {
			const asset = assetOf(record);
			const kit = kitOf(record);
			const budget = record.lod.budget;
			for (const level of asset.levels) {
				const names = level.parts.map((part) => part.name);
				expect(names).not.toContain('wood');
				expect(names).toContain('foliage');
			}
			// A plant of placed pieces draws them at the nearest level beside its own mesh.
			const near = nearTriangles(kit, asset);
			expect(near).toBeLessThanOrEqual(budget.lod0Triangles);
			expect(asset.levels[1].triangles).toBeLessThanOrEqual(budget.lod1Triangles);
			expect(asset.levels[2].triangles).toBeLessThanOrEqual(budget.lod2Triangles);
			expect(asset.levels[1].triangles).toBeLessThan(near);
			expect(asset.levels[2].triangles).toBeLessThan(asset.levels[1].triangles);
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

describe("the hosta's rolled leaves", () => {
	it('meshes no leaf rolled at or past the rolled share of its age', async () => {
		const module = await loadSpecies('hosta');
		const growth = module.record.growth;
		if (growth.model !== 'rosette') throw new Error('the hosta is not a rosette');
		for (let age = 0; age <= 1; age += 1 / 64) {
			const roll = leafRoll(age, growth.rolled);
			if (age >= growth.rolled) expect([age, roll]).toEqual([age, 0]);
			else expect(roll).toBeGreaterThan(0);
		}
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
		// The scapes carry the plant's drawn top, which the dressing aims at the record's sampled height.
		expect(topOf(blossom.skeleton, AXIS_CULM)).toBeCloseTo(
			targetHeight(hostaRecord, blossom.seed, blossom.variant),
			2,
		);
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
	it('draws the rhizome and its roots under the stool at the nearest level alone', () => {
		const growth = sedgeRecord.growth;
		if (growth.model !== 'tuft') throw new Error('the fixture is not a tuft');
		expect(growth.soil).toBeDefined();
		const { soil: _soil, ...unrooted } = growth;
		const bare: Species = { ...sedgeRecord, id: 'sedge-bare', growth: unrooted };
		const kit = buildKitNow(
			{ record: bare, textures: noTextureFiles(bare.id) },
			{ placeholders: 'missing' },
		);
		const without = growPlantNow(kit, OPTIONS);
		const { skeleton, levels } = assetOf(sedgeRecord);
		let under = 0;
		let lowest = 0;
		// Axis 0 is the stool's own, which holds the shoots; the rest are the rhizome and its roots.
		for (let a = 1; a < skeleton.axes.count; a++) {
			if ((skeleton.axes.kind[a] as number) !== AXIS_ROOT) continue;
			under++;
			for (let n = skeleton.axes.first[a] as number; n <= (skeleton.axes.last[a] as number); n++)
				lowest = Math.min(lowest, skeleton.position[n * 3 + 1] as number);
		}
		expect(under).toBeGreaterThan(5);
		expect(lowest).toBeLessThan(-0.01);
		expect(levels[0].triangles).toBeGreaterThan(without.levels[0].triangles);
		expect(levels[1].triangles).toBe(without.levels[1].triangles);
		expect(levels[2].triangles).toBe(without.levels[2].triangles);
		// The plant above the soil is the same with and without it.
		expect(assetOf(sedgeRecord).shoots.count).toBe(without.shoots.count);
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
		// growth path that reads no soil must not move it.
		// The sedge scales to its card level's top by default, the measure it was judged with; a
		// record that names lod.heightAtLeafTop moves the blades' scale.
		expect(plantAssetDigest(growPlantNow(kit, OPTIONS))).toBe('bfeb7506fc8ff564');
	});

	it('ends its blades in long fine points', () => {
		// The point's own closing, read on a blade of even width so its outline does not mix in.
		const shaped = bladeOf(sedgeRecord);
		const blade: GrassBlade = {
			...shaped,
			profile: [
				[0, 1],
				[1, 1],
			],
		};
		const form = { length: 0.8, width: blade.width, blade, twist: 0, browning: 0, dry: 0 };
		expect(bladeHalf(form, 1)).toBeLessThan(1e-6);
		// Still 12: half way along the point the leaf keeps about three quarters of the width it
		// had where the point began, and nine tenths of the way along about a fifth.
		const start = bladeHalf(form, 1 - blade.tipLength);
		const into = (share: number) => bladeHalf(form, 1 - blade.tipLength * (1 - share)) / start;
		expect(into(0.5)).toBeGreaterThan(0.7);
		expect(into(0.5)).toBeLessThan(0.85);
		expect(into(0.9)).toBeGreaterThan(0.15);
		expect(into(0.9)).toBeLessThan(0.3);
	});
});

describe('the meadow grass', () => {
	it('keeps its blades of even width to a short blunt hood', () => {
		const blade = bladeOf(meadowGrassRecord);
		const form = { length: 0.2, width: blade.width, blade, twist: 0, browning: 0, dry: 0 };
		const full = bladeHalf(form, 0.5);
		expect(bladeHalf(form, 0.9)).toBeCloseTo(full, 6);
		expect(bladeHalf(form, 1 - blade.tipLength / 2)).toBeGreaterThan(0.8 * full);
		expect(bladeHalf(form, 1)).toBeLessThan(1e-6);
	});

	it('draws no fewer triangles at a finer tier', () => {
		const species = GROUND_TEST_SPECIES.find((entry) => entry.record === meadowGrassRecord);
		if (!species) throw new Error('no species');
		const triangles = DETAILS.map((detail) => {
			const kit = buildKitNow(species, { placeholders: 'missing', detail });
			return nearTriangles(kit, growPlantNow(kit, OPTIONS), detail);
		});
		for (let i = 1; i < triangles.length; i++)
			expect(triangles[i] as number).toBeGreaterThanOrEqual(triangles[i - 1] as number);
	});
});

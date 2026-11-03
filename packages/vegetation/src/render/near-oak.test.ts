// The near pool's stages on the grown oak: its wind records, its level distances and its far bake,
// then the near task's WebAssembly module, driven through the task module the job workers run. The
// task's rows stay inside the near band and its tier bands, its triangles stay within the budget
// nearest first, the copies cap holds, each row's values name its own wind record, and its count of
// triangles is the TypeScript count of what one copy draws. The module comes from the build, so the
// task's checks wait for it where it is missing.
import { beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { hashBytes } from '../core/hash';
import { bakeFarNow, buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { levelDistances, levelStarts, REFERENCE_VIEW, switchDistance } from '../lod/levels';
import { VARIANT_RECORDS, WIND_RECORD_FLOATS } from '../wind/records';
import {
	bandTriangles,
	mostRows,
	nearArrays,
	nearScene,
	SPLIT_REACH,
	tierBands,
} from './near-arrays';
import { nearOak } from './near-oak.fixture';
import {
	type NearAnswer,
	type NearInput,
	nearLayout,
	PROTOTYPE_FLOATS,
	run,
	SUMMARY_FLOATS,
} from './near-task';

const WASM = fileURLToPath(new URL('../../dist/vegetation.wasm', import.meta.url));
const built = existsSync(WASM);
const module = built ? new WebAssembly.Module(readFileSync(WASM)) : undefined;

let kit: SpeciesKitData;
let asset: PlantAsset;
let split: number;

beforeAll(async () => {
	const oak = nearOak();
	await loadPlantCode(oak.record);
	kit = buildKitNow(oak, { detail: 'high' });
	asset = growPlantNow(kit, { seed: 11, variant: 1 });
	split = levelDistances(kit, asset.skeleton.height, REFERENCE_VIEW)[0];
}, 120_000);

describe("the oak's stages", () => {
	it('give every axis its own wind record, inside the variant share of 16-bit ids', () => {
		expect(asset.wind.count).toBe(asset.skeleton.axes.count);
		expect(asset.wind.base).toBe(VARIANT_RECORDS);
		expect(asset.wind.base + asset.wind.count).toBeLessThan(65_000);
		const ids = new Set(asset.skeleton.axes.record.subarray(0, asset.skeleton.axes.count));
		expect(ids.size).toBe(asset.skeleton.axes.count);
		for (let r = 0; r < asset.shoots.count; r++)
			expect(asset.shoots.record[r] as number).toBeLessThan(asset.wind.count);
		for (let r = 0; r < asset.wind.count; r++) {
			const parent = asset.wind.records[r * WIND_RECORD_FLOATS + 3] as number;
			expect(parent === -1 || (parent >= asset.wind.base && parent < asset.wind.base + r)).toBe(
				true,
			);
		}
	});

	it('switch where a size covers its pixels, each level past the one before', () => {
		expect(switchDistance(0.4, 24, { height: 1080, fov: 60 })).toBeCloseTo(15.59, 2);
		const [first, second, impostor] = asset.levels.map((l) => l.from).slice(1) as number[];
		expect(asset.levels[1].from).toBeCloseTo(split, 6);
		expect(second as number).toBeGreaterThan(first as number);
		expect(asset.impostor.from).toBeGreaterThan(second as number);
		void impostor;
		const narrow = levelDistances(kit, asset.skeleton.height, { height: 540, fov: 60 });
		expect(narrow[0]).toBeCloseTo(split / 2, 6);
		expect(levelStarts).toBeDefined();
	});

	it('bake the far cards from the first card level, the same bytes twice', () => {
		const far = bakeFarNow(kit, asset);
		expect(far.views).toBe(asset.impostor.views);
		expect(far.texels).toBe(asset.impostor.texels);
		const side = far.views * far.texels;
		expect(far.color.length).toBe(side * side * 4);
		let covered = 0;
		for (let t = 0; t < side * side; t++) if ((far.color[t * 4 + 3] as number) > 127) covered++;
		expect(covered / (side * side)).toBeGreaterThan(0.1);
		expect(far.size[1]).toBeGreaterThan(asset.skeleton.height * 0.9);
		expect(hashBytes(bakeFarNow(kit, asset).color)).toBe(hashBytes(far.color));
	}, 60_000);
});

/** A scene of `count` copies of the oak along +X, every `spacing` metres, each turned. */
function compose(
	eye: readonly [number, number, number],
	count: number,
	spacing: number,
	copies: number,
	triangles: number,
) {
	const placed = {
		count,
		position: new Float32Array(count * 3),
		turn: new Float32Array(count),
		scale: new Float32Array(count).fill(1),
		variant: new Uint8Array(count),
	};
	for (let c = 0; c < count; c++) {
		placed.position[c * 3] = c * spacing;
		placed.turn[c] = c * 0.7;
	}
	const bands = tierBands('high', split);
	const most = mostRows(kit.prototypes.length, [asset]);
	const capacities: number[] = [];
	for (let p = 0; p < kit.prototypes.length; p++)
		for (const band of bands) {
			const tris = (kit.prototypes[p]?.tiers[band.tier]?.indices.length ?? 0) / 3;
			capacities.push(
				(most[p] as number) === 0
					? 0
					: Math.min(copies * (most[p] as number), Math.ceil(triangles / tris) + 1),
			);
		}
	const cardRows = Uint32Array.from({ length: count }, (_, c) => c);
	const scene = nearScene(
		[
			{
				table: 0,
				firstSlot: 0,
				split,
				bands,
				arrays: nearArrays(kit, [asset], placed, cardRows),
				copies: count,
				variants: 1,
				prototypes: kit.prototypes.length,
				capacities,
				cardRows: count,
			},
		],
		1,
	);
	const layout = nearLayout(scene);
	const out = new Uint8Array(new SharedArrayBuffer(layout.bytes));
	const input: NearInput = {
		op: 'compose',
		id: 1,
		version: Math.random(),
		scene,
		eyeX: eye[0],
		eyeY: eye[1],
		eyeZ: eye[2],
		copies,
		triangles,
		margin: 0,
		out,
	};
	const answer = run(input, () => module as WebAssembly.Module).output as NearAnswer;
	const buffer = out.buffer;
	const summary = new Float64Array(buffer, layout.summary, SUMMARY_FLOATS);
	return {
		answer,
		bands,
		scene,
		out,
		summary,
		counts: new Uint32Array(buffer, layout.counts, scene.batches.length / 2),
		positions: new Float32Array(buffer, layout.positions, scene.rows * 3),
		scales: new Float32Array(buffer, layout.scales, scene.rows * 3),
		values: new Float32Array(buffer, layout.values, scene.rows * 4),
		cards: new Float32Array(buffer, layout.cardValues, count * 4),
		tables: new Float32Array(buffer, layout.tables, 128),
	};
}

describe.if(built)('the near task on the oak', () => {
	const eye = [3, 1.7, 2] as const;

	it("draws one copy's near band as the TypeScript count does, inside the split", () => {
		const result = compose(eye, 1, 0, 1, 1e12);
		const expected = bandTriangles(kit, asset, eye, result.bands);
		expect(result.summary[0]).toBe(expected.triangles);
		expect(result.summary[1]).toBe(1);
		expect(result.summary[2]).toBe(-1);
		expect(result.cards[0]).toBeCloseTo(split, 4);
		// Every row it wrote stands inside the last band's end.
		const batches = result.scene.batches;
		for (let b = 0; b < batches.length / 2; b++)
			for (let r = 0; r < (result.counts[b] as number); r++) {
				const at = ((batches[b * 2] as number) + r) * 3;
				const dx = (result.positions[at] as number) - eye[0];
				const dy = (result.positions[at + 1] as number) - eye[1];
				const dz = (result.positions[at + 2] as number) - eye[2];
				const p = Math.floor(b / result.bands.length);
				const radius = (kit.prototypes[p]?.radius ?? 0) * (result.scales[at] as number);
				expect(Math.hypot(dx, dy, dz) - radius).toBeLessThanOrEqual(split * SPLIT_REACH + 1e-3);
			}
	});

	it('holds the triangle budget nearest first, and cuts the cards to the rows it keeps', () => {
		const budget = 1_000_000;
		const result = compose(eye, 1, 0, 1, budget);
		expect(result.summary[0]).toBeLessThanOrEqual(budget);
		expect(result.summary[0]).toBeGreaterThan(budget * 0.8);
		const cut = result.summary[2] as number;
		expect(cut).toBeGreaterThan(0);
		expect(cut).toBeLessThan(split);
		expect(result.cards[0]).toBeLessThanOrEqual(cut / 0.96 + 1e-4);
	});

	it('keeps to the copies cap, nearest first, and leaves the other copies all cards', () => {
		const result = compose([0, 1.7, 0], 6, 10, 3, 1e12);
		expect(result.summary[1]).toBe(3);
		const splits = Array.from({ length: 6 }, (_, c) => result.cards[c * 4] as number);
		expect(splits.slice(0, 3).every((s) => s > 0)).toBe(true);
		expect(splits.slice(3).every((s) => s === 0)).toBe(true);
		// The slots hold the chosen copies' places, nearest first.
		expect(result.tables[0]).toBe(0);
		expect(result.tables[8]).toBe(10);
		expect(result.tables[16]).toBe(20);
	});

	it("gives each row its own wind record and its copy's slot, in values a half float keeps", () => {
		const result = compose(eye, 1, 0, 1, 1e12);
		const batches = result.scene.batches;
		let seen = 0;
		for (let b = 0; b < batches.length / 2; b++)
			for (let r = 0; r < (result.counts[b] as number); r++) {
				const at = ((batches[b * 2] as number) + r) * 4;
				const v = Array.from(result.values.subarray(at, at + 4));
				const record = (v[0] as number) * 32 + Math.floor(v[1] as number);
				expect(record).toBeGreaterThanOrEqual(asset.wind.base);
				expect(record).toBeLessThan(asset.wind.base + asset.wind.count);
				expect((v[3] as number) % 16).toBe(0);
				for (const value of v) expect(value).toBeLessThan(2048);
				seen++;
			}
		expect(seen).toBeGreaterThan(1000);
	});

	it('writes the same bytes twice', () => {
		const a = compose(eye, 4, 12, 4, 3_000_000);
		const b = compose(eye, 4, 12, 4, 3_000_000);
		expect(hashBytes(new Uint8Array(b.out))).toBe(hashBytes(new Uint8Array(a.out)));
		expect(PROTOTYPE_FLOATS).toBe(5);
	});
});

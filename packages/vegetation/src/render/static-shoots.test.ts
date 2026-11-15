// The bands of distance that a fixed plant's levels draw in: each level hands over to the next
// with the next at full coverage before its own edge thins, so no pixel drops out of both.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { SHOOT_REACH, switchScale } from '../lod/drawn';
import { firstCardStart } from '../lod/levels';
import { dequantisePosition } from '../lod/quantise';
import { EDGE_BAND } from './hand-over';
import { plantBoundingRadius } from './material';
import { levelBands, placeStaticPlants } from './static-shoots';
import { kitTextures } from './textures';

/** An asset with three levels of the given starts, and shoot rows or none. */
function asset(froms: readonly number[], parts: readonly number[], shoots: number): PlantAsset {
	return {
		levels: froms.map((from, k) => ({
			from,
			parts: Array.from({ length: parts[k] as number }, () => ({ name: 'wood' })),
		})),
		shoots: { count: shoots },
	} as unknown as PlantAsset;
}

describe('the level bands of a fixed plant', () => {
	it('starts each level at its own distance and the first card level at the shoots', () => {
		const bands = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1.5, 400);
		expect(bands.map((b) => b.from)).toEqual([0, 12, 120]);
		expect(bands[2]?.to).toBe(400);
	});

	it('keeps each level whole until the next has faded in, then thins it out', () => {
		const bands = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1.5, 400);
		for (let k = 0; k + 1 < bands.length; k++) {
			const band = bands[k] as { from: number; to: number };
			const next = bands[k + 1] as { from: number; to: number };
			// The next level's fade-in ends where this level's fade-out begins, and not after it.
			expect(next.from * (1 + EDGE_BAND)).toBeLessThanOrEqual(band.to / (1 + EDGE_BAND) + 1e-9);
			expect(band.to).toBeGreaterThan(next.from);
		}
	});

	it('runs a level on to the next level with parts, or to the impostor', () => {
		// The middle level is empty, so the first hands over to the last.
		const bands = levelBands(asset([0, 30, 80], [2, 0, 2], 0), 12, 1, 400);
		expect(bands[0]?.to).toBeCloseTo(80 * (1 + EDGE_BAND) ** 2, 9);
		// A cutting has the nearest level alone and draws at every distance.
		const cut = levelBands(asset([0, 30, 80], [2, 0, 0], 0), 12, 1, Number.POSITIVE_INFINITY);
		expect(cut[0]?.to).toBe(Number.POSITIVE_INFINITY);
		// The handover never reaches past the impostor's distance.
		const short = levelBands(asset([0, 30, 80], [2, 2, 2], 10), 12, 1, 82);
		expect(short[1]?.to).toBe(82);
	});
});

describe("a fixed plant's sphere", () => {
	it(
		'holds everything its variant draws, inside the species box',
		async () => {
			const module = await loadSpecies('hawthorn-shrub');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
			const plant = growPlantNow(kit, { seed: 11, variant: 0, near: true });
			const radius = plantBoundingRadius(kit, plant);
			// Every vertex of every level, and every shoot row's reach, stands inside it.
			let farthest = 0;
			const at: [number, number, number] = [0, 0, 0];
			for (const level of plant.levels)
				for (const part of level.parts)
					for (let i = 0; i < part.arrays.positions.length / 3; i++) {
						dequantisePosition(part.arrays.positions, i, kit.box, at);
						farthest = Math.max(farthest, Math.hypot(...at));
					}
			const rows = plant.shoots;
			for (let r = 0; r < rows.count; r++)
				farthest = Math.max(
					farthest,
					Math.hypot(
						rows.position[r * 3] as number,
						rows.position[r * 3 + 1] as number,
						rows.position[r * 3 + 2] as number,
					) +
						(kit.prototypes[rows.prototype[r] as number]?.radius ?? 0) * (rows.scale[r] as number),
				);
			expect(farthest).toBeLessThanOrEqual(radius);
			// The species box holds every variant with room to spare, so its corner is farther.
			let corner = 0;
			for (const x of [kit.box.min[0], kit.box.max[0]])
				for (const y of [kit.box.min[1], kit.box.max[1]])
					for (const z of [kit.box.min[2], kit.box.max[2]])
						corner = Math.max(corner, Math.hypot(x, y, z));
			expect(radius).toBeLessThan(corner);
		},
		scaledBudget(60_000),
	);
});

/** A page that makes the batches a placement asks for, and records their draw ranges. */
function recordingPage() {
	const made: { material: string; rows: number; to: number }[] = [];
	const texture = () => ({ bytes: 0, update() {}, destroy() {} });
	const page = {
		textures: { fromData: () => texture() },
		geometry: { fromArrays: () => ({ destroy() {} }) },
		scene: {
			createInstances(_mesh: unknown, rows: number, options: { material: { name: string } }) {
				const record = { material: options.material.name, rows, to: 0 };
				made.push(record);
				return {
					positions: new Float32Array(rows * 3),
					rotations: new Float32Array(rows * 4),
					scales: new Float32Array(rows * 3).fill(1),
					values: new Float32Array(rows * 4),
					markDirty() {},
					destroy() {},
					setDrawRange(_from: number, to: number) {
						record.to = to;
					},
					setBoundingRadius() {},
				};
			},
		},
	};
	return { page, made };
}

describe('a forced nearest level', () => {
	it("carries the plant's shoot rows past every whole view's camera", () => {
		// A plant of a few leaf rows on a stem, drawn at the review's whole still: 768 by 516 pixels
		// through the whole view's 30 degree lens.
		const view = { height: 516, fov: 30 };
		const arrays = {
			positions: new Uint16Array([0, 0, 0, 65535, 0, 0, 0, 65535, 0]),
			normals: new Uint8Array([128, 128, 255, 128, 128, 255, 128, 128, 255]),
			uvs: new Uint16Array(6),
			uvs1: new Uint16Array(6),
			colors: new Uint8Array(9),
			indices: new Uint32Array([0, 1, 2]),
		};
		const kitData = {
			record: { variants: 1, lod: { switchPixels: [40, 30, 20, 10] } },
			header: new Float32Array(0),
			box: { min: [-1, -1, -1], max: [1, 8, 1] },
			cards: { size: 0 },
			detail: 'high',
			prototypes: [{ radius: 0.15, length: 0.4, tiers: [arrays, arrays, arrays, arrays] }],
			placeholders: 'missing',
		} as unknown as SpeciesKitData;
		const placed = (switchBias: number) => {
			const { page, made } = recordingPage();
			const textures = kitTextures(page as never, kitData, 'full', {} as never);
			const kit = { ...kitData, textures };
			const asset = {
				species: 'probe',
				variant: 0,
				season: 'summer',
				levels: [
					{ from: 0, parts: [{ name: 'wood', arrays }], triangles: 1, bytes: 0 },
					{ from: 20, parts: [], triangles: 0, bytes: 0 },
					{ from: 60, parts: [], triangles: 0, bytes: 0 },
				],
				shoots: {
					count: 3,
					prototype: new Uint8Array([0, 0, 0]),
					position: new Float32Array([0, 3, 0, 0.5, 4, 0, -0.5, 5, 0]),
					rotation: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
					scale: new Float32Array([1, 1, 1]),
					record: new Float32Array(3),
					phase: new Float32Array(3),
					sky: new Float32Array(3),
					bent: new Float32Array(3),
					order: new Float32Array(3),
				},
				wind: { base: 0, count: 0, records: new Float32Array(0) },
				impostor: { from: 100 },
			} as unknown as PlantAsset;
			placeStaticPlants(
				page as never,
				kit as never,
				[asset],
				{
					count: 1,
					position: new Float32Array([0, 0, 0]),
					turn: new Float32Array([0]),
					scale: new Float32Array([1]),
					variant: new Uint8Array([0]),
				},
				{
					materials: {
						wood: { name: 'wood' },
						shoots: { name: 'shoots' },
						cards: { name: 'cards' },
						foliage: { name: 'foliage' },
						foliageFar: { name: 'foliageFar' },
						extras: { name: 'extras' },
					} as never,
					view: { ...view, switchBias },
					castShadows: true,
				},
			);
			return made;
		};
		// The forced level: the page's bias moves the shoots' switch by two to the twentieth stops.
		const forced = placed(-20).find((batch) => batch.material === 'shoots');
		expect(forced?.rows).toBe(3);
		const forcedTo = forced?.to ?? Number.NaN;
		expect(forcedTo).toBeCloseTo(firstCardStart(kitData, view) * switchScale(-20) * SHOOT_REACH, 3);
		// Unforced, the same rows stop at the plant's own first card start, short of a whole view.
		const plain = placed(0).find((batch) => batch.material === 'shoots');
		const plainTo = plain?.to ?? Number.NaN;
		expect(plainTo).toBeCloseTo(firstCardStart(kitData, view) * SHOOT_REACH, 3);
		expect(plainTo).toBeLessThan(20);
		expect(forcedTo).toBeGreaterThan(1e6);
	});
});

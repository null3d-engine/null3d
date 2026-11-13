// The near pool, the scene's budget of real pieces: it hands its budget out over every placement
// that joined it, nearest copy first, within its count of copies, again only once the camera has
// moved half a metre; and a placement writes each grant into a slot of its range's pool, its rows
// placed at the granted copy and every other row parked, with the copy's card edge at the range.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { createNearPool, type NearPoolHost } from './near-pool';
import { poolSizes } from './near-slots';
import type { PlantCopies } from './place';
import { GRANT_NONE, GRANT_SWITCH, GRANT_TEXEL, pieceCosts } from './plant-budget';
import { type CardRow, type PoolMember, pooledShoots } from './pooled-shoots';
import type { SpeciesKit } from './textures';

/** Copies standing along +x at the given distances. */
function copiesAt(xs: readonly number[]): PlantCopies {
	return {
		count: xs.length,
		position: Float32Array.from(xs.flatMap((x) => [x, 0, 0])),
		turn: new Float32Array(xs.length),
		scale: new Float32Array(xs.length).fill(1),
		variant: new Uint16Array(xs.length),
	} as unknown as PlantCopies;
}

/** A placement that costs the same for every copy and keeps the grants it is given. */
function member(xs: readonly number[], toSwitch: number, toTexel: number) {
	const calls: Uint8Array[] = [];
	const m: PoolMember = {
		copies: copiesAt(xs),
		costOf: () => ({ toSwitch, toTexel }),
		apply(grants) {
			calls.push(Uint8Array.from(grants));
			return Uint8Array.from(grants);
		},
		destroy() {},
	};
	return { member: m, calls };
}

/** A camera the test moves. */
function cameraAt(place: number[]) {
	return {
		getWorldPosition(out: { [index: number]: number }) {
			out[0] = place[0] as number;
			out[1] = place[1] as number;
			out[2] = place[2] as number;
		},
	};
}

const ctx = { quality: { preset: 'high' } } as unknown as SketchContext;

describe('the near pool', () => {
	it('hands its budget out over every placement, nearest copy first', () => {
		const eye = [0, 0, 0];
		const pool = createNearPool(ctx, { camera: cameraAt(eye), triangles: 1100 }) as NearPoolHost;
		const oaks = member([30, 5], 300, 500);
		const pines = member([10], 200, 200);
		const firs = member([60], 400, 400);
		pool.join(oaks.member);
		pool.join(pines.member);
		pool.join(firs.member);
		pool.update();
		// Nearest first: the oak at 5 m, the pine at 10, the oak at 30 (800 in all); the fir at 60
		// would pass the budget, and ends the hand-out. What is left takes the oak at 5 m on to its
		// texel range, and the pine, which costs nothing more there; the oak at 30 would pass it.
		expect([...(oaks.calls.at(-1) as Uint8Array)]).toEqual([GRANT_SWITCH, GRANT_TEXEL]);
		expect([...(pines.calls.at(-1) as Uint8Array)]).toEqual([GRANT_TEXEL]);
		expect([...(firs.calls.at(-1) as Uint8Array)]).toEqual([GRANT_NONE]);
		expect(pool.copies).toBe(3);
		expect(pool.triangles).toBe(1000);
	});

	it('hands out again only once the camera has moved half a metre', () => {
		const eye = [0, 0, 0];
		const pool = createNearPool(ctx, { camera: cameraAt(eye), triangles: 1000 }) as NearPoolHost;
		const plants = member([4, 8], 100, 100);
		pool.join(plants.member);
		pool.update();
		eye[0] = 0.4;
		pool.update();
		expect(plants.calls.length).toBe(1);
		eye[0] = 0.6;
		pool.update();
		expect(plants.calls.length).toBe(2);
	});

	it("grants no more copies than its count, the preset's by default", () => {
		const pool = createNearPool(ctx, { camera: cameraAt([0, 0, 0]), copies: 2 }) as NearPoolHost;
		expect(pool.budget).toBe(5_000_000);
		const plants = member([1, 2, 3, 4], 10, 10);
		pool.join(plants.member);
		pool.update();
		expect([...(plants.calls.at(-1) as Uint8Array)].filter((g) => g !== GRANT_NONE).length).toBe(2);
	});

	it('takes a placement out when it leaves, and needs the camera', () => {
		const pool = createNearPool(ctx, {
			camera: cameraAt([0, 0, 0]),
			triangles: 100,
		}) as NearPoolHost;
		const plants = member([1], 10, 10);
		const leave = pool.join(plants.member);
		pool.update();
		leave();
		pool.update();
		expect(pool.copies).toBe(0);
		expect(() => createNearPool(ctx, {})).toThrow(/camera/);
	});
});

describe("a placement's pools of real pieces", () => {
	let kit: SpeciesKit;
	let assets: PlantAsset[];
	beforeAll(async () => {
		const module = await loadSpecies('scots-pine');
		await loadPlantCode(module.record);
		const data: SpeciesKitData = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
		kit = { ...data, textures: { near: { update() {} } } } as unknown as SpeciesKit;
		assets = [growPlantNow(data, { seed: 11, variant: 0 })];
	}, scaledBudget(60_000));

	/** A page that makes batches of rows as the engine holds them. */
	function page() {
		const made: {
			positions: Float32Array;
			scales: Float32Array;
			values: Float32Array;
			ranges: number[];
		}[] = [];
		const fake = {
			geometry: { fromArrays: () => ({ destroy() {} }) },
			scene: {
				createInstances(_mesh: unknown, count: number) {
					const batch = {
						positions: new Float32Array(count * 3),
						rotations: new Float32Array(count * 4),
						scales: new Float32Array(count * 3),
						values: new Float32Array(count * 4),
						ranges: [] as number[],
						setDrawRange(near: number, far: number) {
							batch.ranges.push(near, far);
						},
						markDirty() {},
						destroy() {},
					};
					made.push(batch);
					return batch;
				},
			},
		};
		return { ctx: fake as unknown as SketchContext, made };
	}

	it('sizes its pools from the budget and writes each grant into a slot', () => {
		const view = { height: 2160, fov: 60 };
		const costs = pieceCosts(kit, assets[0] as PlantAsset, view);
		const { ctx: fake, made } = page();
		const copies = copiesAt([0, 40, 80]);
		const card = { values: new Float32Array(12), markDirty() {} };
		const cards = new Map<number, CardRow>(
			[0, 1, 2].map((copy) => [copy, { batch: card as never, row: copy }]),
		);
		const ranges = { switch: 6, texel: 30 };
		// A budget of two copies to the switch.
		const budget = 2 * costs.toSwitch + 1;
		const placed = pooledShoots(
			fake,
			kit,
			assets,
			copies,
			cards,
			ranges,
			view,
			budget,
			{} as never,
		);
		const rows = (assets[0] as PlantAsset).shoots.count;
		const switchRows = made
			.filter((b) => b.ranges[1] === ranges.switch * 1.04)
			.reduce((sum, b) => sum + b.positions.length / 3, 0);
		const sizes = poolSizes([costs], budget);
		expect(sizes.switch).toBe(2);
		expect(switchRows).toBe(sizes.switch * rows);
		const texelRows = made
			.filter((b) => b.ranges[1] === ranges.texel * 1.04)
			.reduce((sum, b) => sum + b.positions.length / 3, 0);
		expect(texelRows).toBe(sizes.texel * rows);
		// Nothing granted: every row parked far below the ground.
		expect(made.every((b) => b.scales.every((s) => s === 0))).toBe(true);
		// The copy at 40 m takes a slot: its rows stand round it, the rest stay parked, and its
		// cards give way inside its switch.
		const grants = new Uint8Array([GRANT_NONE, GRANT_SWITCH, GRANT_NONE]);
		expect([...placed.apply(grants, [0, 1, 2])]).toEqual([...grants]);
		let near = 0;
		for (const b of made)
			for (let r = 0; r < b.positions.length / 3; r++)
				if ((b.scales[r * 3] as number) > 0) {
					near++;
					expect(Math.abs((b.positions[r * 3] as number) - 40)).toBeLessThan(15);
				}
		expect(near).toBe(rows);
		expect([card.values[0], card.values[4], card.values[8]]).toEqual([0, 6, 0]);
		// The grant moves to the copy at 80 m: the same slot's rows move with it.
		placed.apply(new Uint8Array([GRANT_NONE, GRANT_NONE, GRANT_SWITCH]), [0, 1, 2]);
		for (const b of made)
			for (let r = 0; r < b.positions.length / 3; r++)
				if ((b.scales[r * 3] as number) > 0)
					expect(Math.abs((b.positions[r * 3] as number) - 80)).toBeLessThan(15);
		expect([card.values[4], card.values[8]]).toEqual([0, 6]);
		placed.destroy();
	});
});

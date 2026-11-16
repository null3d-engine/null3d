// The clump card's raw material: the sockets' foliage masses grouped into clumps, the walk that
// hands each clump to the card clusters whole, and the shade baked from a clump's sky and height.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { CLUMP_UNDER_SHADE, clumpSky, clumpsOf, clumpWalk, type ClumpPlant } from './clump-card';

/** A plant of two clumps: each socket stands in a foliage mass, and the first three sockets one. */
function twoClumps(): ClumpPlant {
	const count = 6;
	const socket = Uint32Array.from([0, 1, 2, 3, 4, 5]);
	const rows: ShootRows = {
		count,
		prototype: Uint8Array.from([0, 0, 0, 0, 0, 0]),
		position: Float32Array.from([
			0, 1, 0, 0.2, 1.4, 0, 0.4, 0.6, 0, 3, 5, 0, 3.2, 5.4, 0, 3.4, 4.6, 0,
		]),
		rotation: Float32Array.from(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0))),
		scale: Float32Array.from([1, 1, 1, 1, 1, 1]),
		record: Uint16Array.from([0, 0, 0, 0, 0, 0]),
		phase: Uint8Array.from([0, 0, 0, 0, 0, 0]),
		sky: Uint8Array.from([102, 153, 51, 204, 230, 178]),
		bent: Uint8Array.from([0, 0, 0, 0, 0, 0]),
		order: Uint32Array.from([0, 1, 2, 3, 4, 5]),
		socket,
	};
	const skeleton = {
		buds: {
			sockets: {
				scale: Float32Array.from([1, 1, 1, 1, 1, 1]),
				rank: Uint32Array.from([0, 1, 2, 0, 1, 2]),
				lobe: Uint16Array.from([7, 7, 7, 9, 9, 9]),
			},
		},
	} as unknown as MacroSkeleton;
	return { rows, skeleton };
}

describe('the clumps of a plant', () => {
	it('groups the rows by their sockets’ foliage mass', () => {
		const clumps = clumpsOf(twoClumps());
		expect(clumps?.length).toBe(2);
		expect(clumps?.[0]?.lobe).toBe(7);
		expect(clumps?.[0]?.rows).toEqual([0, 1, 2]);
		expect(clumps?.[1]?.lobe).toBe(9);
		expect(clumps?.[1]?.rows).toEqual([3, 4, 5]);
	});

	it('keeps each clump in the order the walk meets its rows', () => {
		const plant = twoClumps();
		const rows = plant.rows as { order: Uint32Array };
		rows.order = Uint32Array.from([0, 1, 2, 5, 4, 3]);
		const clumps = clumpsOf(plant);
		expect(clumps?.[1]?.rows).toEqual([5, 4, 3]);
	});

	it('orders the clumps by their lowest-ordered row', () => {
		const plant = twoClumps();
		const rows = plant.rows as { order: Uint32Array };
		rows.order = Uint32Array.from([6, 7, 8, 0, 1, 2]);
		const clumps = clumpsOf(plant);
		expect(clumps?.map((clump) => clump.lobe)).toEqual([9, 7]);
	});

	it('gives the mean height, the spread and the mean sky of each clump', () => {
		const clump = clumpsOf(twoClumps())?.[0];
		expect(clump?.middle).toBeCloseTo(1, 10);
		expect(clump?.spread).toBeCloseTo(Math.sqrt(((0.4 ** 2 + 0 ** 2 + 0.4 ** 2) / 3) as number), 6);
		expect(clump?.sky).toBeCloseTo((102 + 153 + 51) / (3 * 255), 10);
	});

	it('gives nothing for a plant whose rows name no socket', () => {
		const plant = twoClumps();
		const rows = plant.rows as { socket?: Uint32Array };
		rows.socket = undefined;
		expect(clumpsOf(plant)).toBeUndefined();
	});

	it('gives nothing where every row stands in a clump of its own', () => {
		const plant = twoClumps();
		const sockets = (
			plant.skeleton as unknown as { buds: { sockets: { lobe: Uint16Array } } }
		).buds.sockets;
		sockets.lobe = Uint16Array.from([0, 1, 2, 3, 4, 5]);
		expect(clumpsOf(plant)).toBeUndefined();
	});
});

describe('the clump walk', () => {
	it('hands every row of every clump over, clump by clump', () => {
		const clumps = clumpsOf(twoClumps());
		expect(clumps && Array.from(clumpWalk(clumps))).toEqual([0, 1, 2, 3, 4, 5]);
	});
});

describe('the shade a clump card bakes', () => {
	const clump = { lobe: 0, rows: [0], middle: 2, spread: 1, sky: 0.8 };

	it('darkens the clump’s underside and keeps its top open', () => {
		const under = clumpSky(clump, 1);
		const top = clumpSky(clump, 3);
		expect(under).toBeCloseTo(0.8 * CLUMP_UNDER_SHADE, 10);
		expect(top).toBeCloseTo(0.8, 10);
	});

	it('rises from the foot to the top without a step', () => {
		let last = -1;
		for (let y = 1; y <= 3; y += 0.1) {
			const shade = clumpSky(clump, y);
			expect(shade).toBeGreaterThanOrEqual(last);
			last = shade;
		}
		expect(clumpSky(clump, 2)).toBeGreaterThan(clumpSky(clump, 1));
		expect(clumpSky(clump, 2)).toBeLessThan(clumpSky(clump, 3));
	});

	it('keeps the shade inside the clump’s own sky and the dark underside', () => {
		for (const y of [-5, 0, 1, 2, 3, 9]) {
			const shade = clumpSky(clump, y);
			expect(shade).toBeGreaterThanOrEqual(0.8 * CLUMP_UNDER_SHADE - 1e-9);
			expect(shade).toBeLessThanOrEqual(0.8 + 1e-9);
		}
	});

	it('keeps a clump with no height even, at its own sky share', () => {
		expect(clumpSky({ ...clump, spread: 0 }, 100)).toBeCloseTo(0.8, 10);
	});
});

describe('the clumps of a plant that names none', () => {
	/** A plant of twigs, each carrying one row, under two boughs: nine shoots and two. */
	function branchedRows(): ClumpPlant {
		// Axes: 0 the trunk, 1 a bough of nine twigs, 2..10 those twigs, 11 a bough of two twigs,
		// 12 and 13 those twigs.
		const parent = Int32Array.from([-1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 11, 11]);
		const twigs = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13];
		const count = twigs.length;
		const nodeOf = Uint32Array.from(twigs);
		const axisOf = Uint32Array.from([0, 1, ...twigs.map(() => 0), 11, 0, 0]);
		for (let t = 0; t < twigs.length; t++) axisOf[twigs[t] as number] = twigs[t] as number;
		const rows: ShootRows = {
			count,
			prototype: new Uint8Array(count),
			position: Float32Array.from(Array.from({ length: count * 3 }, (_, i) => (i % 3 === 1 ? 5 : 0))),
			rotation: Float32Array.from(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0))),
			scale: new Float32Array(count).fill(1),
			record: new Uint16Array(count),
			phase: new Uint8Array(count),
			sky: new Uint8Array(count).fill(200),
			bent: new Uint8Array(count),
			order: Uint32Array.from(Array.from({ length: count }, (_, i) => i)),
			socket: Uint32Array.from(Array.from({ length: count }, (_, i) => i)),
			node: nodeOf,
		};
		const skeleton = {
			axisOf,
			axes: { count: parent.length, parent },
			buds: {
				sockets: {
					scale: new Float32Array(count).fill(1),
					rank: new Uint32Array(count),
					// Every socket names a mass of its own, as the frame's twigs do.
					lobe: Uint16Array.from(Array.from({ length: count }, (_, i) => i)),
				},
			},
		} as unknown as MacroSkeleton;
		return { rows, skeleton };
	}

	it('groups the rows by the branch that carries a clump’s worth of shoots', () => {
		const clumps = clumpsOf(branchedRows());
		expect(clumps?.length).toBe(2);
		const sizes = clumps?.map((clump) => clump.rows.length).sort((a, b) => a - b);
		expect(sizes).toEqual([2, 9]);
	});

	it('gives nothing for a plant with neither lobes nor branches', () => {
		const plant = branchedRows();
		const rows = plant.rows as { node?: Uint32Array };
		rows.node = undefined;
		expect(clumpsOf(plant)).toBeUndefined();
	});
});

describe('the cards of a plant the plan cuts below its clumps', () => {
	it('draws one card set for each planned clump, sized by its radius', async () => {
		const { OAK_MANIFEST, oakRecord, testKit } = await import('../leaf/oak.test-support.ts');
		const { bakeCards } = await import('./card-bake.ts');
		const { plannedClumpCards } = await import('./cards.ts');
		const { CLUMP_TILES: _tiles } = { CLUMP_TILES: 3 };
		const record = oakRecord();
		const kit = testKit(record);
		const { cells, atlas } = bakeCards(record, OAK_MANIFEST, 'high', kit.prototypes);
		const prototypes = kit.prototypes.map((prototype, at) => ({
			...prototype,
			card: cells[at] ?? prototype.card,
		}));
		const grown = { ...kit, manifest: OAK_MANIFEST, prototypes, cards: atlas };
		const clumps = [0, 1, 2, 3, 4].map((id) => ({
			id,
			centre: [id * 2, 8 + id, 0] as [number, number, number],
			radius: 1,
			depth: 3,
			birth: 0,
		}));
		const rows: ShootRows = {
			count: 0,
			prototype: new Uint8Array(0),
			position: new Float32Array(0),
			rotation: new Float32Array(0),
			scale: new Float32Array(0),
			record: new Uint16Array(0),
			phase: new Uint8Array(0),
			sky: new Uint8Array(0),
			bent: new Uint8Array(0),
			order: new Uint32Array(0),
		};
		const skeleton = {
			clumps,
			axes: { count: 0, order: new Uint32Array(0), parent: new Int32Array(0) },
			buds: {},
		} as unknown as MacroSkeleton;
		const mesh = plannedClumpCards(
			{
				record,
				seed: 11,
				variant: 0,
				season: 'summer',
				kit: grown,
				skeleton,
				rows,
				crown: { cells: [1, 1, 1], min: [0, 0, 0], cell: 1, sky: new Float32Array([1]) },
				detail: 'high',
			} as never,
			3,
			1,
		);
		expect(mesh).toBeDefined();
		// Three planes of a 3 by 3 picture grid for each of the five clumps.
		const perClump = 3 * 3 * 3 * 2;
		expect((mesh?.indices.length ?? 0) / 3).toBe(5 * perClump);
		// Every card stands around its own clump's centre.
		const xs = mesh?.positions.filter((_, at) => at % 3 === 0) ?? new Float32Array(0);
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1.5);
		expect(Math.max(...xs)).toBeLessThanOrEqual(9.5);
	});
});

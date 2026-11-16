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

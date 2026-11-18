import { describe, expect, test } from 'bun:test';
import type { InstanceBatch } from '@null3d/engine';
import { EDGE_BAND, handOverToCards } from './hand-over';

/** A stand-in for the engine's instance batch: its sizes, and the draw range it was given. */
function fakeBatch(sizes: readonly (readonly [number, number])[]) {
	const range: number[] = [];
	const batch = {
		scales: new Float32Array(sizes.flatMap(([w, h]) => [w, h, 1])),
		setDrawRange(near: number, far: number) {
			range.splice(0, range.length, near, far);
		},
	};
	return { batch: batch as unknown as InstanceBatch, range };
}

describe('handOverToCards', () => {
	test('the meshes draw from the start up to the switch', () => {
		const meshes = fakeBatch([]);
		handOverToCards(meshes.batch, fakeBatch([[4, 6]]).batch, 200, 50);
		expect(meshes.range).toEqual([50, 200]);
	});

	test("the cards' faded edge ends before the meshes' edge begins to thin", () => {
		const cards = fakeBatch([
			[4, 6],
			[10, 12],
		]);
		const meshes = fakeBatch([]);
		handOverToCards(meshes.batch, cards.batch, 200);
		const [start = 0, far = 0] = cards.range;
		// The largest card reaches its corner from its middle, so its nearest point is that much closer.
		const corner = Math.hypot(5, 6);
		// That card stands whole at the distance where the meshes' own faded edge begins.
		expect(start * (1 + EDGE_BAND) + corner).toBeCloseTo(200 / (1 + EDGE_BAND), 9);
		expect(far).toBeGreaterThan(1e6);
	});

	test('a card larger than the switch distance starts at the camera', () => {
		const cards = fakeBatch([[500, 500]]);
		handOverToCards(fakeBatch([]).batch, cards.batch, 100);
		expect(cards.range[0]).toBe(0);
	});

	test('refuses a switch distance that is not above zero, and a start past the switch', () => {
		const meshes = fakeBatch([]).batch;
		const cards = fakeBatch([[1, 1]]).batch;
		expect(() => handOverToCards(meshes, cards, 0)).toThrow(RangeError);
		expect(() => handOverToCards(meshes, cards, Number.NaN)).toThrow(RangeError);
		expect(() => handOverToCards(meshes, cards, 100, 100)).toThrow(RangeError);
		expect(() => handOverToCards(meshes, cards, 100, -1)).toThrow(RangeError);
	});
});

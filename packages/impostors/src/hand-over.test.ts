import { describe, expect, test } from 'bun:test';
import type { InstanceBatch } from '@null3d/engine';
import {
	EDGE_BAND,
	HAND_OVER_GROUPS,
	HAND_OVER_SPREAD,
	handOverCards,
	handOverMeshes,
	handOverSwitches,
	handOverToCards,
} from './hand-over';

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

describe('the groups of a plant', () => {
	test('the switches straddle the plant distance evenly, and their mean is that distance', () => {
		const switches = handOverSwitches(268);
		expect(switches).toHaveLength(HAND_OVER_GROUPS);
		expect(switches[0]).toBeCloseTo(268 * (1 - HAND_OVER_SPREAD), 9);
		expect(switches.at(-1)).toBeCloseTo(268 * (1 + HAND_OVER_SPREAD), 9);
		const mean = switches.reduce((sum, value) => sum + value, 0) / switches.length;
		expect(mean).toBeCloseTo(268, 9);
		// Each switch is later than the one before it, so the groups hand over one after another.
		for (let k = 1; k < switches.length; k++)
			expect(switches[k] as number).toBeGreaterThan(switches[k - 1] as number);
	});

	test('one group hands over at the plant distance itself', () => {
		expect(handOverSwitches(268, 1)).toEqual([268]);
	});

	test('a group draws its meshes to its own switch, and the cards stand behind the earliest', () => {
		const switches = handOverSwitches(268);
		const cards = fakeBatch([[10, 12]]);
		handOverCards(cards.batch, switches[0] as number);
		const [cardsNear = 0] = cards.range;
		for (const distance of switches) {
			const meshes = fakeBatch([]);
			handOverMeshes(meshes.batch, distance);
			expect(meshes.range).toEqual([0, distance]);
			// The cards' own faded edge ends before this group's mesh begins to thin.
			expect(cardsNear * (1 + EDGE_BAND)).toBeLessThanOrEqual(distance * (1 - EDGE_BAND) + 1e-9);
		}
	});

	test('refuses a count or a spread that cannot make groups', () => {
		expect(() => handOverSwitches(100, 0)).toThrow(RangeError);
		expect(() => handOverSwitches(100, 2.5)).toThrow(RangeError);
		expect(() => handOverSwitches(100, 4, 1)).toThrow(RangeError);
		expect(() => handOverSwitches(100, 4, -0.1)).toThrow(RangeError);
		expect(() => handOverSwitches(0)).toThrow(RangeError);
	});

	test('a spread has a later group than the plant distance and an earlier one, never both on one side', () => {
		for (const spread of [0.02, 0.06, 0.2]) {
			const switches = handOverSwitches(200, 4, spread);
			expect((switches[0] as number) < 200).toBe(true);
			expect((switches.at(-1) as number) > 200).toBe(true);
		}
	});
});

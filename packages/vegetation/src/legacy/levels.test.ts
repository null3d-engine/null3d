import { describe, expect, test } from 'bun:test';
import {
	cardLevel,
	cardOrder,
	type LeafCard,
	spaceFillingKey,
	woodDetail,
	woodError,
} from './levels';

/** A card at a place, with the size and wind data that a level keeps unchanged. */
function card(x: number, y: number, z: number): LeafCard {
	return {
		center: [x, y, z],
		normal: [0, 1, 0],
		right: [1, 0, 0],
		up: [0, 0, 1],
		width: 0.3,
		height: 0.3,
		branch: 1,
		flutter: 7,
		stiffness: 200,
		occlusion: 0.5,
		kind: 'cluster',
	};
}

/** A crown of cards spread over a box, which a level thins. */
const CROWN: readonly LeafCard[] = Array.from({ length: 256 }, (_, i) =>
	card((i % 4) * 1.5, Math.floor(i / 16) * 0.7, (Math.floor(i / 4) % 4) * 1.5),
);

describe('the leaf-card level rule', () => {
	test('orders every card once, by a space-filling curve', () => {
		const order = cardOrder(CROWN);
		expect(order.length).toBe(CROWN.length);
		expect(new Set(order).size).toBe(CROWN.length);
		const min = [0, 0, 0];
		const side = 10.5;
		const keys = order.map((index) =>
			spaceFillingKey(CROWN[index]?.center as [number, number, number], min, side),
		);
		for (let i = 1; i < keys.length; i++)
			expect(keys[i] as number).toBeGreaterThanOrEqual(keys[i - 1] as number);
	});

	test('keeps every second card at level 1, every fourth at level 2', () => {
		const order = cardOrder(CROWN);
		const first = cardLevel(CROWN, 1, order);
		const second = cardLevel(CROWN, 2, order);
		expect(first.cards.length).toBe(CROWN.length / 2);
		expect(second.cards.length).toBe(CROWN.length / 4);
		expect(first.cards[0]).toBe(CROWN[order[0] as number]);
		expect(first.cards[1]).toBe(CROWN[order[2] as number]);
		expect(second.cards[1]).toBe(CROWN[order[4] as number]);
	});

	test('grows each kept card about its middle, so the crown keeps its coverage', () => {
		const order = cardOrder(CROWN);
		for (const level of [1, 2]) {
			const thinned = cardLevel(CROWN, level, order);
			expect(thinned.grow).toBe(Math.sqrt(2 ** level));
			for (const kept of thinned.cards) {
				const base = CROWN.find((candidate) => candidate.center === kept.center) as LeafCard;
				expect(kept.center).toBe(base.center);
				expect(kept.width).toBe(base.width);
			}
			// A kept card covers `every` cards' area, so the coverage holds.
			const covered = thinned.cards.length * thinned.grow ** 2;
			expect(covered).toBeGreaterThanOrEqual(CROWN.length - 1e-9);
		}
	});

	test('reports the largest card that a level drops as its error', () => {
		const order = cardOrder(CROWN);
		const thinned = cardLevel(CROWN, 1, order);
		expect(thinned.error).toBeCloseTo(0.3, 6);
	});

	test('keeps the level 0 error at nothing', () => {
		const order = cardOrder(CROWN);
		expect(cardLevel(CROWN, 0, order).cards.length).toBe(CROWN.length);
		expect(cardLevel(CROWN, 0, order).error).toBe(0);
	});

	test('makes wood coarser as the level rises', () => {
		expect(woodDetail(0).ringStep).toBeLessThan(woodDetail(1).ringStep);
		expect(woodDetail(1).ringStep).toBeLessThan(woodDetail(2).ringStep);
		expect(woodDetail(0).sideScale).toBe(1);
		expect(woodDetail(2).sideScale).toBeLessThan(woodDetail(1).sideScale);
	});

	test('misses a branch further as its sides and rings thin', () => {
		expect(woodError(0.1, 2, 8, 9)).toBeLessThan(woodError(0.1, 2, 4, 3));
		expect(woodError(0.2, 5, 4, 3)).toBeGreaterThan(woodError(0.1, 5, 4, 3));
	});

	test('handles an empty plant', () => {
		expect(cardOrder([])).toEqual([]);
		expect(cardLevel([], 2, []).cards).toEqual([]);
	});
});

// Every stone of the creek stands wholly on the cliff's top: no rock and no pebble may hang past the
// rim, where it would float in the air beside the walls.
import { expect, test } from 'bun:test';
import { bearingOf, POOL, rimRadius } from './land';
import { FOAM_ARM, foamArmFactor, pebblePlaces, ROCK_REACH, rockPlaces } from './stones';

/** How far inside the rim a stone's edge keeps, at the least, in meters. */
const MARGIN = 0.05;

test('every rock and every pebble stands inside the rim', () => {
	const rocks = rockPlaces();
	expect(rocks.length).toBeGreaterThan(100);
	for (const { x, z, size } of rocks)
		expect(Math.hypot(x, z) + size * ROCK_REACH + MARGIN, `a rock at ${x}, ${z}`).toBeLessThan(
			rimRadius(bearingOf(x, z)),
		);
	const pebbles = pebblePlaces(6000);
	expect(pebbles).toHaveLength(6000);
	for (const { x, z, size } of pebbles)
		expect(Math.hypot(x, z) + size + MARGIN, `a pebble at ${x}, ${z}`).toBeLessThan(
			rimRadius(bearingOf(x, z)),
		);
});

test('the foam marks thin on the east arm and thicken on the west', () => {
	// The water helper's trace: the east arm's bright share follows its marks' radius, so its
	// marks take a fraction of the map's width; the west's take more.
	expect(foamArmFactor(POOL.x + 1)).toBeCloseTo(FOAM_ARM.east, 6);
	expect(foamArmFactor(POOL.x - 1)).toBeCloseTo(FOAM_ARM.west, 6);
	expect(FOAM_ARM.east).toBeLessThanOrEqual(0.5);
	expect(FOAM_ARM.west).toBeGreaterThan(1.2);
	expect(FOAM_ARM.west).toBeLessThanOrEqual(1.25);
});

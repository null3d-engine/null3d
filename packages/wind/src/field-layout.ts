// The layout of the wind's request to its job worker and of the answer that the worker gives. The
// sketch fills the request, the worker copies it into its WebAssembly module, and both read the
// answer the same way. The module holds the place count, thirteen settings and the time, the four
// slots of the ring, and then three numbers for each place.
//
// The count is a whole number in a 32-bit float, which holds every count that the module takes.
import type { WindReading } from './analytic';

/** The place of the place count in the request. */
export const COUNT = 0;

/** The place of the settings: the base wind, the gust, the swirl, the push's width and the time. */
export const SETTINGS = 1;

/** The place of the ring: four slots of `SLOT_FLOATS` numbers each. */
export const RING = 14;

/** The place of the first place's numbers. */
export const POINTS = 30;

/** The numbers of each ring slot: its place across the ground, its strength and its birth time. */
export const SLOT_FLOATS = 4;

/** The most places that one ask takes, from the request buffer that the module holds. */
export const MAX_PLACES = 5_400;

/** The numbers that a request buffer holds at least, so a small growth costs no allocation. */
export const STEP = 256;

/**
 * Writes the settings, the ring and the places into `request`, which holds the places from `POINTS`
 * on, and answers the place count. `points` holds three numbers a place, and `ring` one slot after
 * another.
 */
export function fillRequest(
	request: Float32Array,
	points: Float32Array,
	reading: WindReading,
	pushRadius: number,
	time: number,
	ring: Float32Array,
): number {
	const count = points.length / 3;
	request[COUNT] = count;
	// The settings are the three vectors that a reader already holds, the push's width and the
	// time. The swirl's vector holds a fourth number that nothing reads, so only three of its
	// numbers go in.
	request.set(reading.base, SETTINGS);
	request.set(reading.gust, SETTINGS + 4);
	request[SETTINGS + 8] = reading.swirl[0] as number;
	request[SETTINGS + 9] = reading.swirl[1] as number;
	request[SETTINGS + 10] = reading.swirl[2] as number;
	request[SETTINGS + 11] = pushRadius;
	request[SETTINGS + 12] = time;
	request.set(ring, RING);
	request.set(points, POINTS);
	return count;
}

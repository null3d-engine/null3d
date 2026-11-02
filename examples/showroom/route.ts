// Where the car stands and which way it faces at a time of the demo's loop. The car waits in the
// studio while the camera looks it over, drives out through the opening into the street, turns at
// the far end, and drives back. Every value is a function of the sketch time, so a held frame lands
// on the same pose and the loop meets itself with no jump.

/** The length of the car's loop, in seconds. The camera's route takes the same time. */
export const CAR_PERIOD = 36;
/** The z where the car waits in the studio, and the z where it turns in the street. */
export const STUDIO_Z = 9;
export const STREET_Z = -30;
/** The heading with the nose toward the street (-z), and the one with it toward the studio (+z). */
export const TOWARD_STREET = Math.PI / 2;
export const TOWARD_STUDIO = -Math.PI / 2;

/** Where the car stands: its place along z and its turn about y, in radians. */
export interface CarPose {
	readonly z: number;
	readonly heading: number;
}

/** Rises from 0 at `a` to 1 at `b`, smoothly, and stays at 0 or 1 outside. */
function ease(a: number, b: number, t: number): number {
	const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
	return u * u * (3 - 2 * u);
}

/** The car's pose at a time of the loop, in seconds. */
export function carPose(time: number): CarPose {
	const t = ((time % CAR_PERIOD) + CAR_PERIOD) % CAR_PERIOD;
	// The studio: the car turns slowly on the spot, and settles square to the street before it moves.
	if (t < 9) {
		const turn = 0.4 * Math.sin(t * 0.7) * (1 - ease(6, 9, t));
		return { z: STUDIO_Z, heading: TOWARD_STREET + turn };
	}
	// The drive out, nose first, then the turn at the far end of the street.
	if (t < 17)
		return { z: STUDIO_Z + (STREET_Z - STUDIO_Z) * ease(9, 17, t), heading: TOWARD_STREET };
	if (t < 21)
		return {
			z: STREET_Z,
			heading: TOWARD_STREET + (TOWARD_STUDIO - TOWARD_STREET) * ease(17, 21, t),
		};
	// The drive back, then a half turn on the spot so the loop faces the street again.
	if (t < 29)
		return { z: STREET_Z + (STUDIO_Z - STREET_Z) * ease(21, 29, t), heading: TOWARD_STUDIO };
	return {
		z: STUDIO_Z,
		heading: TOWARD_STUDIO + (TOWARD_STREET - 2 * Math.PI - TOWARD_STUDIO) * ease(29, 35, t),
	};
}

/**
 * The turn of one wheel, in radians, for a distance that the car drove forward: the distance over
 * the wheel's radius, with the axle's side turned in. The hub's quarter turn points the right
 * wheel's axle at the car's +z and the left's at -z. A wheel that rolls forward turns negative about
 * +z, so the right takes the distance one way and the left the other.
 */
export function wheelTurn(distance: number, radius: number, outward: 1 | -1): number {
	return (-distance / radius) * outward;
}

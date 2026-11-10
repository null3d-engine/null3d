// The review's light calibration. Before it, every colour figure was judged through a light that
// under-lit a known flat surface by eight to ten times: a sheath surface whose colour is exact drew
// (37, 25, 11) where its record colour is (108, 80, 48). The correction is measured from that surface
// at four exposures in each rig (run sedge-light-probe), and the scale that brought each end to its
// record colour, red, green and blue, was:
//
//   rig      end     red    green  blue
//   flat     foot    8.00   8.19   8.78
//   flat     collar  8.39   8.74   9.32
//   daylight foot    8.85   9.10   9.15
//   daylight collar  9.10   9.49   10.23
//
// So the flat fallback needs about a tenth less than the soft daylight rig, which it lacks a sun to
// explain, and blue needs about a tenth more than red and green in both, the studio light's warm
// tint. One neutral constant cannot carry both: it would leave one rig about a tenth bright and blue
// about a tenth dark. `light.test.ts` refuses that shape and holds the factors to the probe.

/** The two light rigs the calibration separates: the studio fallback and the soft daylight. */
export type CalibratedRig = 'flat' | 'daylight';

/**
 * The measured factors. A rig's light takes its factor in red and green; every light's red and green
 * stand at the blue gain's inverse while its intensity takes the gain, so blue reads a tenth above
 * them without asking a colour for more than white.
 */
export const LIGHT_CALIBRATION = {
	/** The flat fallback's factor, for red and green. */
	flat: 8.3,
	/** The soft daylight rig's factor, for red and green. */
	daylight: 9.2,
	/** The blue channel's gain over red and green, in both rigs. */
	blue: 1.1,
} as const;

/** The scales the known surface measured, red, green and blue, at each rig's foot and collar. */
export const LIGHT_PROBE = {
	flat: { foot: [8.0, 8.19, 8.78], collar: [8.39, 8.74, 9.32] },
	daylight: { foot: [8.85, 9.1, 9.15], collar: [9.1, 9.49, 10.23] },
} as const;

/**
 * A light colour whose red and green stand at the blue gain's inverse, so with the gain on the
 * light's own intensity its blue reads a tenth above them.
 *
 * @param colour The light's colour, as `#rrggbb`.
 * @returns The colour to create the light with.
 */
export function blueGained(colour: string): string {
	const channel = (at: number) => Number.parseInt(colour.slice(at, at + 2), 16);
	const dim = (at: number) =>
		Math.round(channel(at) / LIGHT_CALIBRATION.blue)
			.toString(16)
			.padStart(2, '0');
	return `#${dim(1)}${dim(3)}${colour.slice(5, 7)}`;
}

// One cloud of Gaussian splats, in the form that every reader of the package gives the draw: a
// center, three principal spreads and a unit rotation for each splat, and its linear color and
// opacity. The readers of SPZ and of KHR_gaussian_splatting both fill this, and the draw takes it
// without caring where it came from.
//
// A reader reconstructs a splat's color from the first band of its spherical harmonics, as the
// glTF extension defines: the coefficient times the band's constant, plus the half that moves the
// range onto 0 to 1. Higher bands make the color change with the view; this package ignores them,
// which the extension allows.

/** The constant that turns the first spherical-harmonic band into a color. */
const SH_C0 = 0.2820947917738781;

/**
 * One cloud of Gaussian splats, ready to draw.
 *
 * @category api/splats
 */
export interface SplatData {
	/** The number of splats. Every array holds this many entries. */
	readonly count: number;
	/** The centers, 3 floats each, in meters. */
	readonly positions: Float32Array;
	/** The three principal standard deviations, 3 floats each, in meters, 0 or more. */
	readonly scales: Float32Array;
	/** The rotations as unit quaternions (x, y, z, w), 4 floats each. */
	readonly rotations: Float32Array;
	/** Linear RGBA colors, 4 floats each, with the opacity in alpha. */
	readonly colors: Float32Array;
}

/** The first code that the package's errors use, outside the engine's own range. */
export const SPLATS_CODES = 2100;

/** An error that the package raises, with its own code and a message that says how to fix it. */
export function splatsError(code: number, detail: string): Error {
	return new Error(`splats E${code}: ${detail}`);
}

/** Turns a chunk of sRGB display values into linear values, as the engine's lighting expects. */
function srgbToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * The linear RGB of a first-band spherical-harmonic coefficient, from its three channels. `encoded`
 * says that the reconstructed value is an sRGB display value, which this decodes; leave it out for
 * a value that is already linear.
 *
 * @category api/splats
 */
export function colorOfSh(
	dc: readonly [number, number, number],
	encoded = true,
	out = new Float32Array(3),
): Float32Array {
	for (let i = 0; i < 3; i++) {
		const value = Math.min(Math.max((dc[i] as number) * SH_C0 + 0.5, 0), 1);
		out[i] = encoded ? srgbToLinear(value) : value;
	}
	return out;
}

/**
 * Checks that a cloud's arrays hold what its count says, and throws when they do not.
 *
 * @category api/splats
 */
export function checkSplats(data: SplatData, what: string): SplatData {
	const { count, positions, scales, rotations, colors } = data;
	const whole = Number.isInteger(count) && count >= 0;
	if (!whole)
		throw splatsError(
			2101,
			`${what} holds ${count} splats, and a cloud takes a whole number of splats, 0 or more.`,
		);
	const fits =
		positions.length === count * 3 &&
		scales.length === count * 3 &&
		rotations.length === count * 4 &&
		colors.length === count * 4;
	if (!fits)
		throw splatsError(
			2101,
			`${what} holds ${count} splats, and its arrays hold ${positions.length / 3}, ${scales.length / 3}, ${rotations.length / 4} and ${colors.length / 4} of them. Give every array one entry for each splat.`,
		);
	return data;
}

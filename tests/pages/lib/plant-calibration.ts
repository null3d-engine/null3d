// The leaf calibration's figures, shared by its sketch and its test: the transmittance and the
// roughness of the calibration record, whose reflectances are the oak's measured texture means.

/** The leaf's linear transmittance: a yellow green, as an oak leaf passes it. */
export const CALIBRATION_TRANSMITTANCE = [0.07, 0.12, 0.025] as const;

/** The perceptual roughness of the upper and lower faces. */
export const CALIBRATION_ROUGHNESS = [0.55, 0.65] as const;

/**
 * The view: an orthographic camera this many metres tall, centred this high, on a picture this
 * size. A metre spans 256 pixels, so the leaf's 1,024 texels draw from the texture's third mip level.
 */
export const VIEW = { height: 1.5, centre: 0.5, size: [768, 384] as const };

/** The texture's mip level that the leaf draws from at this view. */
export const LEAF_LEVEL = 2;

/** Where the leaf square's stalk end stands, in metres: it reaches a metre up from there. */
export const LEAF_PLACE = [-0.7, 0] as const;

/**
 * The centres of the reference squares: the face's reflectance above, the transmittance below, and
 * to their right a black square with the leaf's gloss, which holds the highlight alone.
 */
export const REFERENCE_PLACES = {
	reflectance: [0.55, 0.85] as const,
	transmittance: [0.55, 0.15] as const,
	gloss: [1.1, 0.5] as const,
};

/** The reference squares' side in metres. */
export const REFERENCE_SIDE = 0.45;

const brightest = (colours: readonly (readonly number[])[]) =>
	Math.max(...colours.flatMap((colour) => [...colour]));

/**
 * The share of white that the lights bring a face's mean to. A leaf's pale veins shine at several
 * times its mean against the light, and must not pass white, where the 8-bit picture clips them.
 */
const MEAN_LEVEL = 0.2;

/**
 * The sun's strength for a face: its brightest channel, or the transmittance's, lit 45 degrees off
 * the normal, comes to the mean level.
 */
export function calibrationSun(reflectance: readonly number[]): number {
	return (
		(MEAN_LEVEL * Math.PI) / (Math.SQRT1_2 * brightest([reflectance, CALIBRATION_TRANSMITTANCE]))
	);
}

/** The ambient light's strength for a face: its reflectance and the light through together come to the mean level. */
export function calibrationSky(reflectance: readonly number[]): number {
	const sum = reflectance.map((r, k) => r + (CALIBRATION_TRANSMITTANCE[k] as number));
	return (MEAN_LEVEL * Math.PI) / brightest([sum]);
}

// The Creek's look, as one setting: the tone curve that maps its light to the screen, the air that
// hazes its distance, and the stage of moods that carries both, so the garden's colors are set in
// one place and a test can hold them.
import type { DirectionalLight, Environment, SketchContext } from '@null3d/engine';
import { createMoods, type Stage, type StageOptions } from '../../lib/stage';
import { CLOUD_TOP } from './land';

/**
 * The turn of the sun's path: in the morning its soft light comes from the opening view's upper
 * left and a little from the front, as in the concept picture.
 */
export const HEADING = Math.PI + 0.58;

/**
 * The Creek's tone curve: AgX with the punchy look's contrast, as the engine's default curve, and a
 * gentler color boost about each color's luminance. The punchy look boosts by 1.4, which pushes dark
 * yellows, such as the moss's and the bronze's, below zero blue, which the screen clips, so near
 * colors read at full strength; the Creek's boost keeps them under the clip.
 */
export const TONE_CURVE = /* wgsl */ `
#import null3d::color::{AGX_INSET, AGX_OUTSET, AGX_MIN_EV, AGX_MAX_EV, LINEAR_SRGB_TO_LINEAR_REC2020, LINEAR_REC2020_TO_LINEAR_SRGB, agx_contrast, luminance}

const POWER: f32 = 1.35;
const SATURATION: f32 = 1.0;

fn toneCurve(color: vec3f) -> vec3f {
    let inset = AGX_INSET * (LINEAR_SRGB_TO_LINEAR_REC2020 * color);
    let logged = (log2(max(inset, vec3f(1e-10))) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
    let looked = pow(max(agx_contrast(saturate(logged)), vec3f(0.0)), vec3f(POWER));
    let luma = luminance(looked);
    let curved = AGX_OUTSET * (luma + SATURATION * (looked - luma));
    let rec2020 = pow(max(curved, vec3f(0.0)), vec3f(2.2));
    return saturate(LINEAR_REC2020_TO_LINEAR_SRGB * rec2020);
}
`;

/**
 * The air: its density at the cloud's tops, how fast it thins above them, by a factor of e every
 * 1 / falloff meters, and how far its color moves toward a grey. It lies thick over the cloud sea
 * and the cliff's lower face, and grows with distance over the garden, a few parts in a hundred of
 * each pixel by the opening camera's 45 m and more toward the far wall, so far colors read weaker
 * and the far wall lighter, as the concept's do. Its near-neutral grey weakens them without the
 * sky's blue.
 */
export const AIR = { density: 0.0086, falloff: 0.12, grey: 0.9 } as const;

/** The Creek's stage options, the air's among them. */
export const STAGE: StageOptions = {
	heading: HEADING,
	fogDensity: AIR.density,
	fogHeight: { height: CLOUD_TOP, falloff: AIR.falloff },
	fogGrey: AIR.grey,
	cloudCoverage: 0.95,
	haze: { Morning: 1.4, Golden: 1.2, Dusk: 1.5 },
	// The cloud above and the cloud below both fill the garden with soft light: the sun's own light
	// is weakened and the sky's share grows, so the shadows stay soft, and the picture opens up past
	// the clear sky's exposure. The sun keeps enough to warm the faces it lights, such as the
	// statue's chest, as the concept's warm light does, with no fill to warm every face.
	exposureScale: 3.2,
	environmentScale: 1.8,
	sunScale: 0.6,
	backdrop: [0.02, 0.03, 0.05],
};

/**
 * Sets the Creek's tone curve and makes its stage of moods, with its air. The garden opens on a
 * soft morning under heavy cloud, with the air thick over the cloud sea.
 */
export function createCreekStage(
	ctx: SketchContext,
	sun: DirectionalLight,
	sky: Environment | Promise<Environment>,
	room: Environment | Promise<Environment>,
): Stage {
	ctx.post.set({ toneMapping: TONE_CURVE });
	return createMoods(ctx, sun, sky, room, STAGE);
}

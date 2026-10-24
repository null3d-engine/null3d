// The lens kit: the camera's marks on the picture, assembled from what the engine has and one
// effect of its own. The grade, the sharpening and the vignette are the core's own settings, which
// this add-on sets from one look. The film grain, the color fringes, the anamorphic streak and the
// speed blur are one full-screen effect, with a value each and off at 0, so a look that wants only
// the grade pays for no tap.
//
// The grade is the core's grading controls: white balance, lift, gamma, gain, saturation and split
// toning, which a job worker bakes into the table that the final pass reads. The streak reads a
// level of bloom's chain, which already holds the thresholded, blurred light, so it spreads that
// light sideways instead of blurring the picture again.
import type { Effect, GradingSettings, SketchContext, VignetteSettings } from '@null3d/engine';
import lensEffect from './lens.wgsl';

/** One look of the lens. A part that a later call leaves out keeps its value. */
export interface LensLook {
	/** How much the display picture sharpens, 0 or more. 0 turns it off. */
	sharpen?: number | false;
	/** The vignette, or `false` for none. */
	vignette?: VignetteSettings | false;
	/**
	 * The core's grading controls, which a job worker bakes into the core's table: white balance,
	 * lift, gamma, gain, saturation and split toning. `false` leaves the picture as it is.
	 */
	grading?: GradingSettings | false;
	/**
	 * The level of bloom's chain that the streak reads: 0 for the narrowest glow, and 3 by default,
	 * for a streak wider than the brightest light. Bloom must be on, or the streak reads black.
	 */
	bloomLevel?: number;
	/** How far the red and the blue pull apart toward the corners, in pixels. */
	aberration?: number;
	/** The share of bloom's glow that bleeds sideways. */
	streak?: number;
	/** How much the grain changes each pixel's brightness, from 0 to 1. */
	grain?: number;
	/** How far the frame smears toward the middle, for speed, from 0 to 1. */
	speedBlur?: number;
}

/** The lens kit of a scene. */
export interface LensKit {
	/**
	 * Applies a look, or the parts of one that changed. A mark's value above 0 makes the effect
	 * where the kit has none, and lowering every mark to 0 drops it again.
	 */
	set(look: LensLook): void;
	/** The effect that the lens draws with, while any of its values is above 0. */
	readonly effect: Effect | null;
}

/** The lens kit of a scene, made with the look that it starts with. */
export function createLensKit(ctx: SketchContext, look: LensLook = {}): LensKit {
	const { post } = ctx;
	const values = {
		aberration: look.aberration ?? 0,
		streak: look.streak ?? 0,
		grain: look.grain ?? 0,
		speed: look.speedBlur ?? 0,
	};
	let bloomLevel = look.bloomLevel ?? 3;
	/** The effect that draws the marks, while any of their values is above 0. */
	let effect: Effect | null = null;
	/** How many of the marks' values the picture draws. */
	const marksDrawn = (): boolean =>
		values.aberration > 0 || values.streak > 0 || values.grain > 0 || values.speed > 0;
	/**
	 * Makes the effect once a mark's value is above 0, drops it while all are 0, and writes the
	 * marks' values to it. A kit that starts without marks pays for no pass until a look sets one.
	 */
	const applyMarks = (): void => {
		const drawn = marksDrawn();
		if (drawn && effect === null) {
			effect = post.addEffect({
				wgsl: lensEffect,
				uniforms: values,
				// The streak reads this level of bloom's chain, so the effect draws in a pass of its own.
				bloomLevel,
			});
		} else if (!drawn && effect !== null) {
			post.removeEffect(effect);
			effect = null;
		}
		if (effect === null) return;
		post.setEffectUniform(effect, 'aberration', values.aberration);
		post.setEffectUniform(effect, 'streak', values.streak);
		post.setEffectUniform(effect, 'grain', values.grain);
		post.setEffectUniform(effect, 'speed', values.speed);
	};
	applyMarks();
	let vignette = look.vignette ?? false;
	let sharpen = look.sharpen ?? false;
	let grading = look.grading ?? false;

	/** Writes the core's own settings: the sharpening, the vignette and the grading controls. */
	const applyGrade = (): void => {
		post.set({ sharpen, vignette, grading });
	};
	applyGrade();

	const kit: LensKit = {
		get effect() {
			return effect;
		},
		set(next) {
			const marks =
				next.aberration !== undefined ||
				next.streak !== undefined ||
				next.grain !== undefined ||
				next.speedBlur !== undefined;
			if (next.aberration !== undefined) values.aberration = next.aberration;
			if (next.streak !== undefined) values.streak = next.streak;
			if (next.grain !== undefined) values.grain = next.grain;
			if (next.speedBlur !== undefined) values.speed = next.speedBlur;
			if (next.bloomLevel !== undefined && next.bloomLevel !== bloomLevel) {
				// The bloom level is fixed when the effect is made, so the effect is made again.
				bloomLevel = next.bloomLevel;
				if (effect !== null) {
					post.removeEffect(effect);
					effect = null;
					applyMarks();
				}
			} else if (marks) applyMarks();
			if (next.vignette !== undefined || next.sharpen !== undefined || next.grading !== undefined) {
				if (next.vignette !== undefined) vignette = next.vignette;
				if (next.sharpen !== undefined) sharpen = next.sharpen;
				if (next.grading !== undefined) grading = next.grading;
				applyGrade();
			}
		},
	};
	return kit;
}

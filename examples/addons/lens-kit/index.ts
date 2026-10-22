// The lens kit: the camera's marks on the picture, assembled from what the engine has and one
// effect of its own. The grade, the sharpening and the vignette are the core's own settings, which
// this add-on sets from one look. The film grain, the colour fringes, the anamorphic streak and the
// speed blur are one full-screen effect, with a value each and off at 0, so a look that wants only
// the grade pays for no tap.
//
// A look's grade is a colour table the add-on bakes from numbers at the setup, and gives to the
// core's grading table. Two looks ship with it, for a night city and for a neutral product view.
import type { Effect, Lut, LutData, SketchContext, VignetteSettings } from '@null3d/engine';
import lensEffect from './lens.wgsl';

/** A grade that the core's grading table applies: a table, and how strongly it applies it. */
export interface LensGrade {
	/** The table, such as one that `nightGrade` makes. */
	data: LutData;
	/** The share of the grade that the picture takes, from 0 to 1, and 1 by default. */
	intensity?: number;
}

/** One look of the lens. A part that a later call leaves out keeps its value. */
export interface LensLook {
	/** How much the display picture sharpens, 0 or more. 0 turns it off. */
	sharpen?: number | false;
	/** The vignette, or `false` for none. */
	vignette?: VignetteSettings | false;
	/** The colour grade, or `false` for none. The grade is baked when the kit is made. */
	grade?: LensGrade | false;
	/** How far the red and the blue pull apart toward the corners, in pixels. */
	aberration?: number;
	/** The share of the light brighter than white that bleeds sideways. */
	streak?: number;
	/** How much the grain changes each pixel's brightness, from 0 to 1. */
	grain?: number;
	/** How far the frame smears toward the middle, for speed, from 0 to 1. */
	speedBlur?: number;
}

/** The lens kit of a scene. */
export interface LensKit {
	/** Applies a look, or the parts of one that changed. */
	set(look: LensLook): void;
	/** The effect that the lens draws with, while any of its values is above 0. */
	readonly effect: Effect | null;
}

/** The lens kit of a scene, made with the look that it starts with. */
export async function createLensKit(ctx: SketchContext, look: LensLook = {}): Promise<LensKit> {
	const { post, assets } = ctx;
	const values = {
		aberration: look.aberration ?? 0,
		streak: look.streak ?? 0,
		grain: look.grain ?? 0,
		speed: look.speedBlur ?? 0,
	};
	// The grade is the core's grading table, filled once: a look that asks for none skips it.
	const lut: Lut | false =
		look.grade === false || look.grade === undefined
			? false
			: await assets.lutFromData(look.grade.data);
	const strength =
		look.grade === false || look.grade === undefined ? 1 : (look.grade.intensity ?? 1);
	const drawn = values.aberration > 0 || values.streak > 0 || values.grain > 0 || values.speed > 0;
	const effect = drawn ? post.addEffect({ wgsl: lensEffect, uniforms: values }) : null;
	let vignette = look.vignette ?? false;
	let sharpen = look.sharpen ?? false;

	/** Writes the core's own settings: the sharpening, the vignette and the grade. */
	const grade = (): void => {
		post.set({ sharpen, vignette });
		if (lut !== false) post.set({ lut, lutIntensity: strength });
	};
	grade();

	return {
		effect,
		set(next) {
			if (next.aberration !== undefined) values.aberration = next.aberration;
			if (next.streak !== undefined) values.streak = next.streak;
			if (next.grain !== undefined) values.grain = next.grain;
			if (next.speedBlur !== undefined) values.speed = next.speedBlur;
			if (effect) {
				post.setEffectUniform(effect, 'aberration', values.aberration);
				post.setEffectUniform(effect, 'streak', values.streak);
				post.setEffectUniform(effect, 'grain', values.grain);
				post.setEffectUniform(effect, 'speed', values.speed);
			}
			if (next.vignette !== undefined || next.sharpen !== undefined) {
				if (next.vignette !== undefined) vignette = next.vignette;
				if (next.sharpen !== undefined) sharpen = next.sharpen;
				grade();
			}
		},
	};
}

/**
 * A grade for a night city: cool shadows, warm highlights and a little more colour. Every value
 * stays inside the display range, so nothing clips.
 */
export function nightGrade(size = 17): LutData {
	const data = new Float32Array(size ** 3 * 3);
	let at = 0;
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				let [red, green, blue] = [r / (size - 1), g / (size - 1), b / (size - 1)];
				const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				const shadow = (1 - light) ** 2;
				const highlight = light ** 2;
				// A little contrast about the middle, then the split tone.
				red = (red - 0.5) * 1.06 + 0.5 - 0.012 * shadow + 0.02 * highlight;
				green = (green - 0.5) * 1.06 + 0.5 + 0.008 * highlight;
				blue = (blue - 0.5) * 1.06 + 0.5 + 0.018 * shadow - 0.014 * highlight;
				const grey = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				data[at++] = clamp01(grey + (red - grey) * 1.08);
				data[at++] = clamp01(grey + (green - grey) * 1.08);
				data[at++] = clamp01(grey + (blue - grey) * 1.08);
			}
		}
	}
	return { size, data, title: 'night city' };
}

/** A flat grade: the picture as it is, for a view that must show the material's own color. */
export function neutralGrade(size = 17): LutData {
	const data = new Float32Array(size ** 3 * 3);
	let at = 0;
	for (let b = 0; b < size; b++)
		for (let g = 0; g < size; g++)
			for (let r = 0; r < size; r++) {
				data[at++] = r / (size - 1);
				data[at++] = g / (size - 1);
				data[at++] = b / (size - 1);
			}
	return { size, data, title: 'neutral' };
}

/** A value inside the display range. */
function clamp01(value: number): number {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.

import { PERMUTATION_DRAW_INDEX, PERMUTATION_HALF, PERMUTATION_TONE_MAP } from '../generated/gpu';
import { LISTED_PERMUTATIONS } from '../generated/shader-permutations';
import type { ShaderVariant, ShaderVariants } from '../generated/shaders';

/** The variant built with exactly the bits of `permutation`, with output for `target`. */
function exactly<Pipeline extends string>(
	shader: ShaderVariants<Pipeline>,
	permutation: number,
	target: 'wgsl' | 'glsl',
): ShaderVariant<Pipeline> | undefined {
	for (const name in shader) {
		const variant = shader[name] as ShaderVariant<Pipeline>;
		if (variant.permutation === permutation && variant[target] !== null) return variant;
	}
	return undefined;
}

/**
 * The permutation words that the pipelines asked for while a recording runs, or undefined when no
 * recording runs. A page records them to list the words that its scene draws with, which a narrowed
 * build then builds.
 */
let recorded: Set<number> | undefined;

/**
 * The bits that a device fixes when it starts, which a recorded word leaves out. One list then
 * serves every device module, and a build makes the word's builds for each value of those bits.
 */
const DEVICE_BITS = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP | PERMUTATION_HALF;

/**
 * @internal Starts collecting the permutation words that the pipelines ask for, until
 * [`stopRecordingPermutations`]. A word that a pipeline found is added once.
 */
export function recordPermutations(): void {
	recorded = new Set();
}

/** @internal Stops collecting, and gives the words collected since, in order. */
export function stopRecordingPermutations(): number[] {
	const words = [...(recorded ?? [])].sort((a, b) => a - b);
	recorded = undefined;
	return words;
}

/**
 * The variant of a shader for a pipeline's permutation word, with output for `target`, or
 * undefined when the shader has none. The word never holds the half precision bit, which the
 * device fixes by the shader module it loads: only the module of a device that draws at half
 * precision holds builds with that bit, and only of the shaders that do color math. So a shader's
 * build with the bit wins where it has one, and the others draw as on any device.
 */
export function variantFor<Pipeline extends string>(
	shader: ShaderVariants<Pipeline>,
	permutation: number,
	target: 'wgsl' | 'glsl',
): ShaderVariant<Pipeline> | undefined {
	// The word's top bit makes JavaScript's `|` negative, so the result turns back to unsigned.
	const half = (permutation | PERMUTATION_HALF) >>> 0;
	const found = exactly(shader, half, target) ?? exactly(shader, permutation, target);
	// A recording lists the words that the scene draws with, so a narrowed build builds them. The
	// bits a device fixes are left out, so one list holds the words of every device module.
	if (found !== undefined) recorded?.add((permutation & ~DEVICE_BITS) >>> 0);
	return found;
}

/**
 * The message for a pipeline whose variant no loaded module holds. A variant that loads on first
 * use is absent until its module arrives, so only a caller that has waited for every module calls
 * this. A set narrowed to a recorded list names the word to add, and a full set names the word
 * that its manifest cannot make.
 */
export function missingVariant(permutation: number, listed = LISTED_PERMUTATIONS !== null): string {
	const word = `0x${(permutation >>> 0).toString(16)}`;
	return listed
		? `the shader set holds only the permutation words that its recording listed, and this pipeline asks for ${word}, which it lacks. Record the scene again so that the word reaches the list, or add the word to the file by hand.`
		: `the shader set has no variant for the permutation word ${word}.`;
}

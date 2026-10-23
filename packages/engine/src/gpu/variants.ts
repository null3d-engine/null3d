// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.

import { PERMUTATION_HALF } from '../generated/gpu';
import { LISTED_PERMUTATIONS, type ShaderVariant, type ShaderVariants } from '../generated/shaders';

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
	// A recording lists the words that the scene draws with, so a narrowed build builds them.
	if (found !== undefined) recorded?.add(permutation >>> 0);
	// A narrowed build made only the words that a recording listed. A pipeline that asks for
	// another one draws nothing in silence, so the miss is named here, where a test or a run that
	// takes the path catches it.
	if (found === undefined && LISTED_PERMUTATIONS !== null) {
		const word = `0x${(permutation >>> 0).toString(16)}`;
		throw new Error(
			`the shader set was built for the permutation words that its recording listed, and this pipeline asks for ${word}, which it lacks. Record the scene again so that the word reaches the list, or add the word to the file by hand.`,
		);
	}
	return found;
}

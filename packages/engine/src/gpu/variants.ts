// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.

import { PERMUTATION_HALF } from '../generated/gpu';
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
	return (
		exactly(shader, permutation | PERMUTATION_HALF, target) ?? exactly(shader, permutation, target)
	);
}

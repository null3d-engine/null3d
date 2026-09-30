// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.

import type { ShaderVariant } from '../generated/shaders';

/** A shader's variants by name, as the generated shader module exports them. */
export type ShaderVariants<Pipeline extends string = string> = Readonly<
	Record<string, ShaderVariant<Pipeline>>
>;

/**
 * The variant of a shader that was built with exactly the bits of `permutation` and has output for
 * `target`, or undefined when the shader has none.
 */
export function variantFor<Pipeline extends string>(
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

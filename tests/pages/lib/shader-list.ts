// Lists the GLSL programs and WGSL modules of a set of shaders, each with its name: for the shaders
// page, which compiles them all or one part of them, and for the tests and the runner, which give
// that page time for each program.
import type {
	GlslProgram,
	ShaderVariants,
} from '../../../packages/engine/src/generated/shaders.ts';

type Shaders = Readonly<Record<string, ShaderVariants>>;

/** Every variant of every shader, named `shader.variant`. */
function variantsOf(shaders: Shaders) {
	return Object.entries(shaders).flatMap(([shaderName, variants]) =>
		Object.entries(variants).map(
			([variantName, variant]) => [`${shaderName}.${variantName}`, variant] as const,
		),
	);
}

/** Every GLSL program, one per pipeline of each variant, named `shader.variant.pipeline`. */
export function glslProgramsOf(shaders: Shaders): (readonly [string, GlslProgram])[] {
	return variantsOf(shaders).flatMap(([name, variant]) =>
		Object.entries(variant.glsl ?? {}).map(
			([pipeline, program]) => [`${name}.${pipeline}`, program] as const,
		),
	);
}

/** Every WGSL module, one per variant, named `shader.variant`. */
export function wgslModulesOf(shaders: Shaders): (readonly [string, string])[] {
	return variantsOf(shaders).flatMap(([name, variant]) =>
		variant.wgsl ? [[name, variant.wgsl.source] as const] : [],
	);
}

/**
 * Part `part` (from 1) of `parts` of a list: every item whose index leaves `part - 1` when divided
 * by `parts`. Neighbors in the list are builds of one shader, so each part gets its share of the
 * large ones.
 */
export function partOf<T>(items: readonly T[], part: number, parts: number): T[] {
	return items.filter((_, i) => i % parts === part - 1);
}

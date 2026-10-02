// Lists the GLSL programs and WGSL modules of a set of shaders, each with its name: for the shaders
// page, which compiles them all, and for the runner, which gives that page time for each program.
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

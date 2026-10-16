// Lists the GLSL programs and WGSL modules of a set of shaders, each with its name: for the shaders
// page, which compiles them, and for the tests and the runner, which give that page time for each
// program.
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
 * The sets of programs and modules that a shaders page can check: every one, those without the
 * coat and sheen bit, those with it, or a sample of those with it. The bit joins every other bit of
 * the lit templates, so its builds are about as many as all the others (D-147). The sample pairs it
 * with the bits that most materials draw with: shadows, row values, masks, normal maps' tangents,
 * tone mapping, the draw index and half precision.
 */
export const SHADER_SETS = ['all', 'base', 'coat', 'coat-sample'] as const;
export type ShaderSet = (typeof SHADER_SETS)[number];

/** The bit whose builds the base set leaves out. */
const SET_APART_BIT = 'coat_sheen';

/** The bits that a build of the coat sample may hold besides the coat. */
const SAMPLE_BITS = [
	'webgl2',
	'receive_shadows',
	'row_values',
	'alpha_mask',
	'vertex_tangent',
	'tone_map',
	'half',
	'draw_index',
];

/**
 * The extension that the builds reading the draw index need to compile. A browser without it cannot
 * compile those builds at all, so the shaders page skips them and names this reason.
 */
export const MULTI_DRAW_EXTENSION = 'WEBGL_multi_draw';

/** The reason that the shaders page gives for a program it skipped, when the browser lacks the extension. */
export const NO_MULTI_DRAW = `no ${MULTI_DRAW_EXTENSION}`;

/** True for an entry that the shaders page skipped for the missing extension, as `name: reason`. */
export const skippedForNoMultiDraw = (entry: string) => entry.endsWith(`: ${NO_MULTI_DRAW}`);

/** True when the program or module named `shader.variant`, with any pipeline after, is in `set`. */
export function inShaderSet(name: string, set: ShaderSet): boolean {
	const variant = name.split('.')[1] ?? '';
	const bits = `_${variant}_`;
	const apart = bits.includes(`_${SET_APART_BIT}_`);
	switch (set) {
		case 'all':
			return true;
		case 'base':
			return !apart;
		case 'coat':
			return apart;
		case 'coat-sample':
			return (
				apart &&
				[SET_APART_BIT, ...SAMPLE_BITS]
					.reduce((rest, bit) => rest.replace(`_${bit}_`, '_'), bits)
					.replace(/_+/g, '') === ''
			);
	}
}

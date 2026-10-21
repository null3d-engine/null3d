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
 * coat and sheen bit, those with it, a sample of those with it, the builds of features that load
 * on first use, or a sample of those. The coat bit joins every other bit of the lit templates, so
 * its builds are about as many as all the others (D-147). The sample pairs it with the bits that
 * most materials draw with: shadows, row values, masks, normal maps' tangents, tone mapping, the
 * draw index and half precision. Safari cannot compile every first-use build inside its shard's
 * time, so it compiles a sample of those too (D-189).
 *
 * The sampled set holds the builds without the coat with both samples, so that the samples share
 * the parts of those builds. A part downloads its share of every module, so a sample in one part
 * of its own downloaded every module, which Safari on CI's Mac could not do inside the page's time.
 */
export const SHADER_SETS = [
	'all',
	'base',
	'coat',
	'coat-sample',
	'first-use',
	'first-use-sample',
	'sampled',
] as const;
export type ShaderSet = (typeof SHADER_SETS)[number];

/** The bit whose builds the base set leaves out. */
const SET_APART_BIT = 'coat_sheen';

/**
 * The bits whose builds load on first use, in a file of their own: the base set leaves them out,
 * since they are the builds that a page downloads only with the feature. The list extends with a
 * feature that adds one; the surfaces that read instances by index and the skins build with the
 * device's own files and stay in the base set.
 */
const FIRST_USE_BITS = ['translucency'];

/** The shaders that load on first use in files of their own, whose builds the base set leaves out. */
const FIRST_USE_SHADERS = [
	'subsurface',
	'subsurface_maps',
	'subsurface_blur',
	'subsurface_blur_ms',
];

/** The bits that a build of the coat sample may hold besides its own feature's. */
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
 * The bits that a build of the first-use sample may hold besides its own feature's. The sample must
 * fit one part of the shaders page, and the translucency builds join many bits, so it takes fewer:
 * the device's own bits with shadows, row values and half precision, alone and together.
 */
const FIRST_USE_SAMPLE_BITS = [
	'webgl2',
	'receive_shadows',
	'row_values',
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

/** The build a program or module name belongs to: `shader.variant`, with any pipeline after it. */
export const variantOf = (name: string) => name.split('.')[1] ?? '';

/** The shader a program or module name belongs to: `shader.variant`, with any pipeline after it. */
export const shaderOf = (name: string) => name.split('.')[0] ?? '';

/** True when the program or module named `shader.variant` belongs to a feature that loads on first use. */
function firstUseBuild(name: string): boolean {
	const bits = `_${variantOf(name)}_`;
	return (
		FIRST_USE_SHADERS.includes(shaderOf(name)) ||
		FIRST_USE_BITS.some((bit) => bits.includes(`_${bit}_`))
	);
}

/** True when `variant` holds only the device's bits and the given own bits. */
const sampledVariant = (
	variant: string,
	own: readonly string[],
	bits: readonly string[] = SAMPLE_BITS,
) =>
	[own, bits]
		.flat()
		.reduce((rest, bit) => rest.replace(`_${bit}_`, '_'), `_${variant}_`)
		.replace(/_+/g, '') === '';

/** The sets whose builds the sampled set holds. */
const SAMPLED_SETS: readonly ShaderSet[] = ['base', 'coat-sample', 'first-use-sample'];

/** True when the build named `variant` is in `set`; a set that needs the shader's name takes one. */
export function variantInShaderSet(variant: string, set: ShaderSet, name = ''): boolean {
	const bits = `_${variant}_`;
	const apart = bits.includes(`_${SET_APART_BIT}_`);
	switch (set) {
		case 'all':
			return true;
		case 'base':
			return !apart && !firstUseBuild(name);
		case 'coat':
			return apart;
		case 'coat-sample':
			return apart && sampledVariant(variant, [SET_APART_BIT]);
		case 'first-use':
			return !apart && firstUseBuild(name);
		case 'first-use-sample':
			return (
				!apart &&
				firstUseBuild(name) &&
				sampledVariant(variant, FIRST_USE_BITS, FIRST_USE_SAMPLE_BITS)
			);
		case 'sampled':
			return SAMPLED_SETS.some((part) => variantInShaderSet(variant, part, name));
	}
}

/** True when the program or module named `shader.variant`, with any pipeline after, is in `set`. */
export const inShaderSet = (name: string, set: ShaderSet): boolean =>
	variantInShaderSet(variantOf(name), set, name);

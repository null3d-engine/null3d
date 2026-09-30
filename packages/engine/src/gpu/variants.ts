// Shader variants by permutation word. The shader build makes a variant of a template's shader for
// each combination of the permutation bits it lists, and records those bits in the variant. Each
// backend builds a render pipeline from the variant that the pipeline's permutation word names.
// A device loads the builds of one device module when it starts. A change of anti-aliasing mode can
// need the builds of another, which the templates then take as well.

import type { DeviceShaders, ShaderVariant, ShaderVariants } from '../generated/shaders';

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

/** A render pipeline template, which names the device module's shader it draws with. */
export interface DeviceTemplate {
	readonly shader: ShaderVariants;
	/** The shader's name in a device module, for a template whose shader loads by device. */
	readonly source?: keyof DeviceShaders;
}

/**
 * Adds the builds of another device module to each template whose shader loads by device, so its
 * pipelines can take the permutation bits of that module.
 */
export function addDeviceShaders<T extends DeviceTemplate>(
	templates: (T | undefined)[],
	shaders: DeviceShaders,
): void {
	for (let id = 0; id < templates.length; id++) {
		const template = templates[id];
		if (template?.source === undefined) continue;
		templates[id] = { ...template, shader: { ...template.shader, ...shaders[template.source] } };
	}
}

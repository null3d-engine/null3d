// The GPU paths, in a file of their own, so code without browser types can name them: the quality
// presets and the docs generator.

/**
 * The GPU path the engine draws with: core WebGPU, WebGPU in compatibility mode on devices that
 * cannot run core WebGPU, or WebGL2.
 *
 * @category api/engine
 */
export type Tier = 'webgpu' | 'webgpu-compat' | 'webgl2';

/**
 * A GPU path that a build can ship: WebGPU, whose shaders are WGSL, or WebGL2, whose shaders are
 * GLSL ES 3.00. WebGPU's compatibility mode draws with the WebGPU shaders.
 *
 * @category api/engine
 */
export type GpuPath = 'webgpu' | 'webgl2';

/** The path whose shaders a tier draws with. */
export function pathOfTier(tier: Tier): GpuPath {
	return tier === 'webgl2' ? 'webgl2' : 'webgpu';
}

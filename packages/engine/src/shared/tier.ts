// The GPU paths, in a file of their own, so code without browser types can name them: the quality
// presets and the docs generator.

/**
 * The GPU path the engine draws with: core WebGPU, WebGPU in compatibility mode on devices that
 * cannot run core WebGPU, or WebGL2.
 *
 * @category api/engine
 */
export type Tier = 'webgpu' | 'webgpu-compat' | 'webgl2';

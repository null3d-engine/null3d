// Engine internals that the repository's own tests and tools use. Not part of the public API.

export type { GlslProgram, ShaderVariant } from './generated/shaders';
export { SHADERS } from './generated/shaders';
export { readbackWebGL2, readbackWebGPU } from './gpu/readback';
export { WebGPUBackend } from './gpu/webgpu/backend';
export { probeCapabilities } from './page/capabilities';
export { coreUrls, startCore } from './shared/core';

// Engine internals that the repository's own tests and tools use. Not part of the public API.

export type {
	DeviceShaders,
	GlslProgram,
	ShaderVariant,
	ShaderVariants,
} from './generated/shaders';
export { everyShader, loadGlslShaders, loadWgslShaders, SHADERS } from './generated/shaders';
export { readbackWebGL2, readbackWebGPU } from './gpu/readback';
export { WebGL2Backend } from './gpu/webgl2/backend';
export type { GlslTemplate } from './gpu/webgl2/programs';
export { WebGPUBackend } from './gpu/webgpu/backend';
export type { RenderTemplate } from './gpu/webgpu/pipelines';
export {
	STAGING_MAX_BYTES,
	STAGING_MIN_BYTES,
	UploadRoutes,
} from './gpu/webgpu/upload-routes';
export { probeCapabilities } from './page/capabilities';
export { loadCore } from './page/loader';
export { stopJobWorkersAt } from './page/stop-jobs';
export type { RigClip, RigData, RigJoint, RigTrack } from './scene/animation';
export { AnimationRig, animateObject, createAnimationRig } from './scene/animation';
export { texCoordsMaterial } from './scene/resources';
export type { TextureUploads } from './scene/textures';
export type { CoreGlue } from './shared/core';
export { coreUrls, startCore } from './shared/core';

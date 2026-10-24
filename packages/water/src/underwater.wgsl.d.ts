// The types of underwater.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly tint: 'vec3f';
		readonly density: 'f32';
		readonly caustics: 'vec3f';
		readonly level: 'f32';
		readonly eye: 'vec3f';
		readonly current: 'vec2f';
		readonly lens: 'f32';
		readonly up: 'vec3f';
		readonly near: 'f32';
		readonly back: 'vec3f';
		readonly right: 'vec3f';
	},
	never
>;
export default shader;

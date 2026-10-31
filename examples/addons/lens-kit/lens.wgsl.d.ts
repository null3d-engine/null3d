// The types of lens.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly aberration: 'f32';
		readonly streak: 'f32';
		readonly grain: 'f32';
		readonly speed: 'f32';
	},
	never
>;
export default shader;

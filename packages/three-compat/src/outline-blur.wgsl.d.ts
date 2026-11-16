// The types of outline-blur.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly direction: 'vec2f';
		readonly kernelRadius: 'f32';
	},
	'source'
>;
export default shader;

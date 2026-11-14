// The types of fft.fallback.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly u0: 'vec4f';
	},
	'source'
>;
export default shader;

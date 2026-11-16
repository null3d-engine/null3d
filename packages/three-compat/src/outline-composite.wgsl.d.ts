// The types of outline-composite.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly settings: 'vec4f';
	},
	'edges' | 'halo'
>;
export default shader;

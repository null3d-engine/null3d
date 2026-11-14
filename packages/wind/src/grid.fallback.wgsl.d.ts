// The types of grid.fallback.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly u0: 'vec4f';
		readonly u1: 'vec4f';
		readonly u2: 'vec4f';
		readonly u3: 'vec4f';
		readonly u4: 'vec4f';
		readonly u5: 'vec4f';
		readonly u6: 'vec4f';
		readonly u7: 'vec4f';
	},
	never
>;
export default shader;

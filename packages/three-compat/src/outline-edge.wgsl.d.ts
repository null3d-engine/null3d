// The types of outline-edge.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<
	{
		readonly visibleColor: 'vec3f';
		readonly hiddenColor: 'vec3f';
	},
	never
>;
export default shader;

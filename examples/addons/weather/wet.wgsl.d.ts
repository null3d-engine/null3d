// The types of wet.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly wet0: 'vec4f';
		readonly wet1: 'vec4f';
		readonly wet2: 'vec4f';
	},
	'wetMirror'
>;
export default shader;

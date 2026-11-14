// The types of ocean.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly tiles: 'vec3f';
		readonly foam: 'f32';
		readonly count: 'f32';
		readonly softness: 'f32';
	},
	'bands' | 'mirror'
>;
export default shader;

// The types of shield.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly time: 'f32';
		readonly rain: 'f32';
		readonly wipe: 'f32';
		readonly since: 'f32';
	},
	never
>;
export default shader;

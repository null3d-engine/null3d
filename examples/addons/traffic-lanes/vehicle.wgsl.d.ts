// The types of vehicle.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly heading: 'f32';
		readonly glow: 'f32';
		readonly size: 'vec3f';
		readonly body: 'vec3f';
		readonly tail: 'vec3f';
		readonly nose: 'vec3f';
		readonly skirt: 'vec3f';
	},
	never
>;
export default shader;

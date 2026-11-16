// The types of floating-leaves-state-draw.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly columns: 'f32';
		readonly layer: 'f32';
		readonly height: 'f32';
		readonly low: 'f32';
		readonly fall: 'f32';
		readonly size: 'f32';
		readonly seed: 'f32';
		readonly spin: 'f32';
		readonly tint: 'vec3f';
	},
	'leaves' | 'leafMap'
>;
export default shader;

// The types of floating-leaves.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly height: 'f32';
		readonly low: 'f32';
		readonly fall: 'f32';
		readonly size: 'f32';
		readonly seed: 'f32';
		readonly drift: 'f32';
		readonly spin: 'f32';
		readonly windBox: 'f32';
		readonly windLayer: 'f32';
		readonly tint: 'vec3f';
	},
	'leafMap' | 'wind' | 'airSettings'
>;
export default shader;

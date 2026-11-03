// The types of grass.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly windBox: 'f32';
		readonly windStrength: 'f32';
		readonly windLayer: 'f32';
		readonly sway: 'f32';
	},
	'wind' | 'airSettings'
>;
export default shader;

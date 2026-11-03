// The types of water.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly ripple: 'f32';
		readonly waveAmplitude: 'f32';
		readonly softness: 'f32';
		readonly viewPath: 'f32';
		readonly caustics: 'vec3f';
		readonly foamOrigin: 'vec2f';
		readonly foamSize: 'vec2f';
		readonly junctionOrigin: 'vec2f';
		readonly junctionSize: 'vec2f';
		readonly bedFromShape: 'f32';
		readonly windBox: 'f32';
		readonly windStrength: 'f32';
		readonly windLayer: 'f32';
	},
	'mirror' | 'foamMap' | 'junctionMap' | 'wind' | 'airSettings'
>;
export default shader;

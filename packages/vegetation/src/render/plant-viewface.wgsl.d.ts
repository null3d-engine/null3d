// The types of plant-viewface.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly windBox: 'f32';
		readonly windStrength: 'f32';
		readonly windSpeed: 'f32';
		readonly windHeading: 'f32';
		readonly windLayer: 'f32';
		readonly swayDistance: 'f32';
		readonly mode: 'f32';
		readonly nearDistance: 'f32';
		readonly displacement: 'f32';
		readonly season: 'f32';
		readonly seasonKind: 'f32';
		readonly matte: 'f32';
	},
	'wind' | 'records' | 'colour' | 'relief' | 'second' | 'third'
>;
export default shader;

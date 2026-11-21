// The types of fall.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly glass: 'vec3f';
		readonly drop: 'f32';
		readonly clear: 'f32';
		readonly softness: 'f32';
		readonly apron: 'f32';
		readonly halfWidth: 'f32';
		readonly fadeBelow: 'f32';
		readonly sinkDepth: 'f32';
		readonly across: 'vec3f';
		readonly glow: 'vec3f';
	},
	never
>;
export default shader;

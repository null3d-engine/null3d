// The types of screen.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly resolution: 'vec2f';
		readonly glow: 'f32';
		readonly power: 'f32';
		readonly subpixels: 'f32';
		readonly scan: 'f32';
		readonly dead: 'f32';
		readonly bootAt: 'f32';
		readonly bootSeconds: 'f32';
	},
	'screen'
>;
export default shader;

// The types of grass.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly wind: 'vec2f';
		readonly sway: 'f32';
	},
	never
>;
export default shader;

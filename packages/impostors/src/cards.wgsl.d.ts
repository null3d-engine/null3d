// The types of cards.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly cells: 'vec4f';
	},
	'impostorColor' | 'impostorSurface'
>;
export default shader;

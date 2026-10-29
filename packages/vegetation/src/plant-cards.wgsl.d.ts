// The types of plant-cards.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly cells: 'vec2f';
		readonly cell: 'vec2f';
		readonly part: 'f32';
		readonly tiles: 'f32';
		readonly crownRadius: 'f32';
		readonly lodThreshold: 'f32';
		readonly tint: 'vec3f';
	},
	'barkColor' | 'barkSurface' | 'leafColor' | 'leafSurface'
>;
export default shader;

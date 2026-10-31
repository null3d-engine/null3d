// The types of plant-cards.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly cells: 'vec2f';
		readonly cell: 'vec2f';
		readonly part: 'f32';
		readonly tiles: 'f32';
		readonly tint: 'vec3f';
		readonly height: 'f32';
		readonly throughLeaf: 'f32';
		readonly swayDistance: 'f32';
		readonly branches: 'f32';
		readonly windBox: 'f32';
		readonly windStrength: 'f32';
		readonly windLayer: 'f32';
		readonly crownCenter: 'vec3f';
		readonly crownBend: 'f32';
		readonly crownRadius: 'f32';
		readonly lodThreshold: 'f32';
	},
	'barkColor' | 'barkSurface' | 'leafColor' | 'leafSurface' | 'branchData' | 'wind'
>;
export default shader;

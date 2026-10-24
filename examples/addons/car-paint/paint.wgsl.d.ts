// The types of paint.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly seamSpacing: 'vec2f';
		readonly flakeCells: 'vec2f';
		readonly weaveCells: 'vec2f';
		readonly flakeTilt: 'f32';
		readonly flakeSpread: 'f32';
		readonly seamWidth: 'f32';
		readonly seamShade: 'f32';
		readonly weaveShine: 'f32';
	},
	never
>;
export default shader;

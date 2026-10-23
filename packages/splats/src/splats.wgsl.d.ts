// The types of splats.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<{
	readonly extent: 'f32';
	readonly blur: 'f32';
	readonly softness: 'f32';
	readonly cutoff: 'f32';
}>;
export default shader;

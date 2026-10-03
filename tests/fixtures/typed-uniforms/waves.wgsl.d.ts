// The types of waves.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<{
	readonly tint: 'vec3f';
	readonly height: 'f32';
	readonly count: 'u32';
	readonly shift: 'vec2f';
}>;
export default shader;

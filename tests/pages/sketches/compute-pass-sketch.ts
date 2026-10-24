// A compute pass whose storage texture a material samples in the same frame: four colored
// quadrants that the pass writes. The pass declares a feature description, so its texture is the
// description's output. WebGPU runs the compute shader, and WebGL2 runs the fragment form that
// the options give it, so both GPU paths draw the same picture. The camera stands still, and
// tone mapping is off, so the picture is the texture itself.
import { defineFeature, defineSketch } from '@null3d/engine';

/**
 * The compute shader: one color for each quadrant of the target. Its block is the one that the
 * engine writes for a compute pass: the render size, the clock, the inverse of the camera's
 * projection, the pass's eight vectors of values, the target's size and two spares.
 */
const QUADRANTS = /* wgsl */ `
struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var field: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    // The target's first row is the bottom of the image, which a material samples at v = 0.
    let left = f32(id.x) < f32(size.x) * 0.5;
    let bottom = f32(id.y) < f32(size.y) * 0.5;
    var color = vec4f(0.85, 0.2, 0.15, 1.0);
    if (left && bottom) { color = vec4f(0.15, 0.65, 0.3, 1.0); }
    if (!left && bottom) { color = vec4f(0.15, 0.35, 0.8, 1.0); }
    if (!left && !bottom) { color = vec4f(0.9, 0.75, 0.1, 1.0); }
    textureStore(field, vec2i(id.xy), 0, color);
}
`;

/** The fragment form: the same quadrants for each pixel of a full-screen pass's texture. */
const QUADRANTS_FRAGMENTS = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    // The pass texture holds its first row at the bottom, and input.uv counts from the top left.
    let left = input.uv.x < 0.5;
    let bottom = 1.0 - input.uv.y < 0.5;
    var color = vec4f(0.85, 0.2, 0.15, 1.0);
    if (left && bottom) { color = vec4f(0.15, 0.65, 0.3, 1.0); }
    if (!left && bottom) { color = vec4f(0.15, 0.35, 0.8, 1.0); }
    if (!left && !bottom) { color = vec4f(0.9, 0.75, 0.1, 1.0); }
    return color;
}
`;

export default defineSketch(({ scene, materials, geometry, textures, render, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#101418');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 20, position: [0, 0, 3] }),
	);
	const field = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'quadrants',
			frame: 'background',
			kind: 'compute',
			outputs: { quadrants: { default: 'black' } },
		}),
		wgsl: QUADRANTS,
		fallback: { wgsl: QUADRANTS_FRAGMENTS },
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 4, height: 2.25 }),
		material: materials.unlit({ map: textures.fromPass(field) }),
	});
	return {};
});

// The compute path's cost, for the effect cost page: a field of quads whose vertex offset reads a
// texture that a compute pass writes in the same frame, so the pass, the vertex reads and the
// shadow caster's reads all belong to the feature. The 'compute' message turns the pass on, shows
// the quads that read it and posts 'settled' once their pipelines are built; 'compute-off' turns
// the pass off and shows the same field with the standard material, which reads nothing.
// ?scale= draws at that render scale, and ?fixed holds it with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineFeature, defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
/** Texels on each side of the pass's texture, which both the offset and its memory follow. */
const FIELD = 512;

/** A height field that scrolls: enough work per texel for the pass's cost to show. */
const HEIGHT = /* wgsl */ `
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
@group(0) @binding(1) var height: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = vec2u(block.drawn.xy);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let p = vec2f(id.xy) / vec2f(size) * 12.0;
    let t = block.clock.x;
    let h = sin(p.x * 1.7 + t) * cos(p.y * 1.3 - t * 0.7) + 0.4 * sin((p.x + p.y) * 3.1 + t * 2.0);
    textureStore(height, vec2i(id.xy), 0, vec4f(0.5 + 0.5 * h, 0.0, 0.0, 1.0));
}
`;

/** The same field for each pixel, which WebGL2 runs in the pass's place. */
const HEIGHT_FRAGMENTS = /* wgsl */ `
fn effect(input: EffectInput) -> vec4f {
    let p = vec2f(input.uv.x, 1.0 - input.uv.y) * 12.0;
    let t = input.time;
    let h = sin(p.x * 1.7 + t) * cos(p.y * 1.3 - t * 0.7) + 0.4 * sin((p.x + p.y) * 3.1 + t * 2.0);
    return vec4f(0.5 + 0.5 * h, 0.0, 0.0, 1.0);
}
`;

/** A vertex offset that lifts each vertex by the texel that its coordinates name. */
const LIFTED = /* wgsl */ `
var heights: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    let texel = clamp(vec2i(input.uv * 512.0), vec2i(0), vec2i(511));
    let height = textureLoad(heights, texel, 0).r - 0.5;
    return vec3f(0.0, 0.0, height * 1.6);
}
`;
// The Vite plugin compiles tagged WGSL at build time, so the offset holds the texture's size as
// literals.
if (FIELD !== 512) throw new Error('the offset holds the texture size as literals: update it');

export default defineSketch(({ scene, materials, geometry, textures, render, quality, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#6d8296');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 100,
			position: [0, 1.5, 15],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -1.5, -2], color: '#ffffff', intensity: 2.5 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	const field = render.addPass({
		kind: 'compute',
		description: defineFeature({
			name: 'computeCostHeights',
			frame: 'background',
			kind: 'compute',
			outputs: { computeCostHeights: { default: 'black' } },
		}),
		wgsl: HEIGHT,
		size: [FIELD, FIELD],
		workgroupSize: [8, 8, 1],
		fallback: { wgsl: HEIGHT_FRAGMENTS },
	});
	const lifted = materials.shader({
		wgsl: LIFTED,
		textures: { heights: textures.fromPass(field) },
		color: '#9a8360',
		roughness: 0.6,
		doubleSided: true,
	});
	const still = materials.standard({ color: '#9a8360', roughness: 0.6, doubleSided: true });
	const mesh = geometry.plane({ width: 16, height: 10, widthSegments: 96, heightSegments: 64 });
	const moving = scene.createMesh({ mesh, material: lifted });
	const plain = scene.createMesh({ mesh, material: still });
	plain.setVisible(false);
	page.onMessage((message) => {
		if (message !== 'compute' && message !== 'compute-off') return;
		const on = message === 'compute';
		render.setPassEnabled(field, on);
		moving.setVisible(on);
		plain.setVisible(!on);
		if (on) void scene.warmUp().then(() => page.post('settled', {}));
	});
});

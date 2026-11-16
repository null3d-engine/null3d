// A frame crowded with compute passes, chained so that each pass reads the one before, and one read
// of each pass after the frame drew. The point is the number of views: enough of them that a builder
// which numbers a view's buffers from a low constant gives one of them the id that a read lands in,
// and the read then maps that view's shorter buffer. Each pass writes a red of its own and counts
// the passes before it in green, so a read that answers with another pass's texture, or with none,
// shows at once.
import { defineFeature, defineSketch, type RenderPass, type Texture } from '@null3d/engine';

/** The passes that the frame adds: enough views that the tenth view's ids reach a read's. */
const PASSES = 12;
/** The texels across that each pass writes, and the one that the read takes. */
const SIZE = 4;

const COMPUTE = /* wgsl */ `
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
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(0) var source: texture_2d_array<f32>;

@compute @workgroup_size(4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= u32(block.drawn.x) || id.y >= u32(block.drawn.y)) { return; }
    let carried = textureLoad(source, vec2i(id.xy), i32(id.z), 0).g;
    textureStore(output, id.xy, id.z, vec4f(block.u0.x, carried + 1.0, 0.0, 1.0));
}
`;

const FRAGMENT = /* wgsl */ `
struct Uniforms {
    u0: vec4f,
}

var source: texture_2d_array<f32>;

fn effect(input: EffectInput) -> vec4f {
    let cell = vec2i(floor(vec2f(input.uv.x, 1.0 - input.uv.y) * input.size));
    let carried = textureLoad(source, cell, i32(input.layer), 0).g;
    return vec4f(uniforms.u0.x, carried + 1.0, 0.0, 1.0);
}
`;

export default defineSketch((ctx) => {
	const { page, render, scene, textures, time } = ctx;
	const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.setBackground('#000000');
	const empty = textures.fromData({
		width: SIZE,
		height: SIZE,
		format: 'rgba16float',
		data: new Float32Array(SIZE * SIZE * 4),
		colorSpace: 'linear',
		filter: 'nearest',
	});
	const passes: RenderPass[] = [];
	let previous: Texture = empty;
	for (let k = 0; k < PASSES; k++) {
		const name = `crowded${k}`;
		passes.push(
			render.addPass({
				kind: 'compute',
				description: defineFeature({
					name,
					frame: 'background',
					kind: 'compute',
					outputs: { [name]: { default: 'black' } },
				}),
				wgsl: COMPUTE,
				fallback: { wgsl: FRAGMENT },
				size: [SIZE, SIZE],
				values: [(k + 1) / 16],
				textures: [previous],
				name,
			}),
		);
		previous = textures.fromPass(passes[k] as RenderPass);
	}
	let asked = false;
	return {
		onUpdate() {
			if (asked || time.now < 1.5) return;
			asked = true;
			void Promise.all(
				passes.map((pass) => render.readPass(pass, { x: 0, y: 0, width: 1, height: 1 })),
			).then((found) =>
				page.post('read', {
					values: found.map((one) => one.data[0] as number),
					counts: found.map((one) => one.data[1] as number),
					frames: found.map((one) => one.frames),
				}),
			);
		},
	};
});

// The compute-side proof of M3-E9: an add-on's compute pass writes the instance draw's count word
// and its per-instance rows, and the engine draws exactly what the GPU wrote. The page fills
// nothing on the CPU: the field of quads exists only because the compute shader wrote it.
// WebGL2 has no compute pass, so the page refuses to run there.
import { defineFeature, defineSketch } from '@null3d/engine';

/** The most instances that the draw holds. The shader writes and counts 42 of them. */
const CAPACITY = 64;

/** The compute shader: one quad per invocation, then the count. */
const FILL = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    const k = id.x;
    if (k >= 42u) {
        return;
    }
    const columns = 7u;
    const column = f32(k % columns);
    const row = f32(k / columns);
    const x = (column - 3.0) * 0.9;
    const y = (row - 2.0) * 0.9;
    const size = 0.14 + 0.02 * f32(k % 5u);
    const at = k * 4u;
    instances[at] = vec4f(size, 0.0, 0.0, x);
    instances[at + 1u] = vec4f(0.0, size, 0.0, y);
    instances[at + 2u] = vec4f(0.0, 0.0, size, 0.0);
    instances[at + 3u] = vec4f(0.0);
    if (k == 0u) {
        atomicStore(&counts, 42u);
    }
}
`;

/** The draw shader: a disc with a rim in the quad that each instance places. */
const QUADS = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, finish, find_instance}
#import null3d::vertex::mesh_position

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) local: vec3f,
}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> Varyings {
    const found = find_instance(i);
    const p = mesh_position(position);
    var out: Varyings;
    out.clip = clip_position(found, p);
    out.local = p;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    const away = length(in.local.xy);
    if (away > 1.0) {
        discard;
    }
    const rim = smoothstep(0.72, 0.95, away);
    const tint = vec3f(0.35, 0.72, 0.95);
    const color = mix(tint * 0.45, tint * 1.6, rim);
    return finish(color, in.clip.xy);
}
`;

export default defineSketch(async ({ scene, render, engine }) => {
	if (engine.capabilities.tier === 'webgl2')
		throw new Error('the compute-side proof of M3-E9 runs on WebGPU alone');
	scene.setBackground('#0b0e14');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 50,
			position: [0, 0, 9],
			target: [0, 0, 0],
		}),
	);
	const compute = defineFeature({
		name: 'quad-fill',
		frame: 'opaque',
		kind: 'compute',
		band: 'before',
	});
	const drawFeature = defineFeature({
		name: 'quad-field',
		frame: 'opaque',
		kind: 'draw',
		band: 'normal',
		views: ['main'],
	});
	const draw = await scene.addFeatureInstances(drawFeature, {
		shader: QUADS,
		vertices: {
			positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
		},
		capacity: CAPACITY,
		count: 0,
	});
	// The add-on's own write: the count word and every per-instance row come from this dispatch,
	// and the frame draws what it wrote.
	render.addPass({
		kind: 'compute',
		description: compute,
		wgsl: FILL,
		buffers: [draw.counts, draw.instances],
		dispatch: [1, 1, 1],
	});
});

// The shadow-side proof of M3-E9: an add-on's compute pass writes the instance draw's count word
// and its rows, and the draw's shadow follows that count, not the page's. The page sets the count
// to the whole capacity and the compute fills every row, so a view that drew the page's count would
// show discs, and their shadows, in the part of the field that the count leaves empty. WebGL2 has
// no compute pass, so the page refuses to run there.
import { defineFeature, defineSketch } from '@null3d/engine';

/** The most instances that the draw holds, and the rows that the compute shader fills. */
const CAPACITY = 64;

/** The compute shader: one standing disc per invocation, then the count. It fills every row of
 * the capacity and counts the first six rows of seven, which leaves the last two rows empty. */
const FILL = /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let k = id.x;
    if (k >= 64u) {
        return;
    }
    let columns = 7u;
    let column = f32(k % columns);
    let row = f32(k / columns);
    let x = (column - 3.0) * 0.95;
    let z = (row - 3.5) * 1.15;
    let size = 0.34;
    let at = k * 4u;
    // The disc keeps its own plane, so it stands on the ground with its face toward the camera and
    // the sun throws its shadow out over the open ground in front of it.
    instances[at] = vec4f(size, 0.0, 0.0, x);
    instances[at + 1u] = vec4f(0.0, size, 0.0, size);
    instances[at + 2u] = vec4f(0.0, 0.0, size, z);
    instances[at + 3u] = vec4f(0.0);
    if (k == 0u) {
        atomicStore(&counts, 42u);
    }
}
`;

/** The draw shader: a bright-rimmed disc in the shape that each instance places. */
const DISCS = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, finish, find_instance}
#import null3d::vertex::mesh_position

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) local: vec3f,
}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> Varyings {
    let found = find_instance(i);
    let p = mesh_position(position);
    var out: Varyings;
    out.clip = clip_position(found, p);
    out.local = p;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    let away = length(in.local.xy);
    let rim = smoothstep(0.7, 1.0, away);
    let tint = vec3f(0.42, 0.78, 0.98);
    return finish(mix(tint * 0.55, tint * 1.7, rim), in.clip.xy);
}
`;

/** A disc of `segments` triangles in its own xy plane, which an instance stands upright. */
function disc(segments: number): { positions: Float32Array; indices: Uint16Array } {
	const positions = new Float32Array((segments + 1) * 3);
	const indices = new Uint16Array(segments * 3);
	for (let k = 0; k < segments; k++) {
		const angle = (k / segments) * Math.PI * 2;
		positions[(k + 1) * 3] = Math.cos(angle);
		positions[(k + 1) * 3 + 1] = Math.sin(angle);
		indices[k * 3 + 1] = k + 1;
		indices[k * 3 + 2] = ((k + 1) % segments) + 1;
	}
	return { positions, indices };
}

export default defineSketch(async ({ scene, render, engine, geometry, materials }) => {
	if (engine.capabilities.tier === 'webgl2')
		throw new Error('the shadow-side proof of M3-E9 runs on WebGPU alone');
	scene.setBackground('#141821');
	// A low sun that shines toward the camera, so each disc throws its shadow out over the open
	// ground in front of it, where the picture reads it.
	scene.createDirectionalLight({
		direction: [0.45, -0.55, 0.62],
		color: [1, 0.95, 0.88],
		intensity: 3.2,
		castShadows: true,
	});
	scene.createAmbientLight({ color: [0.55, 0.62, 0.78], intensity: 0.45 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.1,
			far: 60,
			position: [0, 5.2, 9.4],
			target: [0, 0.5, 0],
		}),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 26, height: 0.2, depth: 26 }),
		material: materials.standard({ color: [0.38, 0.41, 0.46] }),
		position: [0, -0.1, 0],
		castShadows: false,
		receiveShadows: true,
	});
	// A post beside the field, whose shadow proves that the sun's shadows reach this ground at all.
	scene.createMesh({
		mesh: geometry.box({ width: 0.5, height: 2.6, depth: 0.5 }),
		material: materials.standard({ color: [0.78, 0.46, 0.32] }),
		position: [-4.6, 1.3, -1.2],
		castShadows: true,
		receiveShadows: true,
	});
	const compute = defineFeature({
		name: 'disc-fill',
		frame: 'opaque',
		kind: 'compute',
		band: 'before',
	});
	const drawFeature = defineFeature({
		name: 'disc-field',
		frame: 'opaque',
		kind: 'draw',
		band: 'normal',
		views: ['main'],
	});
	const draw = await scene.addComputeInstances(drawFeature, {
		shader: DISCS,
		vertices: { ...disc(24), computeNormals: true },
		capacity: CAPACITY,
		// A disc is a thin surface that the camera and the sun see from either side.
		doubleSided: true,
		// The page's count is the whole capacity. A view that drew it would fill the two empty rows
		// of the field, because the compute fills every row of the capacity.
		count: CAPACITY,
	});
	draw.object.setCastShadows(true);
	render.addPass({
		kind: 'compute',
		description: compute,
		wgsl: FILL,
		buffers: [draw.counts, draw.instances],
		dispatch: [1, 1, 1],
	});
});

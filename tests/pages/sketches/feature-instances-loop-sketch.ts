// A draw whose count the GPU writes, which a page updates every frame, for the test that checks
// that its per-frame calls allocate nothing. The engine runs this sketch on the page's own thread,
// so the loop is a function on the page's global object that the test calls. Each iteration writes
// the per-instance rows and the count, as a page that moves a field of instances does each frame.
import { defineFeature, defineSketch } from '@null3d/engine';

/** The page's global object, which holds the loop. */
const scope = globalThis as { __null3dFeatureInstancesLoop?: (iterations: number) => void };

/** The floats of one instance: three world-matrix rows, then the ids. */
const ROW_FLOATS = 16;

/** The most instances that the draw holds. */
const CAPACITY = 64;

/** The shader: one quad of the shape, placed by the instance's world matrix. */
const QUADS = /* wgsl */ `
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
    if (length(in.local.xy) > 1.0) {
        discard;
    }
    return finish(vec3f(0.35, 0.72, 0.95), in.clip.xy);
}
`;

export default defineSketch(async ({ scene }) => {
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
	const description = defineFeature({
		name: 'quad-field',
		frame: 'opaque',
		kind: 'draw',
		views: ['main'],
	});
	const draw = await scene.addComputeInstances(description, {
		shader: QUADS,
		vertices: {
			positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
			computeNormals: true,
		},
		capacity: CAPACITY,
		count: CAPACITY,
	});
	// A field of quads, each at its own place, so the rows that the loop writes are real ones.
	const values = new Float32Array(CAPACITY * ROW_FLOATS);
	for (let k = 0; k < CAPACITY; k++) {
		const at = k * ROW_FLOATS;
		// A square facing the camera: a diagonal scale, then the place.
		values[at] = 0.2;
		values[at + 5] = 0.2;
		values[at + 10] = 1;
		values[at + 3] = (k % 8) - 3.5;
		values[at + 7] = Math.floor(k / 8) - 3.5;
	}
	draw.setInstances(values, CAPACITY);
	scope.__null3dFeatureInstancesLoop = (iterations) => {
		for (let i = 0; i < iterations; i++) {
			// A count that moves, so the write reaches the engine and is not optimized away.
			const count = 1 + (i % (CAPACITY - 1));
			draw.setInstances(values, count);
			draw.setCount(count);
		}
	};
});

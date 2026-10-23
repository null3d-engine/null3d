// Draws whose instance count the GPU writes, held at 0 seconds: a field of quads that an add-on's
// feature description declares, with the per-instance rows that the page fills. On WebGPU the
// count word reaches the draw's indirect arguments through the engine's copy; on WebGL2 the same
// rows fill an instance batch. Every GPU path and thread mode must draw the same picture.
import { defineFeature, defineSketch } from '@null3d/engine';

/** The shader: one quad of the shape, placed by the instance's world matrix. */
const QUADS = /* wgsl */ `
#import null3d::mesh::{InstanceIn, clip_position, finish, find_instance}
#import null3d::vertex::mesh_position

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) relative: vec3f,
}

@vertex
fn vs(@location(0) position: vec3f, i: InstanceIn) -> Varyings {
    const found = find_instance(i);
    const p = mesh_position(position);
    var out: Varyings;
    out.clip = clip_position(found, p);
    out.relative = p;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    // A disc with a bright rim in each quad, so a missing or a repeated instance shows.
    const away = length(in.relative.xy);
    if (away > 1.0) {
        discard;
    }
    const rim = smoothstep(0.72, 0.95, away);
    const tint = vec3f(0.35, 0.72, 0.95);
    const color = mix(tint * 0.45, tint * 1.6, rim);
    return finish(color, in.clip.xy);
}
`;

/** The floats of one instance: three world-matrix rows, then the ids. */
const ROW_FLOATS = 16;

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
	const columns = 9;
	const rows = 5;
	const live = columns * rows;
	const draw = await scene.addFeatureInstances(description, {
		shader: QUADS,
		vertices: {
			positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
			indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
		},
		capacity: live,
		count: live,
	});
	// Each quad at its own place, with its own size, so the field reads at a glance.
	const values = new Float32Array(live * ROW_FLOATS);
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const k = row * columns + column;
			const x = (column - (columns - 1) / 2) * 0.9;
			const y = (row - (rows - 1) / 2) * 0.9;
			const size = 0.16 + 0.02 * (k % 5);
			const at = k * ROW_FLOATS;
			values.set([size, 0, 0, x, 0, size, 0, y, 0, 0, size, 0], at);
		}
	}
	draw.setInstances(values, live);
	// Three fewer than the rows that the page filled: the picture shows the count alone deciding
	// what draws, on both paths.
	draw.setCount(live - 3);
});

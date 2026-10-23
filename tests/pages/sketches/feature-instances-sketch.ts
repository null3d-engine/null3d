// An instanced draw that an add-on declares with a feature description, held at 0 seconds: two
// grids of discs, an opaque one behind and a blended one in front. Each draw gives its shader, the
// vertex data of the one shape that every instance draws, and a capacity; the page fills a row of
// positions and scales for each instance. The shader reads each instance's transform through
// `InstanceIn`. The camera stands still, so every GPU path and thread mode draws the same frame.
import { defineFeature, defineSketch, type MeshArrays } from '@null3d/engine';

/** A soft disc, cut from the instance's square and scaled by the instance's transform. */
const DISCS = /* wgsl */ `
#import null3d::builtins::{fill_builtins}
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish}
#import null3d::vertex::mesh_uv

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs(@location(0) position: vec3f, @location(2) uv: vec2f, i: InstanceIn) -> Varyings {
    let found = find_instance(i);
    var out: Varyings;
    out.clip = clip_position(found, position);
    out.uv = mesh_uv(uv);
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    let away = length(in.uv - vec2f(0.5)) * 2.0;
    if (away > 1.0) {
        discard;
    }
    let edge = smoothstep(1.0, 0.75, away);
    return finish(vec3f(0.95, 0.5, 0.2) * edge, in.clip.xy);
}
`;

/** One square, a unit wide and high around its origin, with its texture coordinates. */
function quad(): MeshArrays {
	return {
		positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
		indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
	};
}

/** A grid of `columns` by `rows` instances, each with its own place and size. */
function fill(
	positions: Float32Array,
	scales: Float32Array,
	columns: number,
	rows: number,
	[startX, startY]: readonly [number, number],
	[stepX, stepY]: readonly [number, number],
	depth: (k: number) => number,
	size: (k: number) => number,
): void {
	let k = 0;
	for (let y = 0; y < rows; y++)
		for (let x = 0; x < columns; x++) {
			positions[k * 3] = startX + x * stepX;
			positions[k * 3 + 1] = startY + y * stepY;
			positions[k * 3 + 2] = depth(k);
			scales[k * 3] = size(k);
			scales[k * 3 + 1] = size(k);
			scales[k * 3 + 2] = size(k);
			k++;
		}
}

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
	const behind = defineFeature({
		name: 'instances-behind',
		frame: 'opaque',
		kind: 'draw',
		views: ['main'],
	});
	const inFront = defineFeature({
		name: 'instances-in-front',
		frame: 'transparent',
		kind: 'draw',
		band: 'normal',
		order: 0,
		views: ['main'],
	});
	const opaque = await scene.addFeatureInstances(behind, {
		shader: DISCS,
		vertices: quad(),
		capacity: 24,
	});
	const blended = await scene.addFeatureInstances(inFront, {
		shader: DISCS,
		vertices: quad(),
		capacity: 15,
		alphaMode: 'blend',
		depthWrite: false,
		doubleSided: true,
	});
	fill(
		opaque.positions,
		opaque.scales,
		6,
		4,
		[-2.5, -1.5],
		[1, 1],
		(k) => -2 + (k % 5) * 0.35,
		() => 0.9,
	);
	fill(
		blended.positions,
		blended.scales,
		5,
		3,
		[-2, -0.9],
		[1.2, 1],
		(k) => 1 + (k % 3) * 0.5,
		() => 1.4,
	);
});

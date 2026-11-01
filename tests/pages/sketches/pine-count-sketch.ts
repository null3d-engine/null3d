// A stand of pines drawn from the count word that a compute pass writes. The page writes each pine's
// world matrix once, and the pass writes how many draw. On WebGPU the page's own count stays at the
// capacity, so the pines on screen can only be the ones that the GPU counted. WebGL2 has no compute
// pass, so the page's count draws them there. The `pines` word names the count.
import { defineFeature, defineSketch, mat4, type QualityPreset, quat } from '@null3d/engine';
import { random } from '../../../examples/lib/procedural';

/** Pines at each preset, and the most that the stand holds. */
const PINES: Record<QualityPreset, number> = { low: 90, medium: 200, high: 320, ultra: 400 };
const CAPACITY = 400;

const pinesSwitch = Number(new URL(import.meta.url).searchParams.get('pines') ?? Number.NaN);
const forced = Number.isInteger(pinesSwitch) && pinesSwitch >= 0 ? pinesSwitch : undefined;

/** The pines' material: the standard surface, unchanged. */
const SURFACE = /* wgsl */ `
fn surface(input: SurfaceInput) -> Surface {
    return defaultSurface(input);
}
`;

/** The compute shader that writes the count word from the first number of the pass's values. */
const COUNT = /* wgsl */ `
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
@group(0) @binding(1) var<storage, read_write> counts: atomic<u32>;

@compute @workgroup_size(1)
fn main() {
    atomicStore(&counts, u32(block.u0.x));
}
`;

/** A cone one unit high and half a unit wide, standing on the origin, in the pine's green. */
function cone() {
	const sides = 8;
	const positions = [0, 1, 0];
	const colors = [0.05, 0.16, 0.08];
	const uvs = [0.5, 1];
	const indices: number[] = [];
	for (let k = 0; k < sides; k++) {
		const a = (k / sides) * Math.PI * 2;
		positions.push(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
		colors.push(0.05, 0.16, 0.08);
		uvs.push(k / sides, 0);
		indices.push(0, 1 + ((k + 1) % sides), 1 + k);
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

export default defineSketch(async ({ scene, materials, geometry, render, engine, quality }) => {
	scene.setBackground('#9fc0dd');
	scene.createDirectionalLight({ direction: [-0.45, -1, -0.3], intensity: 2.8 });
	scene.createAmbientLight({ intensity: 0.5 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: [0, 34, 62], target: [0, 2, 0], far: 400 }),
	);
	scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#55613f', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	const pines = await scene.addComputeInstances(
		defineFeature({
			name: 'pine-count-pines',
			frame: 'opaque',
			kind: 'draw',
			band: 'normal',
			views: ['main'],
		}),
		{
			shader: SURFACE,
			vertices: cone(),
			capacity: CAPACITY,
			count: CAPACITY,
			color: '#ffffff',
			roughness: 0.9,
			vertexColors: true,
		},
	);
	const next = random(149);
	const rows = new Float32Array(CAPACITY * 16);
	const matrix = mat4.create();
	const turn = quat.identity(quat.create());
	for (let k = 0; k < CAPACITY; k++) {
		const a = next() * Math.PI * 2;
		const r = 8 + 42 * next() ** 0.7;
		const size = 6 + 7 * next();
		mat4.compose(matrix, [Math.cos(a) * r, 0, Math.sin(a) * r], turn, [size, size, size]);
		// A row of the engine's instance buffer: the matrix's three rows, each translation in its
		// fourth number, then the row's ids.
		rows.set(
			[
				matrix[0] as number,
				matrix[4] as number,
				matrix[8] as number,
				matrix[12] as number,
				matrix[1] as number,
				matrix[5] as number,
				matrix[9] as number,
				matrix[13] as number,
				matrix[2] as number,
				matrix[6] as number,
				matrix[10] as number,
				matrix[14] as number,
				0,
				0,
				0,
				0,
			],
			k * 16,
		);
	}
	pines.setInstances(rows, CAPACITY);

	const drawn = Math.min(forced ?? PINES[quality.preset], CAPACITY);
	if (engine.capabilities.tier === 'webgl2') pines.setCount(drawn);
	else
		render.addPass({
			kind: 'compute',
			description: defineFeature({
				name: 'pine-count-count',
				frame: 'opaque',
				kind: 'compute',
				band: 'before',
			}),
			wgsl: COUNT,
			buffers: [pines.counts, pines.instances],
			dispatch: [1, 1, 1],
			values: [drawn],
		});
	return {};
});

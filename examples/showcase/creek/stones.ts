// The creek's stones: mossy rocks along the water's edge, in the stream and on the banks, pebbles on
// the bed, and the cave mouth, a model built in Blender. Each kind of rock is an instance batch whose rows cast
// and receive the sun's shadows. The rocks are noise-shaped spheres with a texture made in code, and
// moss on the parts that face up. The pebbles are small and lie under the water, so they cast none.
import {
	type MeshArrays,
	math,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { Noise, random, rock, type TexelSample, textureSet, within } from '../../lib/procedural';
import { fromStream, groundHeight, streamHalf, streamZ } from './land';
import { type Part, placed } from './models';

/** Pebbles at each preset, over all their batches. */
const PEBBLES: Record<QualityPreset, number> = { low: 1200, medium: 3000, high: 4800, ultra: 6000 };
/** The shapes of rock, each one batch. */
const ROCK_SHAPES = 4;
/**
 * The cave mouth: the middle of its foot, the reach of its rock around it, and its turn about y.
 * The model opens toward +z; the turn faces it down the valley, toward the camera's usual view.
 */
export const CAVE = { x: 11, z: streamZ(11) - 6.2, reach: 3.8, yaw: -0.9 };

const noise = new Noise(31);
const { smoothstep } = math;

/** The rock's texel: gray stone with darker cracks and light grains, in a near-white tone. */
function rockTexel(u: number, v: number, out: TexelSample): void {
	const broad = noise.fbm2(u * 8, v * 8, 5, 8);
	const crack = 1 - smoothstep(Math.abs(noise.value2(u * 12, v * 12, 12)), 0, 0.06);
	const grain = noise.value2(u * 96, v * 96, 96);
	out.height = broad * 8 - crack * 3 + grain;
	const tone = 0.8 + 0.2 * broad - 0.35 * crack + 0.06 * grain;
	out.r = tone;
	out.g = tone * 0.98;
	out.b = tone * 0.95;
	out.roughness = 0.75 + 0.2 * broad;
	out.occlusion = 1 - 0.5 * crack;
}

/** Gives a rock's vertices colors: lichen-flecked gray, and moss where the rock faces up. */
function mossy(arrays: MeshArrays, seed: number): MeshArrays {
	const positions = arrays.positions as Float32Array;
	const colors = new Float32Array(positions.length);
	const local = new Noise(seed);
	for (let v = 0; v < positions.length / 3; v++) {
		const [x, y, z] = [
			positions[v * 3] as number,
			positions[v * 3 + 1] as number,
			positions[v * 3 + 2] as number,
		];
		const up = y / Math.hypot(x, y, z);
		const moss = smoothstep(up + 0.35 * local.value3(x * 4, y * 4, z * 4), 0.35, 0.75);
		const shade = 0.75 + 0.25 * local.value3(x * 9, y * 9, z * 9);
		colors.set(
			[shade * (0.32 - 0.24 * moss), shade * (0.31 - 0.13 * moss), shade * (0.29 - 0.25 * moss)],
			v * 3,
		);
	}
	return { ...arrays, colors };
}

/** A turn about y by an angle, as the four numbers of a quaternion. */
const yaw = (angle: number) => quat.fromEuler(quat.create(), 0, angle, 0);

/** Where rocks stand: a few in the stream, a line along each edge, and some on the banks. */
function rockPlaces(): { x: number; z: number; size: number }[] {
	const next = random(41);
	const places: { x: number; z: number; size: number }[] = [];
	for (let k = 0; k < 70; k++) {
		const x = -24 + 48 * next();
		const kind = next();
		const side = next() < 0.5 ? -1 : 1;
		const across =
			kind < 0.15 ? next() * 0.5 : kind < 0.75 ? 0.82 + 0.3 * next() : 1.4 + 5 * next();
		const size =
			kind < 0.15 ? 0.22 + 0.2 * next() : kind < 0.75 ? 0.18 + 0.38 * next() : 0.2 + 0.5 * next();
		places.push({ x, z: streamZ(x) + side * across * streamHalf(x), size });
	}
	return places;
}

/** The stones, pebbles and cave mouth, and a test of whether grass may grow at a point. */
export function createStones(
	{ scene, geometry, materials, textures }: SketchContext,
	detail: number,
	textureSize: number,
	cave: Part,
): { clear(x: number, z: number): boolean; fit(preset: QualityPreset): void } {
	const maps = textureSet(textures, textureSize, rockTexel);
	const stone = materials.standard({
		vertexColors: true,
		roughness: 1,
		...maps,
		uvTransform: { repeat: [2, 1] },
	});
	const next = random(43);
	const places = rockPlaces();
	for (let shape = 0; shape < ROCK_SHAPES; shape++) {
		const squash = [1, 0.55 + 0.25 * next(), 0.8 + 0.3 * next()] as const;
		const mesh = geometry.fromArrays(mossy(rock(300 + shape, detail, squash), 50 + shape));
		const mine = places.filter((_, k) => k % ROCK_SHAPES === shape);
		const batch = scene.createInstances(mesh, mine.length, {
			material: stone,
			castShadows: true,
			receiveShadows: true,
		});
		mine.forEach(({ x, z, size }, row) => {
			batch.positions.set([x, groundHeight(x, z) - size * 0.2, z], row * 3);
			batch.rotations.set(yaw(next() * Math.PI * 2), row * 4);
			batch.scales.set([size, size, size], row * 3);
		});
		batch.markDirty();
	}

	// The cave mouth: the floor of its tunnel meets the ground at the opening, and the back of the
	// rock sinks into the rising bank.
	const mouth = groundHeight(CAVE.x + 2.4 * Math.sin(CAVE.yaw), CAVE.z + 2.4 * Math.cos(CAVE.yaw));
	scene.createMesh({
		mesh: cave.mesh,
		material: cave.material,
		...placed(cave, [CAVE.x, mouth - 0.15, CAVE.z], CAVE.yaw, 1),
		occluder: cave.occluder,
		castShadows: true,
		receiveShadows: true,
	});

	// Pebbles on the bed and the shore: two shapes in three colors, each pair one batch.
	const tints = ['#7c766c', '#8d7a62', '#5f5f5c'];
	const pebbleShapes = [0, 1].map((s) => geometry.fromArrays(rock(500 + s, 1, [1, 0.5, 0.8])));
	const pebbleBatches = pebbleShapes.flatMap((mesh) =>
		tints.map((color) => {
			const capacity = Math.ceil(PEBBLES.ultra / 6);
			const batch = scene.createInstances(mesh, capacity, {
				material: materials.standard({ color, roughness: 0.7, ...maps }),
				receiveShadows: true,
			});
			for (let row = 0; row < capacity; ) {
				const x = -20 + 40 * next();
				const z = streamZ(x) + (next() * 2 - 1) * 1.3 * streamHalf(x);
				if (fromStream(x, z) > 1.25) continue;
				const size = 0.04 + 0.11 * next() ** 2;
				batch.positions.set([x, groundHeight(x, z) - size * 0.15, z], row * 3);
				batch.rotations.set(yaw(next() * Math.PI * 2), row * 4);
				batch.scales.set([size, size, size], row * 3);
				row++;
			}
			batch.markDirty();
			return batch;
		}),
	);

	const footprints = [
		...places.map(({ x, z, size }) => ({ x, z, r: size * 1.1 })),
		{ x: CAVE.x, z: CAVE.z, r: CAVE.reach },
	];
	return {
		clear: within(footprints),
		fit(preset) {
			for (const batch of pebbleBatches) batch.setActiveCount(Math.ceil(PEBBLES[preset] / 6));
		},
	};
}

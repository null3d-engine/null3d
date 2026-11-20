// The creek's stones: mossy rocks along the water's edge, in the stream and on the banks, and pebbles
// on the bed. Each kind of rock is an instance batch whose rows cast and receive the sun's shadows.
// The rocks are noise-shaped spheres with a texture made in code, and moss on the parts that face
// up. The pebbles are small and lie under the water, so they cast none.
import {
	type MeshArrays,
	math,
	type QualityPreset,
	quat,
	type SketchContext,
} from '@null3d/engine';
import { Noise, random, rock, type TexelSample, textureSet, within } from '../../lib/procedural';
import {
	bearingOf,
	fromStream,
	groundHeight,
	LIPS,
	rimRadius,
	streamCurrent,
	streamHalf,
	streamZ,
	UNREFLECTED_LAYER,
	WATER,
} from './land';

/** A stone where it breaks the water: its middle and its radius at the water's height. */
export interface Obstacle {
	x: number;
	z: number;
	r: number;
}

/** Pebbles at each preset, over all their batches. */
const PEBBLES: Record<QualityPreset, number> = { low: 1200, medium: 3000, high: 4800, ultra: 6000 };
/** Rocks nearer the stream's middle than this many half widths are wet. */
const WET = 1.25;
/** Rocks nearer the stream's middle than this many half widths stand in the current and foam it. */
const IN_STREAM = 1.0;
/** How far under the surface a stone's top may lie and still break the water white, in meters. */
const SHALLOW = 0.32;
/** The foam's trail behind a stone in the current: its links, the meters between them, and its width. */
const TRAIL = { links: 14, step: 0.45, width: 1.3 } as const;
/** The shapes of rock, each one batch. */
const ROCK_SHAPES = 4;

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

/** Gives a rock's vertices colors: dark flecked stone, and moss where the rock faces up. */
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
		// Grey-brown stone, with yellow-olive moss where it faces up.
		colors.set(
			[shade * (0.3 - 0.13 * moss), shade * (0.28 - 0.12 * moss), shade * (0.245 - 0.2 * moss)],
			v * 3,
		);
	}
	return { ...arrays, colors };
}

/** A turn about y by an angle, as the four numbers of a quaternion. */
const yaw = (angle: number) => quat.fromEuler(quat.create(), 0, angle, 0);

/** How far from each lip the rocks stop, in meters, so the lips stay clear for the falls. */
const LIP_CLEAR = 1.5;
/** The rocks along the creek: in the stream, in a row along each edge, and on the banks. */
const ROCKS = 150;
/** How far a rock's foot reaches about its middle, as a share of its size. */
export const ROCK_REACH = 1.6;
/**
 * The riffles, where rocks stand across the current and break it into foam: the x of each, how far
 * along the creek its rocks spread, and how many stand in it. One lies on the west sill and one
 * before each lip, where the water quickens; the east sill lies on the camera's dip and stays clear.
 */
const RIFFLES: readonly (readonly [number, number, number])[] = [
	[-11.5, 1.8, 10],
	[-6.5, 1.4, 6],
	[LIPS.west + 2.6, 1.6, 8],
	[LIPS.east - 2.2, 1.2, 8],
];

/** True for a point that lies inside the rim by at least `margin` meters. */
export const insideRim = (x: number, z: number, margin: number) =>
	Math.hypot(x, z) < rimRadius(bearingOf(x, z)) - margin;

/**
 * Where rocks stand: a few in the stream, a line along each edge, some on the banks, and rows across
 * the riffles. Every rock stands wholly inside the rim.
 */
export function rockPlaces(): { x: number; z: number; size: number }[] {
	const next = random(41);
	const places: { x: number; z: number; size: number }[] = [];
	const from = LIPS.west + LIP_CLEAR;
	const to = LIPS.east - LIP_CLEAR;
	while (places.length < ROCKS) {
		const x = from + (to - from) * next();
		const kind = next();
		const side = next() < 0.5 ? -1 : 1;
		const across =
			kind < 0.15 ? next() * 0.5 : kind < 0.75 ? 0.82 + 0.3 * next() : 1.3 + 0.9 * next();
		// A stone in the stream stands tall enough to break the surface, so the current foams round it.
		const size =
			kind < 0.15 ? 0.5 + 0.3 * next() : kind < 0.75 ? 0.28 + 0.38 * next() : 0.2 + 0.5 * next();
		const z = streamZ(x) + side * across * streamHalf(x);
		if (insideRim(x, z, size * ROCK_REACH + 0.2)) places.push({ x, z, size });
	}
	for (const [middle, spread, count] of RIFFLES)
		for (let k = 0; k < count; k++) {
			const x = middle + (next() * 2 - 1) * spread;
			const across = ((k + 0.5) / count) * 1.6 - 0.8 + (next() - 0.5) * 0.15;
			const size = 0.42 + 0.25 * next();
			const z = streamZ(x) + across * streamHalf(x);
			if (insideRim(x, z, size * ROCK_REACH + 0.2)) places.push({ x, z, size });
		}
	return places;
}

/** The pebbles on the bed and the shore: each one's place, size and turn, all inside the rim. */
export function pebblePlaces(
	count: number,
): { x: number; z: number; size: number; turn: number }[] {
	const next = random(47);
	const places: { x: number; z: number; size: number; turn: number }[] = [];
	while (places.length < count) {
		const x = LIPS.west + 1 + (LIPS.east - LIPS.west - 2) * next();
		const z = streamZ(x) + (next() * 2 - 1) * 1.3 * streamHalf(x);
		const size = 0.04 + 0.11 * next() ** 2;
		const turn = next() * Math.PI * 2;
		if (fromStream(x, z) <= 1.25 && insideRim(x, z, size + 0.1)) places.push({ x, z, size, turn });
	}
	return places;
}

/**
 * A test of whether a stone covers a point of the ground, where nothing grows.
 *
 * @param places The rocks' places, which `rockPlaces` gives.
 */
export function stoneFootprints(places = rockPlaces()): (x: number, z: number) => boolean {
	return within(places.map(({ x, z, size }) => ({ x, z, r: size * 1.1 })));
}

/** The stones and the pebbles, and a test of whether anything may stand at a point. */
export function createStones(
	{ scene, geometry, materials, textures }: SketchContext,
	detail: number,
	textureSize: number,
): {
	clear(x: number, z: number): boolean;
	fit(preset: QualityPreset): void;
	obstacles: Obstacle[];
} {
	const maps = textureSet(textures, textureSize, rockTexel);
	const look = { vertexColors: true, ...maps, uvTransform: { repeat: [2, 1] } } as const;
	const dry = materials.standard({ ...look, roughness: 1 });
	// Stones in the stream and at its edge are wet: a little darker, and with a dull sheen.
	const wet = materials.standard({ ...look, color: '#b4ad9f', roughness: 0.62 });
	const next = random(43);
	const places = rockPlaces();
	const obstacles: Obstacle[] = [];
	for (let shape = 0; shape < ROCK_SHAPES; shape++) {
		const squash = [1, 0.55 + 0.25 * next(), 0.8 + 0.3 * next()] as const;
		const mesh = geometry.fromArrays(mossy(rock(300 + shape, detail, squash), 50 + shape));
		const mine = places
			.filter((_, k) => k % ROCK_SHAPES === shape)
			.map((place) => ({ ...place, yaw: next() * Math.PI * 2 }));
		for (const wetness of [true, false]) {
			const group = mine.filter(({ x, z }) => fromStream(x, z) < WET === wetness);
			if (group.length === 0) continue;
			const batch = scene.createInstances(mesh, group.length, {
				material: wetness ? wet : dry,
				castShadows: true,
				receiveShadows: true,
			});
			group.forEach(({ x, z, size, yaw: turn }, row) => {
				// A stone in the current sits up on the bed; one on the bank sinks into the ground.
				const inStream = fromStream(x, z) < IN_STREAM;
				const y = groundHeight(x, z) - size * (inStream ? 0.05 : 0.2);
				batch.positions.set([x, y, z], row * 3);
				batch.rotations.set(yaw(turn), row * 4);
				batch.scales.set([size, size, size], row * 3);
				// Where a stone in the stream meets the water's plane, or lies just under it, the water
				// breaks white around it and in a trail behind it. The stones that line the banks leave the
				// calm edges clear.
				const top = y + size * squash[1];
				const below = (WATER - y) / (size * squash[1]);
				if (inStream && top > WATER - SHALLOW) {
					const r =
						Math.abs(below) < 0.9
							? size * Math.sqrt(1 - below * below)
							: size * 0.75 * (1 - Math.max(0, WATER - top) / SHALLOW);
					obstacles.push({ x, z, r });
					// The trail: the foam that the current carries away behind the stone, whichever way it
					// runs, as a chain of shrinking rings downstream.
					const [vx, vz] = streamCurrent(x, z);
					const speed = Math.hypot(vx, vz);
					if (speed > 0.05)
						for (let k = 1; k <= TRAIL.links; k++)
							obstacles.push({
								x: x + (vx / speed) * k * TRAIL.step,
								z: z + (vz / speed) * k * TRAIL.step,
								r: r * (1 - k / (TRAIL.links + 1)) * TRAIL.width,
							});
				}
			});
			batch.markDirty();
		}
	}

	// Pebbles on the bed and the shore: two shapes in three colors, each pair one batch.
	const tints = ['#6a645b', '#776753', '#53524f'];
	const pebbleShapes = [0, 1].map((s) => geometry.fromArrays(rock(500 + s, 1, [1, 0.5, 0.8])));
	const capacity = Math.ceil(PEBBLES.ultra / 6);
	const pebbles = pebblePlaces(capacity * 6);
	const pebbleBatches = pebbleShapes.flatMap((mesh, shape) =>
		tints.map((color, tint) => {
			const batch = scene.createInstances(mesh, capacity, {
				// Wet pebbles: glossy, at the water's edge and under it.
				material: materials.standard({ color, roughness: 0.35, ...maps }),
				receiveShadows: true,
				layers: UNREFLECTED_LAYER,
			});
			const first = (shape * tints.length + tint) * capacity;
			pebbles.slice(first, first + capacity).forEach(({ x, z, size, turn }, row) => {
				batch.positions.set([x, groundHeight(x, z) - size * 0.15, z], row * 3);
				batch.rotations.set(yaw(turn), row * 4);
				batch.scales.set([size, size, size], row * 3);
			});
			batch.markDirty();
			return batch;
		}),
	);

	return {
		obstacles,
		clear: stoneFootprints(places),
		fit(preset) {
			for (const batch of pebbleBatches) batch.setActiveCount(Math.ceil(PEBBLES[preset] / 6));
		},
	};
}

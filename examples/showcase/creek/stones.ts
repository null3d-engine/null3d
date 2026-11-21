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
import { type Part, placedTurned, tintedPart } from '../../lib/blender-models';
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
const TRAIL = { links: 18, step: 0.4, width: 2.6 } as const;
/**
 * How each wake strays from the current: its slant from it at the stone and its bend at each link,
 * in radians at the most; its least length as a share of the longest; the current under which a
 * stone leaves none, and the current at which its wake reaches full length, in meters a second; the
 * share of a full wake that a riffle's stone leaves, since riffle stones stand close together and
 * their full wakes would join into one white sheet; and the share that a lone stone in the current
 * leaves, so each arm's foam lies in streaks with clear water between, as the concept's.
 */
const WAKE = {
	slant: 0.35,
	bend: 0.06,
	shortest: 0.45,
	still: 0.015,
	full: 0.25,
	riffle: 0.55,
	current: 0.85,
} as const;
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

/** The linear colors of a mossy stone: its bare stone, and the moss that caps it. */
export interface MossTones {
	readonly stone: readonly [number, number, number];
	readonly moss: readonly [number, number, number];
}

/** Linear colors of the stones: a warm grey-brown, and the yellow-olive moss that caps them. */
const STONE_TONES: MossTones = { stone: [0.2, 0.17, 0.125], moss: [0.13, 0.115, 0.06] };
/**
 * The linear color of moss on a mesh that wears the rock texture, which darkens and warms it: it
 * stands lighter and greener than it draws, so it draws as light as the ground's moss.
 */
export const TEXTURED_MOSS = [0.2, 0.2, 0.1] as const;

/**
 * Gives a rock's vertices colors: flecked stone, and moss where the rock faces up, in the creek's
 * stone tones unless others are given.
 */
export function mossy(
	arrays: MeshArrays,
	seed: number,
	cover: number,
	{ stone, moss: mossTone }: MossTones = STONE_TONES,
): MeshArrays {
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
		const moss = smoothstep(
			up + 0.35 * local.value3(x * 4, y * 4, z * 4),
			0.75 - cover,
			1.15 - cover,
		);
		const shade = 0.75 + 0.25 * local.value3(x * 9, y * 9, z * 9);
		// Warm grey-brown stone, with yellow-olive moss where it faces up.
		for (let c = 0; c < 3; c++)
			colors[v * 3 + c] =
				shade * ((stone[c] as number) + ((mossTone[c] as number) - (stone[c] as number)) * moss);
	}
	return { ...arrays, colors };
}

/** The warm tint that mutes the finished rock models' golden moss to the concept's olive, seen from afar. */
export const MOSS_MUTE = '#bab6a2';

/** A turn about y by an angle, as the four numbers of a quaternion. */
const yaw = (angle: number) => quat.fromEuler(quat.create(), 0, angle, 0);

/** How far from each lip the rocks stop, in meters, so the lips stay clear for the falls. */
const LIP_CLEAR = 1.2;
/** How far a rock's foot reaches about its middle, as a share of its size. */
export const ROCK_REACH = 1.6;
/** The stones in the current. */
const IN_CURRENT = 56;
/** The stretch of the creek where the route's dip glides under the water, along its north half. */
const DIP_REACH = [2.5, 19] as const;
/**
 * The bank stones' smallest and largest size, and how close they stand, as a share of their size,
 * so each overlaps the last; how far each sinks into the bank, as a share of its size, from least
 * to most, so their tops stand uneven; how far each tips, in radians at the most; the half width
 * of each finished rock model at its own size, largest boulder first, which sets its scale; and
 * the shares of the row that the largest and the middle boulder take, the rest being bank stones.
 */
const BANK = {
	size: [0.32, 0.95],
	spacing: 1.3,
	sink: [0.12, 0.4],
	tilt: 0.35,
	modelHalf: [2.7, 1.8, 0.9],
	mix: [0.08, 0.2],
} as const;
/**
 * The riffles, where rocks stand across the current and break it into foam: the x of each, how far
 * along the creek its rocks spread, how many stand in it, and the share of the creek's width they
 * span, from one side to the other (-1 to 1). Four lie on the west arm, sparse enough that its
 * wakes break up with clear water between them; and one just past each end of the pool, where its
 * water runs out into an arm shallow enough to break white, so the pool itself lies calm. The east
 * sill lies on the camera's dip and stays clear.
 */
const RIFFLES: readonly (readonly [number, number, number, number, number])[] = [
	[-14, 1.2, 5, -0.8, 0.8],
	[-11.5, 1.8, 7, -0.8, 0.8],
	[-8.8, 1.2, 6, -0.8, 0.8],
	[-6.5, 1.4, 6, -0.8, 0.8],
	[-5.6, 0.7, 6, -0.7, 0.7],
	[1.8, 0.7, 6, -0.7, 0.7],
];

/** True for a point that lies inside the rim by at least `margin` meters. */
export const insideRim = (x: number, z: number, margin: number) =>
	Math.hypot(x, z) < rimRadius(bearingOf(x, z)) - margin;

/** What a stone is: one of the rounded row along a bank, or a broken one in or by the current. */
export type StoneKind = 'bank' | 'broken';

/** One stone: its place, its size and its kind. */
export interface StonePlace {
	x: number;
	z: number;
	size: number;
	kind: StoneKind;
	/** The share of a full wake's length and width that the stone leaves in the current. */
	wake: number;
}

/**
 * Where rocks stand: a continuous row of rounded stones along each bank, touching each other; broken
 * stones in the current and across the riffles; and at each lip, rock shoulders either
 * side of the narrowed creek, with stones in it where the water piles up white before it drops.
 * Every rock stands wholly inside the rim.
 */
export function rockPlaces(): StonePlace[] {
	const next = random(41);
	const places: StonePlace[] = [];
	const add = (x: number, across: number, size: number, kind: StoneKind, wake = 1) => {
		const z = streamZ(x) + across * streamHalf(x);
		if (insideRim(x, z, size * ROCK_REACH + 0.2)) places.push({ x, z, size, kind, wake });
	};
	const from = LIPS.west + LIP_CLEAR;
	const to = LIPS.east - LIP_CLEAR;
	// The rows along both banks, at the water's edge, each stone beside the last.
	for (const side of [-1, 1]) {
		let x = from + next() * 0.3;
		while (x < to) {
			const size = BANK.size[0] + (BANK.size[1] - BANK.size[0]) * next();
			add(x, side * (1.06 + 0.12 * (next() - 0.5)), size, 'bank');
			x += size * BANK.spacing;
		}
	}
	for (let k = 0; k < IN_CURRENT; k++) {
		const x = from + (to - from) * next();
		// Where the camera's dip glides along the creek's north half, the stones keep to the south.
		const across =
			x > DIP_REACH[0] && x < DIP_REACH[1] ? 0.35 + 0.25 * next() : (next() * 2 - 1) * 0.5;
		add(x, across, 0.5 + 0.3 * next(), 'broken', WAKE.current);
	}
	for (const [middle, spread, count, near, far] of RIFFLES)
		for (let k = 0; k < count; k++) {
			const x = middle + (next() * 2 - 1) * spread;
			const across = near + ((k + 0.5) / count) * (far - near) + (next() - 0.5) * 0.15;
			add(x, across, 0.42 + 0.25 * next(), 'broken', WAKE.riffle);
		}
	// The lips: broken shoulders either side, and stones in the narrowed creek before the edge. Each
	// stands back from the lip by its own foot's reach, so it stays wholly on the cliff.
	for (const lip of [LIPS.west, LIPS.east]) {
		const inward = -Math.sign(lip);
		const atLip = (back: number, across: number, size: number) =>
			add(lip + inward * (size * ROCK_REACH + 0.08 + back), across, size, 'broken');
		for (const side of [-1, 1]) {
			atLip(0.3 * next(), side * (1.0 + 0.1 * next()), 0.6 + 0.2 * next());
			atLip(1.0 + 0.5 * next(), side * (1.0 + 0.1 * next()), 0.45 + 0.15 * next());
		}
		for (const across of [-0.45, 0.1, 0.55])
			atLip(1.0 * next(), across + (next() - 0.5) * 0.15, 0.4 + 0.15 * next());
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
	ctx: SketchContext,
	detail: number,
	textureSize: number,
	bankModels?: readonly [Part, Part, Part],
): {
	clear(x: number, z: number): boolean;
	fit(preset: QualityPreset): void;
	obstacles: Obstacle[];
} {
	const { scene, geometry, materials, textures } = ctx;
	const maps = textureSet(textures, textureSize, rockTexel);
	const look = { vertexColors: true, ...maps, uvTransform: { repeat: [2, 1] } } as const;
	const dry = materials.standard({ ...look, roughness: 1 });
	// Stones in the stream and at its edge are wet: a little darker, and with a faint sheen.
	const wet = materials.standard({ ...look, color: '#c2baa8', roughness: 0.8 });
	const next = random(43);
	const places = rockPlaces();
	const obstacles: Obstacle[] = [];
	for (let shape = 0; shape < ROCK_SHAPES; shape++) {
		// The first shapes are the rounded bank stones, thick with moss; the rest are broken rock.
		const kind: StoneKind = shape < ROCK_SHAPES / 2 ? 'bank' : 'broken';
		if (kind === 'bank' && bankModels) continue;
		const squash =
			kind === 'bank'
				? ([1, 0.62 + 0.12 * next(), 0.85 + 0.15 * next()] as const)
				: ([1, 0.55 + 0.25 * next(), 0.8 + 0.3 * next()] as const);
		const arrays = rock(300 + shape, detail, squash, kind === 'bank' ? 0.03 : 0.12);
		const mesh = geometry.fromArrays(mossy(arrays, 50 + shape, kind === 'bank' ? 0.62 : 0.1));
		const mine = places
			.filter(
				(place, k) => place.kind === kind && k % (ROCK_SHAPES / 2) === shape % (ROCK_SHAPES / 2),
			)
			.map((place) => ({ ...place, yaw: next() * Math.PI * 2 }));
		for (const wetness of [true, false]) {
			const group = mine.filter(({ x, z }) => fromStream(x, z) < WET === wetness);
			if (group.length === 0) continue;
			const batch = scene.createInstances(mesh, group.length, {
				material: wetness ? wet : dry,
				castShadows: true,
				receiveShadows: true,
			});
			group.forEach(({ x, z, size, wake, yaw: turn }, row) => {
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
					// The foam trails behind the stone, whichever way the current runs: a wake that starts
					// narrow at its downstream side, widens away from it and then fades, so none rings it.
					// Each wake leaves at its own slant and bends as it goes, so wakes cross and break
					// rather than run side by side; a stone in still water leaves none.
					const [vx, vz] = streamCurrent(x, z);
					const speed = Math.hypot(vx, vz);
					if (speed > WAKE.still) {
						const slant = (next() * 2 - 1) * WAKE.slant;
						const bend = (next() * 2 - 1) * WAKE.bend;
						// A slow current carries a short wake, a quick one a long wake.
						const reach = Math.min(1, speed / WAKE.full);
						const links = Math.max(
							2,
							Math.round(
								TRAIL.links * reach * wake * (WAKE.shortest + (1 - WAKE.shortest) * next()),
							),
						);
						let [px, pz] = [x, z];
						let angle = Math.atan2(vz, vx) + slant;
						for (let k = 0; k <= links; k++) {
							const step = k === 0 ? r + 0.2 : TRAIL.step;
							px += Math.cos(angle) * step;
							pz += Math.sin(angle) * step;
							angle += bend;
							const spread = Math.min(1, 0.4 + 0.15 * k) * (1 - k / (links + 1));
							obstacles.push({ x: px, z: pz, r: r * TRAIL.width * wake * spread });
						}
					}
				}
			});
			batch.markDirty();
		}
	}

	// The bank row from the finished rock models, when the scene has them: mostly the bank stone, with
	// now and then a small copy of a larger boulder, so the row is no string of like beads. Each copy
	// is as wide as the stone it stands for, tipped a little and sunk unevenly into the bank. A warm,
	// muted copy of each model's material keeps its moss olive rather than golden from afar.
	if (bankModels) {
		const bank = places
			.filter((place) => place.kind === 'bank')
			.map((place) => {
				const pick = next();
				return { ...place, model: pick < BANK.mix[0] ? 0 : pick < BANK.mix[1] ? 1 : 2 };
			});
		for (const model of [0, 1, 2] as const) {
			const part = bankModels[model];
			const mine = bank.filter((place) => place.model === model);
			if (mine.length === 0) continue;
			const batch = scene.createInstances(part.mesh, mine.length, {
				material: tintedPart(materials, part, MOSS_MUTE, 0.95),
				castShadows: true,
				receiveShadows: true,
			});
			mine.forEach(({ x, z, size }, row) => {
				const turn = quat.fromEuler(
					quat.create(),
					(next() * 2 - 1) * BANK.tilt,
					next() * Math.PI * 2,
					(next() * 2 - 1) * BANK.tilt,
					'YXZ',
				);
				const sink = BANK.sink[0] + (BANK.sink[1] - BANK.sink[0]) * next();
				const at = [x, groundHeight(x, z) - size * sink, z] as const;
				const { position, rotation, scale } = placedTurned(
					part,
					at,
					turn,
					size / (BANK.modelHalf[model] as number),
				);
				batch.positions.set(position, row * 3);
				batch.rotations.set(rotation, row * 4);
				batch.scales.set(scale, row * 3);
			});
			batch.markDirty();
		}
	}

	// Pebbles on the bed and the shore: two shapes in three colors, each pair one batch.
	const tints = ['#6e6455', '#7a6a52', '#5c564c'];
	const pebbleShapes = [0, 1].map((s) => geometry.fromArrays(rock(500 + s, 1, [1, 0.5, 0.8])));
	const capacity = Math.ceil(PEBBLES.ultra / 6);
	const pebbles = pebblePlaces(capacity * 6);
	const pebbleBatches = pebbleShapes.flatMap((mesh, shape) =>
		tints.map((color, tint) => {
			const batch = scene.createInstances(mesh, capacity, {
				// Pebbles at the water's edge and under it: warm and matte, as the bank's stones are.
				material: materials.standard({ color, roughness: 0.85, ...maps }),
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

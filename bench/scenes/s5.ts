// S5, the crowd: copies of one animated character from an optimized glTF file walk in rings on a
// lit ground, under a sun that casts shadows, while the camera orbits them. Each character blends
// a walk with a run by clip weights, at its ring's weight. It starts both clips at a time of its
// own and plays them at a rate of its own, so no two step in time. Its ring's speed follows the
// blend: rings that run more move faster. The characters of one ring keep their spacing, and rings
// lie apart, so no two characters ever overlap.
//
// Everything here is plain data and pure functions with no engine imports, as in spec.ts. The
// per-frame function writes into arrays that the caller owns, so it allocates nothing.
import {
	mulberry32,
	ORBIT_SECONDS,
	type OutArray,
	type SceneClock,
	type SceneLights,
} from './spec';

const TAU = 2 * Math.PI;

/** The character count when the page has no `?n=` switch. */
export const S5_DEFAULT_COUNT = 500;

/**
 * The character: the KayKit Knight of the sample content, its two clips, and the accessories on
 * its bones that the crowd leaves out. The file holds five shields and three swords; each knight
 * keeps one sword and one round shield, with its helmet and cape, as a game shows it.
 */
export const S5_CHARACTER = {
	walk: 'Walking_A',
	/** The run whose clip is as long as the walk's, so the blend of the two stays in step. */
	run: 'Running_B',
	removed: ['1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'],
} as const;

/**
 * The rings: the first ring's radius, the distance between rings, and the least distance between
 * two characters along a ring, in meters. The Knight is about 2.4 m tall and 1.1 m wide at its head.
 */
export const S5_RINGS = { firstRadius: 4, spacing: 2, along: 1.8 } as const;

/**
 * Ground speeds in meters per second: of a character that only walks, and of one that only runs.
 * A ring moves at the speed of its blend between them.
 */
export const S5_SPEEDS = { walk: 1.5, run: 4 } as const;

/** The least and most weight of the run in a ring's blend. */
export const S5_BLEND = { least: 0.2, most: 0.8 } as const;

/** The least and most rate at which a character plays its clips. */
export const S5_RATES = { least: 0.85, most: 1.15 } as const;

/**
 * The latest time in seconds at which a character starts its clips, about one step of the walk.
 * The engines wrap a later time into each clip.
 */
export const S5_LATEST_START = 1;

/** The ground: a slab this wide, its top at height 0, with its sRGB color and roughness. */
export const S5_GROUND = { size: 600, thickness: 0.2, color: '#7d8b6c', roughness: 1 } as const;

/** The clear color: a pale sky. */
export const S5_BACKGROUND = '#a9bfd4';

/** The sun, which casts the shadows, and the ambient light. */
export const S5_VIEW_LIGHTS: SceneLights = {
	sun: { direction: [-0.45, -1, -0.35], color: '#fff4e0', intensity: 2.6, castShadows: true },
	ambient: { color: '#c8d4e4', intensity: 0.6 },
};

/**
 * How far from the camera the sun's shadows reach, in meters: null3D's default, and the far end of
 * the three.js twin's cascades.
 */
export const S5_SHADOW_DISTANCE = 200;

/**
 * The camera's orbit, which fits the crowd: its radius is the outer ring's times `reach`, and at
 * least `least`, at a height of `rise` times the radius. It looks at a point `lookHeight` above
 * the crowd's center.
 */
export const S5_ORBIT = { reach: 1.6, least: 14, rise: 0.45, lookHeight: 1 } as const;

/** S5's characters, with one entry per character in each array. */
export interface S5Data {
	count: number;
	/** The rings that hold the characters. */
	rings: number;
	/** The outer ring's radius. */
	outerRadius: number;
	/** The radius of each character's ring. */
	radius: Float32Array;
	/** Where each character is on its ring at time 0, as an angle in radians from +X toward +Z. */
	phase: Float32Array;
	/** How fast each character goes around, in radians per second: its ring's speed and direction. */
	angularSpeed: Float32Array;
	/** The run's weight in each character's blend, its ring's. */
	weight: Float32Array;
	/** The rate at which each character plays its clips. */
	rate: Float32Array;
	/** The time in seconds at which each character starts its walk and its run. */
	start: Float32Array;
}

/** The characters that a ring of radius `radius` holds. */
const ringCapacity = (radius: number) => Math.floor((TAU * radius) / S5_RINGS.along);

/**
 * Makes S5 with `count` characters. The rings fill from the inside out. The last ring holds what
 * is left, spread evenly around it. The generator draws, ring by ring: the ring's starting angle
 * and the share of its blend's range, then each character's rate. Rings take turns going one way
 * and the other. A second generator draws each character's start time.
 */
export function createS5(count: number, seed = 5): S5Data {
	if (!(Number.isSafeInteger(count) && count > 0))
		throw new RangeError(`S5 needs a whole number of characters above 0, not ${count}.`);
	const random = mulberry32(seed);
	const randomStart = mulberry32(seed + 1);
	const data: S5Data = {
		count,
		rings: 0,
		outerRadius: 0,
		radius: new Float32Array(count),
		phase: new Float32Array(count),
		angularSpeed: new Float32Array(count),
		weight: new Float32Array(count),
		rate: new Float32Array(count),
		start: new Float32Array(count),
	};
	let placed = 0;
	for (let ring = 0; placed < count; ring++) {
		const radius = S5_RINGS.firstRadius + ring * S5_RINGS.spacing;
		const members = Math.min(ringCapacity(radius), count - placed);
		const start = random() * TAU;
		const weight = S5_BLEND.least + (S5_BLEND.most - S5_BLEND.least) * random();
		const speed = S5_SPEEDS.walk + (S5_SPEEDS.run - S5_SPEEDS.walk) * weight;
		const direction = ring % 2 === 0 ? 1 : -1;
		for (let k = 0; k < members; k++) {
			const i = placed + k;
			data.radius[i] = radius;
			data.phase[i] = start + (TAU * k) / members;
			data.angularSpeed[i] = (direction * speed) / radius;
			data.weight[i] = weight;
			data.rate[i] = S5_RATES.least + (S5_RATES.most - S5_RATES.least) * random();
			data.start[i] = S5_LATEST_START * randomStart();
		}
		placed += members;
		data.rings = ring + 1;
		data.outerRadius = radius;
	}
	return data;
}

/**
 * Writes every character's place and turn at the time that `clock` holds: three floats per
 * character into `outPositions`, and a quaternion in x, y, z, w order per character into
 * `outRotations`. A character faces the way it goes: the model faces +Z, and the turn about +Y
 * brings +Z onto the ring's tangent.
 */
export function s5CharactersAt(
	data: S5Data,
	clock: SceneClock,
	outPositions: OutArray,
	outRotations: OutArray,
): void {
	const t = clock[0] as number;
	const { radius, phase, angularSpeed } = data;
	for (let i = 0; i < data.count; i++) {
		const speed = angularSpeed[i] as number;
		const angle = (phase[i] as number) + speed * t;
		const r = radius[i] as number;
		outPositions[i * 3] = r * Math.cos(angle);
		outPositions[i * 3 + 1] = 0;
		outPositions[i * 3 + 2] = r * Math.sin(angle);
		// Going toward larger angles, the tangent is (-sin, 0, cos), a turn of -angle from +Z; going
		// the other way, half a turn more.
		const half = (speed < 0 ? Math.PI - angle : -angle) / 2;
		outRotations[i * 4] = 0;
		outRotations[i * 4 + 1] = Math.sin(half);
		outRotations[i * 4 + 2] = 0;
		outRotations[i * 4 + 3] = Math.cos(half);
	}
}

/** The radius and the height of the camera's orbit around a crowd whose outer ring is `outerRadius`. */
export function s5Orbit(outerRadius: number): { radius: number; height: number } {
	const radius = Math.max(S5_ORBIT.least, outerRadius * S5_ORBIT.reach);
	return { radius, height: radius * S5_ORBIT.rise };
}

/**
 * Writes S5's camera at time t: an orbit of the crowd, one turn per `ORBIT_SECONDS`, that starts
 * on +X and looks at the crowd's center.
 */
export function s5Camera(
	data: S5Data,
	t: number,
	outPosition: OutArray,
	outTarget: OutArray,
): void {
	const { radius, height } = s5Orbit(data.outerRadius);
	const angle = (TAU * t) / ORBIT_SECONDS;
	outPosition[0] = radius * Math.cos(angle);
	outPosition[1] = height;
	outPosition[2] = -radius * Math.sin(angle);
	outTarget[0] = 0;
	outTarget[1] = S5_ORBIT.lookHeight;
	outTarget[2] = 0;
}

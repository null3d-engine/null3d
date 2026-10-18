// Night town: a rainy downtown under the moon. Blocks of buildings with lit windows, balconies and
// rooftop gear stand between wet streets. Each block brings four street lamps, two neon blade signs
// over shops with awnings, two cars that circle the block with their headlights on, and two parked
// cars. Steam rises from manholes and roof vents, cars leave exhaust, rain falls around the camera,
// and every lamp glows in the haze. The count is the number of lights, and the town grows by whole
// blocks of LIGHTS_PER_BLOCK lights, in a spiral from the middle.
//
// This module is the one description that both engines draw: the layout, the meshes, the textures,
// the lights, the motion, the particles and the look. It imports no engine. Both engines step the
// same fixed clock, and everything that moves is a function of the simulation time, so both show
// the same state at the same time.

import {
	boxGeometry,
	byte,
	type CameraLoop,
	type CompareMode,
	cylinderGeometry,
	fbm,
	type GradeLook,
	type Hex,
	hash01,
	lerp,
	type MeshData,
	mergeMeshes,
	type OutArray,
	placed,
	smoothstep,
	spiralCell,
	TAU,
	type TextureData,
	tiledNoise,
	translated,
	triangleCount,
} from '../../lib/compare-scene';
import {
	addSprite,
	createSpriteRows,
	glowAtlas,
	puffAtlas,
	rainAtlas,
	type SpriteLayer,
	type SpriteRows,
} from '../../lib/particles';
import type { DeviceClass, RampPlan } from '../../lib/ramp';

export const NIGHT_SEED = 7;

// Layout, in meters. A block is a sidewalk slab with four building lots, and streets run between the
// slabs. Block b stands at its spiral cell times BLOCK_PITCH.

/** The side of a block's sidewalk slab. */
export const BLOCK_SIZE = 30;
/** The width of each street between two slabs. */
export const STREET_WIDTH = 12;
/** From one block's center to the next. */
export const BLOCK_PITCH = BLOCK_SIZE + STREET_WIDTH;
export const SLAB_HEIGHT = 0.18;
/** The sidewalk's width around the lots. */
export const SIDEWALK = 3;
/** The side of each of the four lots, which fill the slab inside the sidewalk. */
export const LOT_SIZE = (BLOCK_SIZE - 2 * SIDEWALK) / 2;

/** The lights that each block brings, which the count counts. */
export const LAMPS_PER_BLOCK = 4;
export const SIGNS_PER_BLOCK = 2;
export const CARS_PER_BLOCK = 2;
/** Each moving car's lights: two headlights, which are spot lights, and a tail light. */
export const LIGHTS_PER_CAR = 3;
export const LIGHTS_PER_BLOCK = LAMPS_PER_BLOCK + SIGNS_PER_BLOCK + CARS_PER_BLOCK * LIGHTS_PER_CAR;
export const PARKED_PER_BLOCK = 2;
export const LOTS_PER_BLOCK = 4;
/** The most blocks a scene can hold. */
export const MAX_BLOCKS = 400;

/** Blocks for a count of lights: whole blocks, at least one. */
export function nightBlocks(lights: number): number {
	return Math.max(1, Math.min(MAX_BLOCKS, Math.ceil(lights / LIGHTS_PER_BLOCK)));
}

/** The lights of a count of blocks. */
export function lightsOf(blocks: number): number {
	return blocks * LIGHTS_PER_BLOCK;
}

/** Objects that each block makes in the scene graph mode, lights included. */
export const OBJECTS_PER_BLOCK =
	1 + // slab
	LOTS_PER_BLOCK * 2 + // facade and trim of each building
	LAMPS_PER_BLOCK * 3 + // post, lens and light
	SIGNS_PER_BLOCK * 4 + // sign board, tubes, awning and light
	CARS_PER_BLOCK * (4 + LIGHTS_PER_CAR) + // body, cabin, headlamps, tail lamps and lights
	PARKED_PER_BLOCK * 2; // body and cabin

/** The town's own objects: the street, the moon and the ambient light. */
export const TOWN_OBJECTS = 3;

/** The flying cars' batches: the body, the nose strip and the tail strips. */
const FLYER_OBJECTS = 3;

/** The kinds of mesh, each one batch per material in the instanced mode, and the lights. */
const INSTANCED_KINDS = 40;

/**
 * Objects in the scene for a count of lights: an object per part in the scene graph mode, and a
 * batch per part kind plus the lights in the instanced mode.
 */
export function nightObjects(lights: number, mode: CompareMode = 'scene-graph'): number {
	const blocks = nightBlocks(lights);
	if (mode === 'instanced')
		return INSTANCED_KINDS + blocks * LIGHTS_PER_BLOCK + TOWN_OBJECTS + FLYER_OBJECTS;
	return blocks * OBJECTS_PER_BLOCK + TOWN_OBJECTS + FLYER_OBJECTS;
}

/** Writes block b's center on the ground, x and z, into out at `offset`. */
const cell = new Int32Array(2);
export function blockCenter(b: number, out: OutArray, offset = 0): void {
	spiralCell(b, cell, 0);
	out[offset] = (cell[0] as number) * BLOCK_PITCH;
	out[offset + 1] = (cell[1] as number) * BLOCK_PITCH;
}

/** The street's side in meters, covering every block of a capacity with a margin into the fog. */
export function groundSide(blocks: number): number {
	const ring = Math.ceil((Math.sqrt(Math.max(1, blocks)) - 1) / 2);
	return (2 * ring + 7) * BLOCK_PITCH;
}

// Integer hashing that the shaders repeat exactly: the same bits in TypeScript, WGSL and GLSL, so
// both engines light the same windows and flicker the same signs.

/** A float in [0, 1) from three integers, as the shaders' `town_hash` computes it. */
export function townHash(a: number, b: number, c: number): number {
	let h =
		(Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b9)) >>>
		0;
	h = (h ^ (h >>> 15)) >>> 0;
	h = Math.imul(h, 0x2c1b3c6d) >>> 0;
	h = (h ^ (h >>> 12)) >>> 0;
	h = Math.imul(h, 0x297a2d39) >>> 0;
	h = (h ^ (h >>> 15)) >>> 0;
	return (h >>> 8) / 16777216;
}

/**
 * A lot's two numbers from a point inside it: the block along each axis times two, plus one on
 * the block's positive side. A building never crosses its block's middle, so every point of a
 * building gives its lot. The shaders work out the same numbers from each pixel's world position.
 */
export function lotOf(x: number, z: number, out: Int32Array): void {
	const bx = Math.floor(x / BLOCK_PITCH + 0.5);
	const bz = Math.floor(z / BLOCK_PITCH + 0.5);
	out[0] = bx * 2 + (x - bx * BLOCK_PITCH >= 0 ? 1 : 0);
	out[1] = bz * 2 + (z - bz * BLOCK_PITCH >= 0 ? 1 : 0);
}

/** Steps a second of a sign's flicker: the shaders step it as often. */
export const FLICKER_RATE = 15;
/** The share of flicker steps in which a sign drops to FLICKER_LOW of its light. */
export const FLICKER_SHARE = 0.035;
export const FLICKER_LOW = 0.12;

/**
 * A neon sign's brightness, from 0 to 1, at simulation time `seconds`: mostly steady, with short
 * stutters at random times. `lotX` and `lotZ` are the sign's lot, as `lotOf` gives it.
 */
export function signFlicker(seconds: number, lotX: number, lotZ: number): number {
	const step = Math.floor(seconds * FLICKER_RATE);
	return townHash(step, lotX, lotZ) < FLICKER_SHARE ? FLICKER_LOW : 1;
}

// Buildings. Each lot takes one of a few building designs, turned so its front faces the street on
// the lot's side of the block. A building is two meshes: its walls and roof, which the facade
// material draws with lit windows, and its trim: sills, cornice, parapet, balconies and roof gear.

/** The height of the ground floor, where the shops are, and of each floor above it. */
export const GROUND_FLOOR = 4.2;
export const FLOOR_HEIGHT = 3.2;
/** The width that each window bay aims for; each wall takes a whole number of bays. */
const BAY = 2.6;
/** Each wall's bays start at a multiple of this in u, so the windows of each wall differ. */
export const WALL_U_STRIDE = 64;

export type FacadeKind = 'brick' | 'plaster' | 'concrete' | 'glass';
export const FACADE_KINDS: readonly FacadeKind[] = ['brick', 'plaster', 'concrete', 'glass'];

/** One building design. */
export interface BuildingDesign {
	width: number;
	depth: number;
	/** Floors above the ground floor. */
	floors: number;
	facade: FacadeKind;
	balconies: boolean;
	/** Where its roof vent lets out steam, from the lot's center, before the lot's turn. */
	vent: readonly [number, number, number];
}

export const DESIGN_COUNT = 8;

/** The building designs, from the seed. Setup code. */
export function buildingDesigns(): BuildingDesign[] {
	return Array.from({ length: DESIGN_COUNT }, (_, d) => {
		const r = (k: number) => hash01(NIGHT_SEED, d, k);
		const width = lerp(9.4, 11.2, r(0));
		const depth = lerp(9.4, 11.2, r(1));
		const floors = 2 + Math.floor(r(2) * 8);
		const height = GROUND_FLOOR + floors * FLOOR_HEIGHT;
		return {
			width,
			depth,
			floors,
			facade: FACADE_KINDS[d % FACADE_KINDS.length] as FacadeKind,
			balconies: d % 3 !== 2 && FACADE_KINDS[d % FACADE_KINDS.length] !== 'glass',
			vent: [-width * 0.3, height + 1.3, -depth * 0.25] as const,
		};
	});
}

/** A building's height, from the slab's top to its roof. */
export function buildingHeight(design: BuildingDesign): number {
	return GROUND_FLOOR + design.floors * FLOOR_HEIGHT;
}

/** The bays along a wall of a length. */
function baysOf(length: number): number {
	return Math.max(2, Math.round(length / BAY));
}

/**
 * The walls and roof of a design, around the lot's center, standing on y = 0, with its front
 * facing +Z. Texture coordinates count bays along u and floors along v: the ground floor spans v
 * from 0 to 1, and floor k above it from k to k + 1. The roof's coordinates are 0, and the facade
 * material draws it as a roof by its normal.
 */
export function facadeMesh(design: BuildingDesign): MeshData {
	const { width, depth } = design;
	const height = buildingHeight(design);
	const hw = width / 2;
	const hd = depth / 2;
	// The four walls, counterclockwise seen from above, each from its left corner to its right
	// corner seen from outside: front (+Z), right (+X), back (-Z), left (-X).
	const walls = [
		{ from: [-hw, hd], to: [hw, hd], normal: [0, 1] },
		{ from: [hw, hd], to: [hw, -hd], normal: [1, 0] },
		{ from: [hw, -hd], to: [-hw, -hd], normal: [0, -1] },
		{ from: [-hw, -hd], to: [-hw, hd], normal: [-1, 0] },
	] as const;
	const position: number[] = [];
	const normal: number[] = [];
	const uv: number[] = [];
	const index: number[] = [];
	const quad = (
		corners: readonly (readonly [number, number, number])[],
		n: readonly [number, number, number],
		uvs: readonly (readonly [number, number])[],
	) => {
		const first = position.length / 3;
		for (let k = 0; k < 4; k++) {
			position.push(...(corners[k] as readonly number[]));
			normal.push(...n);
			uv.push(...(uvs[k] as readonly number[]));
		}
		index.push(first, first + 1, first + 2, first, first + 2, first + 3);
	};
	for (const [w, wall] of walls.entries()) {
		const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
		const u0 = w * WALL_U_STRIDE;
		const u1 = u0 + baysOf(length);
		const n = [wall.normal[0], 0, wall.normal[1]] as const;
		const at = (corner: readonly [number, number], y: number) => [corner[0], y, corner[1]] as const;
		// The ground floor, then the floors above it, each a quad whose v runs with the height.
		quad(
			[at(wall.from, 0), at(wall.to, 0), at(wall.to, GROUND_FLOOR), at(wall.from, GROUND_FLOOR)],
			n,
			[
				[u0, 0],
				[u1, 0],
				[u1, 1],
				[u0, 1],
			],
		);
		quad(
			[
				at(wall.from, GROUND_FLOOR),
				at(wall.to, GROUND_FLOOR),
				at(wall.to, height),
				at(wall.from, height),
			],
			n,
			[
				[u0, 1],
				[u1, 1],
				[u1, 1 + design.floors],
				[u0, 1 + design.floors],
			],
		);
	}
	quad(
		[
			[-hw, height, hd],
			[hw, height, hd],
			[hw, height, -hd],
			[-hw, height, -hd],
		],
		[0, 1, 0],
		[
			[0, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		],
	);
	return {
		position: Float32Array.from(position),
		normal: Float32Array.from(normal),
		uv: Float32Array.from(uv),
		index: Uint16Array.from(index),
	};
}

/** A cylinder that lies along X instead of Y, as a wheel does. */
function alongX(mesh: MeshData): MeshData {
	const position = Float32Array.from(mesh.position);
	const normal = Float32Array.from(mesh.normal);
	for (let i = 0; i < position.length; i += 3) {
		const x = position[i] as number;
		position[i] = -(position[i + 1] as number);
		position[i + 1] = x;
		const nx = normal[i] as number;
		normal[i] = -(normal[i + 1] as number);
		normal[i + 1] = nx;
	}
	return { position, normal, uv: Float32Array.from(mesh.uv), index: Uint16Array.from(mesh.index) };
}

/** A box with its center at (x, y, z). */
function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): MeshData {
	return translated(boxGeometry(w, h, d), x, y, z);
}

/**
 * A design's trim, around the lot's center with its front facing +Z: a sill under every window
 * above the ground floor, a cornice and a parapet at the roof, a ledge over the shops, balconies
 * on the front of some designs, and the roof's gear: air units, a water tank on legs, an antenna,
 * a stair house and the vent that steams.
 */
export function trimMesh(design: BuildingDesign, d: number): MeshData {
	const { width, depth, floors } = design;
	const height = buildingHeight(design);
	const hw = width / 2;
	const hd = depth / 2;
	const parts: MeshData[] = [];
	const sides = [
		{ length: width, yaw: 0, out: hd },
		{ length: depth, yaw: Math.PI / 2, out: hw },
		{ length: width, yaw: Math.PI, out: hd },
		{ length: depth, yaw: -Math.PI / 2, out: hw },
	];
	for (const [s, side] of sides.entries()) {
		const bays = baysOf(side.length);
		const bay = side.length / bays;
		const along = (k: number) => -side.length / 2 + (k + 0.5) * bay;
		// A ledge over the shop windows, and the cornice under the parapet.
		parts.push(
			placed(
				boxAt(side.length + 0.3, 0.22, 0.3, 0, GROUND_FLOOR - 0.05, side.out + 0.12),
				side.yaw,
				0,
				0,
				0,
			),
		);
		parts.push(
			placed(
				boxAt(side.length + 0.5, 0.35, 0.4, 0, height - 0.2, side.out + 0.15),
				side.yaw,
				0,
				0,
				0,
			),
		);
		parts.push(
			placed(boxAt(side.length, 0.7, 0.22, 0, height + 0.35, side.out - 0.11), side.yaw, 0, 0, 0),
		);
		for (let f = 0; f < floors; f++) {
			const base = GROUND_FLOOR + f * FLOOR_HEIGHT;
			for (let k = 0; k < bays; k++) {
				const x = along(k);
				parts.push(
					placed(
						boxAt(bay * 0.62, 0.09, 0.16, x, base + 0.22 * FLOOR_HEIGHT - 0.04, side.out + 0.07),
						side.yaw,
						0,
						0,
						0,
					),
				);
				// Balconies hang on every other bay of the front, from the second floor up.
				if (design.balconies && s === 0 && f >= 1 && k % 2 === 1) {
					const z = side.out + 0.55;
					const w = bay * 0.86;
					parts.push(boxAt(w, 0.12, 1.1, x, base, z));
					parts.push(boxAt(w, 0.05, 0.05, x, base + 1.0, z + 0.53));
					parts.push(boxAt(0.05, 0.05, 1.1, x - w / 2, base + 1.0, z));
					parts.push(boxAt(0.05, 0.05, 1.1, x + w / 2, base + 1.0, z));
					for (let p = 0; p <= 6; p++)
						parts.push(boxAt(0.03, 0.94, 0.03, x - w / 2 + (p * w) / 6, base + 0.53, z + 0.53));
				}
			}
		}
	}
	// The roof's gear, placed by the design's own random numbers.
	const r = (k: number) => hash01(NIGHT_SEED + 1, d, k);
	const units = 2 + Math.floor(r(0) * 3);
	for (let k = 0; k < units; k++) {
		const x = lerp(-hw + 1.2, hw - 1.2, r(1 + k));
		const z = lerp(0.5, hd - 1.2, r(5 + k));
		parts.push(boxAt(1.3, 0.85, 0.9, x, height + 0.43, z));
		parts.push(translated(cylinderGeometry(0.32, 0.08, 12), x + 0.25, height + 0.9, z));
	}
	if (r(10) < 0.6) {
		const x = hw * 0.35;
		const z = -hd * 0.35;
		parts.push(translated(cylinderGeometry(1.15, 2.0, 16), x, height + 2.4, z));
		parts.push(translated(cylinderGeometry(1.2, 0.12, 16), x, height + 3.45, z));
		for (const [lx, lz] of [
			[-0.75, -0.75],
			[0.75, -0.75],
			[-0.75, 0.75],
			[0.75, 0.75],
		] as const)
			parts.push(boxAt(0.12, 1.4, 0.12, x + lx, height + 0.7, z + lz));
	} else {
		parts.push(boxAt(2.4, 2.4, 2.2, hw * 0.4, height + 1.2, -hd * 0.4));
	}
	parts.push(
		translated(cylinderGeometry(0.05, 3.5 + r(11) * 3, 6), -hw * 0.6, height + 2.2, hd * 0.55),
	);
	const [vx, vy, vz] = design.vent;
	parts.push(translated(cylinderGeometry(0.2, 1.3, 10), vx, vy - 0.65, vz));
	return mergeMeshes(parts);
}

// The street furniture, the signs, the awnings and the cars.

/** A street lamp: a post at a slab's corner, its arm reaching over the street along +X. */
export const LAMP = { inset: 1.2, height: 6.2, arm: 1.7, lightDrop: 0.3 } as const;

/** A neon blade sign: a board that stands out from a shop's front, with tubes on both faces. */
export const SIGN = {
	height: 4.4,
	depth: 1.5,
	thickness: 0.16,
	bottom: GROUND_FLOOR + 0.6,
	inset: 1.1,
} as const;
export const SIGN_SHAPES = 4;

/** The awning over each shop: its share of the front, its depth, and its top and bottom edges. */
export const AWNING = {
	share: 0.72,
	depth: 1.5,
	top: 3.15,
	bottom: 2.55,
	segments: [10, 5] as const,
	/** Stripe pairs across the awning: each stripe spans half a unit of u. */
	stripes: 8,
} as const;

/** A car: its length, width and the heights of its body and cabin. */
export const CAR = { length: 4.4, width: 1.86, ride: 0.28, body: 0.62, cabin: 0.56 } as const;

/** Where each headlamp sits on a car, from its center, and where its light points. */
export const HEADLAMPS = [
	[-0.62, 0.68, CAR.length / 2 + 0.02],
	[0.62, 0.68, CAR.length / 2 + 0.02],
] as const;
/** The point a headlight aims at, from its lamp, in the car's frame: ahead and a little down. */
export const HEADLIGHT_AIM = [0, -1.6, 14] as const;
/** Where the tail light sits, from the car's center. */
export const TAIL_LIGHT = [0, 0.75, -CAR.length / 2 - 0.25] as const;
/** Where the exhaust leaves, from the car's center. */
const TAILPIPE = [0.5, 0.32, -CAR.length / 2 - 0.05] as const;

/**
 * The flying cars: a lane above each street that crosses the middle of the town, at two heights,
 * with four cars a lane. Each car crosses the town and returns to its lane's start, so the traffic
 * always shows without following the block count.
 */
export const FLYERS_PER_LANE = 4;
export const FLYER_LANES = [
	{ axis: 'x', at: -BLOCK_PITCH / 2, height: 23, direction: 1 },
	{ axis: 'x', at: BLOCK_PITCH / 2, height: 29, direction: -1 },
	{ axis: 'z', at: BLOCK_PITCH / 2, height: 26, direction: 1 },
	{ axis: 'z', at: -BLOCK_PITCH / 2, height: 20, direction: -1 },
] as const;
export const FLYER_COUNT = FLYERS_PER_LANE * FLYER_LANES.length;
/** How far a lane runs before its cars wrap: the town's width, with room to leave and return. */
export const FLYER_STRETCH = 240;
/** The nose light's place in a flying car's frame, where its halo shows. */
export const FLYER_HEAD = [0, 0.02, 2.5] as const;

/**
 * Writes flying car i's place and turn at simulation time `seconds` into out: x, y, z and yaw
 * about +Y. A lane runs along +X or +Z, and its cars cross the town and wrap at the far end.
 */
export function flyerPose(seconds: number, i: number, out: OutArray): void {
	const lane = FLYER_LANES[i % FLYER_LANES.length] as (typeof FLYER_LANES)[number];
	const speed = 14 + ((i * 7) % 6);
	const wrapped = (((i * 61.3 + seconds * speed) % FLYER_STRETCH) + FLYER_STRETCH) % FLYER_STRETCH;
	const along = (wrapped - FLYER_STRETCH / 2) * lane.direction;
	out[1] = lane.height;
	if (lane.axis === 'x') {
		out[0] = along;
		out[2] = lane.at;
		out[3] = lane.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
	} else {
		out[0] = lane.at;
		out[2] = along;
		out[3] = lane.direction > 0 ? 0 : Math.PI;
	}
}

export type NightMesh =
	| 'ground'
	| 'slab'
	| 'lampPost'
	| 'lampLens'
	| 'signBoard'
	| 'awning'
	| 'carBody'
	| 'carCabin'
	| 'headlamps'
	| 'tailLamps'
	| 'flyerBody'
	| 'flyerHead'
	| 'flyerTail'
	| 'skyDome'
	| `facade${number}`
	| `trim${number}`
	| `signTubes${number}`;

/**
 * The awning, one meter wide, which each shop scales to its width: a grid that slopes from the
 * wall, with u across its stripes and v from 0 at the wall to 1 at its hem.
 */
function awningMesh(width: number): MeshData {
	const [nu, nv] = AWNING.segments;
	const position: number[] = [];
	const normal: number[] = [];
	const uv: number[] = [];
	const index: number[] = [];
	const drop = AWNING.top - AWNING.bottom;
	const slope = Math.hypot(drop, AWNING.depth);
	for (let j = 0; j <= nv; j++)
		for (let i = 0; i <= nu; i++) {
			const t = j / nv;
			position.push(-width / 2 + (i / nu) * width, AWNING.top - drop * t, AWNING.depth * t);
			normal.push(0, AWNING.depth / slope, drop / slope);
			uv.push((i / nu) * AWNING.stripes, t);
		}
	for (let j = 0; j < nv; j++)
		for (let i = 0; i < nu; i++) {
			const a = j * (nu + 1) + i;
			const b = a + nu + 1;
			index.push(a, b, a + 1, a + 1, b, b + 1);
		}
	return {
		position: Float32Array.from(position),
		normal: Float32Array.from(normal),
		uv: Float32Array.from(uv),
		index: Uint16Array.from(index),
	};
}

/**
 * The tubes of a sign shape, on both faces of the board, in the board's frame: the board stands
 * in the YZ plane from y = 0 up, reaching out along +Z. Each shape is a frame with seeded letters
 * of straight strokes inside it.
 */
function signTubesMesh(shape: number): MeshData {
	const t = 0.1;
	const parts: MeshData[] = [];
	const { height, depth, thickness } = SIGN;
	for (const face of [-1, 1]) {
		const x = face * (thickness / 2 + t / 2);
		const tube = (y0: number, z0: number, y1: number, z1: number) => {
			const length = Math.hypot(y1 - y0, z1 - z0) + t;
			const box = boxGeometry(t, length, t);
			// Turn the tube from +Y to its stroke's direction in the YZ plane.
			const angle = Math.atan2(z1 - z0, y1 - y0);
			const c = Math.cos(angle);
			const s = Math.sin(angle);
			const position = Float32Array.from(box.position);
			const normal = Float32Array.from(box.normal);
			for (let i = 0; i < position.length; i += 3) {
				const py = position[i + 1] as number;
				const pz = position[i + 2] as number;
				position[i] = (position[i] as number) + x;
				position[i + 1] = c * py - s * pz + (y0 + y1) / 2;
				position[i + 2] = s * py + c * pz + (z0 + z1) / 2;
				const ny = normal[i + 1] as number;
				const nz = normal[i + 2] as number;
				normal[i + 1] = c * ny - s * nz;
				normal[i + 2] = s * ny + c * nz;
			}
			parts.push({ position, normal, uv: box.uv, index: box.index });
		};
		const m = 0.12;
		tube(m, m, m, depth - m);
		tube(height - m, m, height - m, depth - m);
		tube(m, m, height - m, m);
		tube(m, depth - m, height - m, depth - m);
		// Letters stacked down the board, each a few strokes on a 2 x 3 grid.
		const letters = 3;
		for (let k = 0; k < letters; k++) {
			const top = height - 0.35 - k * ((height - 0.5) / letters);
			const bottom = top - (height - 0.5) / letters + 0.22;
			const z0 = 0.32;
			const z1 = depth - 0.32;
			const mid = (top + bottom) / 2;
			const strokes: [number, number, number, number][] = [
				[top, z0, top, z1],
				[bottom, z0, bottom, z1],
				[mid, z0, mid, z1],
				[top, z0, bottom, z0],
				[top, z1, bottom, z1],
				[top, z0, mid, z1],
				[mid, z0, bottom, z1],
			];
			for (const [i, stroke] of strokes.entries())
				if (hash01(NIGHT_SEED + 2, shape * 16 + k, i) < 0.5 || i === 3) tube(...stroke);
		}
	}
	return mergeMeshes(parts);
}

/**
 * The sky's dome: a sphere of a radius around the origin, which the camera carries, with its faces
 * and normals turned inward. It reaches a little below the horizon, where the fogged town meets it.
 */
export function skyDomeMesh(radius: number, around = 48, down = 24): MeshData {
	const position: number[] = [];
	const normal: number[] = [];
	const uv: number[] = [];
	const index: number[] = [];
	const lowest = -0.15;
	for (let j = 0; j <= down; j++) {
		const elevation = lowest + (j / down) * (Math.PI / 2 - lowest);
		const y = Math.sin(elevation);
		const ring = Math.cos(elevation);
		for (let i = 0; i <= around; i++) {
			const angle = (i / around) * TAU;
			const x = ring * Math.cos(angle);
			const z = ring * Math.sin(angle);
			position.push(x * radius, y * radius, z * radius);
			normal.push(-x, -y, -z);
			uv.push(i / around, j / down);
		}
	}
	for (let j = 0; j < down; j++)
		for (let i = 0; i < around; i++) {
			const a = j * (around + 1) + i;
			const b = a + around + 1;
			index.push(a, a + 1, b, a + 1, b + 1, b);
		}
	return {
		position: Float32Array.from(position),
		normal: Float32Array.from(normal),
		uv: Float32Array.from(uv),
		index: Uint16Array.from(index),
	};
}

/** One mesh per kind of part. Setup code. */
export function nightMeshes(
	blocks: number,
	designs: readonly BuildingDesign[],
): Record<NightMesh, MeshData> {
	const side = groundSide(blocks);
	const wheel = alongX(cylinderGeometry(0.34, 0.24, 14));
	const wheels = [
		[-0.86, 1.36],
		[0.86, 1.36],
		[-0.86, -1.36],
		[0.86, -1.36],
	].map(([x, z]) => translated(wheel, x as number, 0.34, z as number));
	const { length, width, ride, body, cabin } = CAR;
	const meshes: Partial<Record<NightMesh, MeshData>> = {
		ground: translated(
			{
				position: Float32Array.from([
					-side / 2,
					0,
					side / 2,
					side / 2,
					0,
					side / 2,
					side / 2,
					0,
					-side / 2,
					-side / 2,
					0,
					-side / 2,
				]),
				normal: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
				uv: Float32Array.from([
					-side / 2,
					side / 2,
					side / 2,
					side / 2,
					side / 2,
					-side / 2,
					-side / 2,
					-side / 2,
				]),
				index: Uint16Array.from([0, 1, 2, 0, 2, 3]),
			},
			0,
			0,
			0,
		),
		slab: mergeMeshes([boxAt(BLOCK_SIZE, SLAB_HEIGHT, BLOCK_SIZE, 0, SLAB_HEIGHT / 2, 0)]),
		lampPost: mergeMeshes([
			translated(cylinderGeometry(0.16, 0.5, 10), 0, 0.25, 0),
			translated(cylinderGeometry(0.085, LAMP.height, 10), 0, LAMP.height / 2, 0),
			boxAt(LAMP.arm, 0.08, 0.08, LAMP.arm / 2, LAMP.height - 0.1, 0),
			boxAt(0.78, 0.2, 0.4, LAMP.arm, LAMP.height - 0.16, 0),
		]),
		lampLens: boxAt(0.62, 0.04, 0.3, LAMP.arm, LAMP.height - 0.27, 0),
		signBoard: mergeMeshes([
			boxAt(SIGN.thickness, SIGN.height, SIGN.depth, 0, SIGN.height / 2, SIGN.depth / 2),
			boxAt(0.06, 0.06, 0.3, 0, SIGN.height + 0.1, 0.15),
			boxAt(0.06, 0.06, 0.3, 0, -0.1, 0.15),
		]),
		awning: awningMesh(1),
		carBody: mergeMeshes([
			boxAt(width, body, length, 0, ride + body / 2, 0),
			boxAt(width * 0.96, 0.07, length * 0.5, 0, ride + body + cabin + 0.035, -0.15),
			boxAt(width + 0.04, 0.16, 0.22, 0, ride + 0.12, length / 2 - 0.05),
			boxAt(width + 0.04, 0.16, 0.22, 0, ride + 0.12, -length / 2 + 0.05),
		]),
		carCabin: mergeMeshes([
			boxAt(width * 0.9, cabin, length * 0.52, 0, ride + body + cabin / 2, -0.15),
			...wheels,
			boxAt(width * 0.7, 0.18, 0.04, 0, ride + body * 0.45, length / 2 + 0.01),
		]),
		headlamps: mergeMeshes(HEADLAMPS.map(([x, y, z]) => boxAt(0.38, 0.14, 0.05, x, y, z))),
		tailLamps: mergeMeshes([
			boxAt(0.42, 0.11, 0.05, -0.62, 0.78, -length / 2 - 0.01),
			boxAt(0.42, 0.11, 0.05, 0.62, 0.78, -length / 2 - 0.01),
		]),
		// A flying car: a wide hull with two pods and a canopy, a lit strip across its nose and two
		// tail strips. It faces +Z, as the cars do.
		flyerBody: mergeMeshes([
			boxAt(2.2, 0.46, 4.6, 0, 0, 0),
			boxAt(1.5, 0.12, 3.2, 0, 0.29, -0.1),
			boxAt(1.14, 0.3, 1.9, 0, 0.5, -0.5),
			boxAt(0.66, 0.3, 4.1, -1.24, -0.02, 0.1),
			boxAt(0.66, 0.3, 4.1, 1.24, -0.02, 0.1),
			boxAt(1.9, 0.22, 0.5, 0, -0.12, 2.25),
		]),
		flyerHead: boxAt(1.5, 0.1, 0.06, 0, 0.02, 2.5),
		flyerTail: mergeMeshes([
			boxAt(0.45, 0.09, 0.05, -0.75, 0.02, -2.31),
			boxAt(0.45, 0.09, 0.05, 0.75, 0.02, -2.31),
		]),
		skyDome: skyDomeMesh(NIGHT_LOOK.dome.radius),
	};
	for (const [d, design] of designs.entries()) {
		meshes[`facade${d}`] = facadeMesh(design);
		meshes[`trim${d}`] = trimMesh(design, d);
	}
	for (let s = 0; s < SIGN_SHAPES; s++) meshes[`signTubes${s}`] = signTubesMesh(s);
	return meshes as Record<NightMesh, MeshData>;
}

// The town's state: what stands in each block, fixed at its start, and the motion as functions of
// the simulation time.

/** What every block holds, in flat arrays sized for the most blocks. */
export interface NightTown {
	/** Blocks with data. The first `activeBlocks` of them show. */
	capacity: number;
	activeBlocks: number;
	designs: BuildingDesign[];
	/** Block centers, x and z per block. */
	center: Float32Array;
	/** Each lot's design and its quarter turns, LOTS_PER_BLOCK per block. */
	lotDesign: Uint8Array;
	lotTurn: Uint8Array;
	/** Each sign's lot within its block, its shape and its color, SIGNS_PER_BLOCK per block. */
	signLot: Uint8Array;
	signShape: Uint8Array;
	signColor: Uint8Array;
	/** Each moving car's paint, speed in meters per second and start along its loop. */
	carPaint: Uint8Array;
	carSpeed: Float32Array;
	carPhase: Float32Array;
	/** Each parked car's paint, side of the block and place along it. */
	parkedPaint: Uint8Array;
	parkedSide: Uint8Array;
	parkedAlong: Float32Array;
}

/** The lots of a block: their centers from the block's center, and the street side each faces. */
export const LOT_OFFSETS = [
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
] as const;

/** Makes the town's data for up to `capacity` blocks. Setup code. */
export function createNightTown(capacity: number): NightTown {
	const blocks = Math.min(MAX_BLOCKS, Math.max(1, capacity));
	const town: NightTown = {
		capacity: blocks,
		activeBlocks: blocks,
		designs: buildingDesigns(),
		center: new Float32Array(blocks * 2),
		lotDesign: new Uint8Array(blocks * LOTS_PER_BLOCK),
		lotTurn: new Uint8Array(blocks * LOTS_PER_BLOCK),
		signLot: new Uint8Array(blocks * SIGNS_PER_BLOCK),
		signShape: new Uint8Array(blocks * SIGNS_PER_BLOCK),
		signColor: new Uint8Array(blocks * SIGNS_PER_BLOCK),
		carPaint: new Uint8Array(blocks * CARS_PER_BLOCK),
		carSpeed: new Float32Array(blocks * CARS_PER_BLOCK),
		carPhase: new Float32Array(blocks * CARS_PER_BLOCK),
		parkedPaint: new Uint8Array(blocks * PARKED_PER_BLOCK),
		parkedSide: new Uint8Array(blocks * PARKED_PER_BLOCK),
		parkedAlong: new Float32Array(blocks * PARKED_PER_BLOCK),
	};
	for (let b = 0; b < blocks; b++) {
		blockCenter(b, town.center, b * 2);
		const r = (k: number) => hash01(NIGHT_SEED, b + 1000, k);
		for (let l = 0; l < LOTS_PER_BLOCK; l++) {
			town.lotDesign[b * LOTS_PER_BLOCK + l] = Math.floor(r(l) * DESIGN_COUNT);
			// The front faces the street on the lot's side along Z: no turn toward +Z, half a turn
			// toward -Z.
			town.lotTurn[b * LOTS_PER_BLOCK + l] = (LOT_OFFSETS[l] as readonly number[])[1] === 1 ? 0 : 2;
		}
		// One sign on a lot of the -Z side and one on a lot of the +Z side.
		for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
			town.signLot[b * SIGNS_PER_BLOCK + s] = s * 2 + (r(10 + s) < 0.5 ? 0 : 1);
			town.signShape[b * SIGNS_PER_BLOCK + s] = Math.floor(r(12 + s) * SIGN_SHAPES);
			town.signColor[b * SIGNS_PER_BLOCK + s] = Math.floor(r(14 + s) * NEON_COLORS.length);
		}
		for (let c = 0; c < CARS_PER_BLOCK; c++) {
			const i = b * CARS_PER_BLOCK + c;
			town.carPaint[i] = Math.floor(r(20 + c) * CAR_PAINTS.length);
			town.carSpeed[i] = lerp(7, 11, r(22 + c));
			town.carPhase[i] = (c / CARS_PER_BLOCK + 0.2 * r(24 + c)) * LOOP_LENGTH;
		}
		for (let p = 0; p < PARKED_PER_BLOCK; p++) {
			const i = b * PARKED_PER_BLOCK + p;
			town.parkedPaint[i] = Math.floor(r(30 + p) * CAR_PAINTS.length);
			town.parkedSide[i] = (p * 2 + Math.floor(r(32 + p) * 2)) % 4;
			town.parkedAlong[i] = lerp(-8, 8, r(34 + p));
		}
	}
	return town;
}

/** Shows the first `blocks` blocks. */
export function setActiveBlocks(town: NightTown, blocks: number): void {
	town.activeBlocks = Math.max(1, Math.min(town.capacity, blocks));
}

/** Writes lot l of block b: its center x and z, and its turn about +Y in radians. */
export function lotPlace(town: NightTown, b: number, l: number, out: OutArray): void {
	const [sx, sz] = LOT_OFFSETS[l] as readonly [number, number];
	out[0] = (town.center[b * 2] as number) + (sx * LOT_SIZE) / 2;
	out[1] = (town.center[b * 2 + 1] as number) + (sz * LOT_SIZE) / 2;
	out[2] = ((town.lotTurn[b * LOTS_PER_BLOCK + l] as number) * Math.PI) / 2;
}

/**
 * Lamp k of block b: the post's place at the slab's corner, and its turn, which points the arm
 * over the street along X.
 */
export function lampPlace(town: NightTown, b: number, k: number, out: OutArray): void {
	const [sx, sz] = LOT_OFFSETS[k] as readonly [number, number];
	const corner = BLOCK_SIZE / 2 - LAMP.inset;
	out[0] = (town.center[b * 2] as number) + sx * corner;
	out[1] = (town.center[b * 2 + 1] as number) + sz * corner;
	out[2] = sx > 0 ? 0 : Math.PI;
}

/** Writes the world position of lamp k's light, under its head. */
export function lampLight(town: NightTown, b: number, k: number, out: OutArray): void {
	lampPlace(town, b, k, out);
	const yaw = out[2] as number;
	const x = out[0] as number;
	const z = out[1] as number;
	out[0] = x + Math.cos(yaw) * LAMP.arm;
	out[1] = LAMP.height - LAMP.lightDrop + SLAB_HEIGHT;
	out[2] = z - Math.sin(yaw) * LAMP.arm;
}

/**
 * Sign s of block b: where its board meets the wall, the turn of its building's front, and its
 * lot's x and z numbers for its flicker. The board stands near the front's right corner.
 */
export function signPlace(
	town: NightTown,
	b: number,
	s: number,
	out: OutArray,
	lot: Int32Array,
): void {
	const l = town.signLot[b * SIGNS_PER_BLOCK + s] as number;
	lotPlace(town, b, l, out);
	const design = town.designs[town.lotDesign[b * LOTS_PER_BLOCK + l] as number] as BuildingDesign;
	const yaw = out[2] as number;
	const lx = design.width / 2 - SIGN.inset;
	const lz = design.depth / 2;
	const c = Math.cos(yaw);
	const sn = Math.sin(yaw);
	const x = (out[0] as number) + c * lx + sn * lz;
	const z = (out[1] as number) - sn * lx + c * lz;
	out[0] = x;
	out[1] = z;
	lotOf(x - sn * 0.01, z - c * 0.01, lot);
}

/** The world position of a sign's light: in front of the board's middle. */
export function signLight(
	town: NightTown,
	b: number,
	s: number,
	out: OutArray,
	lot: Int32Array,
): void {
	signPlace(town, b, s, out, lot);
	const yaw = out[2] as number;
	const x = out[0] as number;
	const z = out[1] as number;
	const reach = SIGN.depth * 0.6;
	out[0] = x + Math.sin(yaw) * reach;
	out[1] = SLAB_HEIGHT + SIGN.bottom + SIGN.height / 2;
	out[2] = z + Math.cos(yaw) * reach;
}

/** Sign s's awning: the center of its top edge at the wall, its turn and its width. */
export function awningPlace(town: NightTown, b: number, s: number, out: OutArray): void {
	const l = town.signLot[b * SIGNS_PER_BLOCK + s] as number;
	lotPlace(town, b, l, out);
	const design = town.designs[town.lotDesign[b * LOTS_PER_BLOCK + l] as number] as BuildingDesign;
	const yaw = out[2] as number;
	const lz = design.depth / 2 + 0.02;
	out[0] = (out[0] as number) + Math.sin(yaw) * lz;
	out[1] = (out[1] as number) + Math.cos(yaw) * lz;
	out[3] = design.width * AWNING.share;
}

// The cars' loop: each block's moving cars circle it clockwise seen from above, in the lane next
// to the parked cars. The loop is a square with rounded corners, so neighbouring blocks' cars pass
// each other in their own lanes and never cross.

/** The lane's distance from the block's center, and the corners' radius. */
export const LOOP_HALF = BLOCK_SIZE / 2 + 3.1;
export const LOOP_CORNER = 5.5;
const LOOP_STRAIGHT = 2 * (LOOP_HALF - LOOP_CORNER);
const LOOP_ARC = (Math.PI / 2) * LOOP_CORNER;
const LOOP_SIDE = LOOP_STRAIGHT + LOOP_ARC;
export const LOOP_LENGTH = 4 * LOOP_SIDE;

/**
 * Writes the place on block b's loop at distance s along it: x and z from the block's center and
 * the heading (the car's turn about +Y, with its front along +Z at 0). Allocates nothing.
 */
export function loopPose(s: number, out: OutArray): void {
	const d = ((s % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
	const side = Math.floor(d / LOOP_SIDE);
	const along = d - side * LOOP_SIDE;
	const a = LOOP_HALF - LOOP_CORNER;
	let x: number;
	let z: number;
	let dx: number;
	let dz: number;
	if (along < LOOP_STRAIGHT) {
		// Along the -Z side toward +X.
		x = -a + along;
		z = -LOOP_HALF;
		dx = 1;
		dz = 0;
	} else {
		const theta = -Math.PI / 2 + (along - LOOP_STRAIGHT) / LOOP_CORNER;
		x = a + LOOP_CORNER * Math.cos(theta);
		z = -a + LOOP_CORNER * Math.sin(theta);
		dx = -Math.sin(theta);
		dz = Math.cos(theta);
	}
	// Each side is the first one turned a quarter clockwise, seen from above, per side.
	for (let k = 0; k < side; k++) {
		const tx = x;
		x = -z;
		z = tx;
		const tdx = dx;
		dx = -dz;
		dz = tdx;
	}
	out[0] = x;
	out[1] = z;
	out[2] = Math.atan2(dx, dz);
}

/** Writes moving car c of block b at simulation time `seconds`: world x, z and its heading. */
export function carPose(
	town: NightTown,
	b: number,
	c: number,
	seconds: number,
	out: OutArray,
): void {
	const i = b * CARS_PER_BLOCK + c;
	loopPose((town.carPhase[i] as number) + (town.carSpeed[i] as number) * seconds, out);
	out[0] = (out[0] as number) + (town.center[b * 2] as number);
	out[1] = (out[1] as number) + (town.center[b * 2 + 1] as number);
}

/** Writes parked car p of block b: world x, z and its heading, along the curb. */
export function parkedPose(town: NightTown, b: number, p: number, out: OutArray): void {
	const i = b * PARKED_PER_BLOCK + p;
	const side = town.parkedSide[i] as number;
	let x = town.parkedAlong[i] as number;
	let z = -(BLOCK_SIZE / 2 + 1.15);
	let heading = Math.PI / 2;
	for (let k = 0; k < side; k++) {
		const t = x;
		x = -z;
		z = t;
		heading -= Math.PI / 2;
	}
	out[0] = x + (town.center[b * 2] as number);
	out[1] = z + (town.center[b * 2 + 1] as number);
	out[2] = heading;
}

/** Writes a point in a car's frame to the world, for a car at (x, z) with a heading. */
export function carToWorld(
	pose: OutArray,
	px: number,
	py: number,
	pz: number,
	out: OutArray,
	offset = 0,
): void {
	const yaw = pose[2] as number;
	const c = Math.cos(yaw);
	const s = Math.sin(yaw);
	out[offset] = (pose[0] as number) + c * px + s * pz;
	out[offset + 1] = py;
	out[offset + 2] = (pose[1] as number) - s * px + c * pz;
}

// Particles: steam from a manhole in each block's street and from each roof vent, exhaust behind
// each moving car, a glow around every lamp, sign and headlight, and rain around the camera. Every
// writer works out its rows from the simulation time, from the first row, and returns the count of
// rows it wrote.

export const STEAM_PER_VENT = 9;
/** Vents per block: the manhole and the four roofs. */
export const VENTS_PER_BLOCK = 1 + LOTS_PER_BLOCK;
export const STEAM_PER_BLOCK = VENTS_PER_BLOCK * STEAM_PER_VENT;
export const EXHAUST_PER_CAR = 6;
export const GLOWS_PER_BLOCK = LAMPS_PER_BLOCK + SIGNS_PER_BLOCK + CARS_PER_BLOCK * 3;
export const RAIN_DROPS = 4_000;
/** The box of rain around the camera: its half width and its height. */
export const RAIN_BOX = { half: 26, height: 22, speed: 11, size: 0.3 } as const;

const STEAM_LIFE = 5.5;
const EXHAUST_LIFE = 1.4;

const pose = new Float64Array(3);
const spot = new Float64Array(3);
const flyerAt = new Float64Array(4);
const lotScratch = new Int32Array(2);

/** Adds one round sprite with no turn, from the first frame of its layer's atlas. */
function sprite(
	rows: SpriteRows,
	x: number,
	y: number,
	z: number,
	size: number,
	r: number,
	g: number,
	b: number,
	a: number,
): void {
	addSprite(rows, x, y, z, size, 0, r, g, b, a, 0);
}

/** Writes the steam of the shown blocks' vents. */
export function writeSteam(town: NightTown, seconds: number, rows: SpriteRows): number {
	const { steam } = NIGHT_LOOK;
	rows.count = 0;
	for (let b = 0; b < town.activeBlocks; b++) {
		for (let v = 0; v < VENTS_PER_BLOCK; v++) {
			let x: number;
			let y: number;
			let z: number;
			let scale = 1;
			if (v === 0) {
				// The manhole lies in the street on the block's +X side.
				x = (town.center[b * 2] as number) + BLOCK_PITCH / 2 + 2.2;
				y = 0.05;
				z = (town.center[b * 2 + 1] as number) + 6;
				scale = 1.8;
			} else {
				const l = v - 1;
				lotPlace(town, b, l, pose);
				const design = town.designs[
					town.lotDesign[b * LOTS_PER_BLOCK + l] as number
				] as BuildingDesign;
				const yaw = pose[2] as number;
				const [vx, vy, vz] = design.vent;
				x = (pose[0] as number) + Math.cos(yaw) * vx + Math.sin(yaw) * vz;
				y = vy + SLAB_HEIGHT;
				z = (pose[1] as number) - Math.sin(yaw) * vx + Math.cos(yaw) * vz;
			}
			for (let k = 0; k < STEAM_PER_VENT; k++) {
				const seed = (b * VENTS_PER_BLOCK + v) * STEAM_PER_VENT + k;
				const cycle = seconds / STEAM_LIFE + k / STEAM_PER_VENT + hash01(NIGHT_SEED, seed, 3) * 0.1;
				const born = Math.floor(cycle);
				const age = cycle - born;
				const drift = hash01(NIGHT_SEED, seed, born) * TAU;
				const rise = age * 3.2 * scale;
				const spread = age * 0.9 * scale;
				const fade = smoothstep(age * 6) * (1 - age) ** 1.5;
				sprite(
					rows,
					x + Math.cos(drift) * spread + age * 0.8,
					y + rise,
					z + Math.sin(drift) * spread,
					(0.5 + 2.4 * age) * scale,
					steam.color[0],
					steam.color[1],
					steam.color[2],
					steam.alpha * fade,
				);
			}
		}
	}
	return rows.count;
}

/** Writes the exhaust behind the shown blocks' moving cars. */
export function writeExhaust(town: NightTown, seconds: number, rows: SpriteRows): number {
	const { exhaust } = NIGHT_LOOK;
	rows.count = 0;
	for (let b = 0; b < town.activeBlocks; b++)
		for (let c = 0; c < CARS_PER_BLOCK; c++) {
			const i = b * CARS_PER_BLOCK + c;
			for (let k = 0; k < EXHAUST_PER_CAR; k++) {
				const age = (((seconds / EXHAUST_LIFE + k / EXHAUST_PER_CAR) % 1) + 1) % 1;
				// A puff stays where the pipe was when it left: the car's pose `age` seconds ago.
				carPose(town, b, c, seconds - age * EXHAUST_LIFE, pose);
				carToWorld(pose, TAILPIPE[0], TAILPIPE[1], TAILPIPE[2], spot);
				const fade = smoothstep(age * 8) * (1 - age);
				const wobble = hash01(NIGHT_SEED, i * EXHAUST_PER_CAR + k, 7) - 0.5;
				sprite(
					rows,
					(spot[0] as number) + wobble * age,
					(spot[1] as number) + age * 0.6,
					(spot[2] as number) - wobble * age,
					0.25 + 0.9 * age,
					exhaust.color[0],
					exhaust.color[1],
					exhaust.color[2],
					exhaust.alpha * fade,
				);
			}
		}
	return rows.count;
}

/**
 * Writes the glows of the shown blocks: a soft halo in the haze around every lamp, sign, headlamp,
 * tail lamp and flying car, in its light's color. A sign's glow flickers with its tubes.
 */
export function writeGlows(town: NightTown, seconds: number, rows: SpriteRows): number {
	const { glow } = NIGHT_LOOK;
	rows.count = 0;
	for (let b = 0; b < town.activeBlocks; b++) {
		for (let k = 0; k < LAMPS_PER_BLOCK; k++) {
			lampLight(town, b, k, spot);
			const [r, g, bl] = LAMP_LIGHT.linear;
			sprite(
				rows,
				spot[0] as number,
				(spot[1] as number) + 0.12,
				spot[2] as number,
				glow.lampSize,
				r * glow.lamp,
				g * glow.lamp,
				bl * glow.lamp,
				1,
			);
		}
		for (let s = 0; s < SIGNS_PER_BLOCK; s++) {
			signLight(town, b, s, spot, lotScratch);
			const flicker = signFlicker(seconds, lotScratch[0] as number, lotScratch[1] as number);
			const [r, g, bl] = (
				NEON_COLORS[town.signColor[b * SIGNS_PER_BLOCK + s] as number] as NeonColor
			).linear;
			const k = glow.sign * flicker;
			sprite(
				rows,
				spot[0] as number,
				spot[1] as number,
				spot[2] as number,
				glow.signSize,
				r * k,
				g * k,
				bl * k,
				1,
			);
		}
		for (let c = 0; c < CARS_PER_BLOCK; c++) {
			carPose(town, b, c, seconds, pose);
			for (const [x, y, z] of HEADLAMPS) {
				carToWorld(pose, x, y, z + 0.1, spot);
				sprite(
					rows,
					spot[0] as number,
					spot[1] as number,
					spot[2] as number,
					glow.headSize,
					glow.head,
					glow.head,
					glow.head * 0.92,
					1,
				);
			}
			carToWorld(pose, TAIL_LIGHT[0], TAIL_LIGHT[1], TAIL_LIGHT[2] + 0.2, spot);
			sprite(
				rows,
				spot[0] as number,
				spot[1] as number,
				spot[2] as number,
				glow.tailSize,
				glow.tail,
				0,
				0,
				1,
			);
		}
	}
	// The flying cars show by their lights, a warm one at the nose and a red one at the tail.
	const [fx, fy, fz] = FLYER_HEAD;
	for (let i = 0; i < FLYER_COUNT; i++) {
		flyerPose(seconds, i, flyerAt);
		const x = flyerAt[0] as number;
		const y = flyerAt[1] as number;
		const z = flyerAt[2] as number;
		const c = Math.cos(flyerAt[3] as number);
		const s = Math.sin(flyerAt[3] as number);
		sprite(
			rows,
			x + c * fx + s * fz,
			y + fy,
			z - s * fx + c * fz,
			glow.flyerSize,
			glow.flyer,
			glow.flyer * 0.92,
			glow.flyer * 0.8,
			1,
		);
		sprite(rows, x - s * 2.3, y + 0.02, z - c * 2.3, glow.flyerSize * 0.75, glow.flyer, 0, 0, 1);
	}
	return rows.count;
}

/**
 * Writes the rain: drops that fall through a box around the camera and wrap at its sides, so the
 * camera always stands in rain. Each drop's place in the box is fixed by its number.
 */
export function writeRain(seconds: number, camera: OutArray, rows: SpriteRows): number {
	const { half, height, speed, size } = RAIN_BOX;
	const { rain } = NIGHT_LOOK;
	const side = 2 * half;
	const cx = camera[0] as number;
	const cy = camera[1] as number;
	const cz = camera[2] as number;
	rows.count = 0;
	for (let i = 0; i < RAIN_DROPS; i++) {
		const wrap = (base: number, at: number) =>
			at + ((((base - at) % side) + side * 1.5) % side) - half;
		const x = wrap(hash01(NIGHT_SEED, i, 1) * side, cx);
		const z = wrap(hash01(NIGHT_SEED, i, 2) * side, cz);
		const fall = (hash01(NIGHT_SEED, i, 3) * height + seconds * speed) % height;
		const y = cy + height / 2 - fall;
		// Drops fade out as they near the camera, where a streak would fill the view.
		const near = smoothstep((Math.hypot(x - cx, y - cy, z - cz) - 1.5) / 4);
		sprite(rows, x, y, z, size, rain.color[0], rain.color[1], rain.color[2], rain.alpha * near);
	}
	return rows.count;
}

/** The town's layers of sprites. */
export const NIGHT_SPRITES = ['steam', 'exhaust', 'glows', 'rain'] as const;
export type NightSprite = (typeof NIGHT_SPRITES)[number];

/** How each layer of sprites draws, with room for `capacity` blocks. Setup code. */
export function nightSpriteLayers(capacity: number): Record<NightSprite, SpriteLayer> {
	return {
		steam: {
			capacity: capacity * STEAM_PER_BLOCK,
			blending: 'normal',
			atlas: puffAtlas(),
			fog: true,
		},
		exhaust: {
			capacity: capacity * CARS_PER_BLOCK * EXHAUST_PER_CAR,
			blending: 'normal',
			atlas: puffAtlas(64, 9),
			fog: true,
		},
		glows: {
			capacity: capacity * GLOWS_PER_BLOCK + FLYER_COUNT * 2,
			blending: 'additive',
			atlas: glowAtlas(),
			fog: false,
		},
		rain: { capacity: RAIN_DROPS, blending: 'normal', atlas: rainAtlas(), fog: true },
	};
}

/** Each layer's rows, and the engine's drawn layer for it. */
export interface NightSprites<Drawn> {
	rows: Record<NightSprite, SpriteRows>;
	drawn: Record<NightSprite, Drawn>;
}

/** Makes each layer's rows, and an engine's drawn layer with `make`. Setup code. */
export async function makeNightSprites<Drawn extends { draw(rows: SpriteRows): void }>(
	capacity: number,
	make: (layer: SpriteLayer) => Promise<Drawn>,
): Promise<NightSprites<Drawn>> {
	const layers = nightSpriteLayers(capacity);
	const rows = {} as Record<NightSprite, SpriteRows>;
	const drawn = {} as Record<NightSprite, Drawn>;
	for (const name of NIGHT_SPRITES) {
		rows[name] = createSpriteRows(layers[name].capacity);
		drawn[name] = await make(layers[name]);
	}
	return { rows, drawn };
}

/** Writes every layer's rows for simulation time `seconds`, and draws them. Allocates nothing. */
export function drawNightSprites<Drawn extends { draw(rows: SpriteRows): void }>(
	town: NightTown,
	seconds: number,
	camera: OutArray,
	{ rows, drawn }: NightSprites<Drawn>,
): void {
	writeSteam(town, seconds, rows.steam);
	writeExhaust(town, seconds, rows.exhaust);
	writeGlows(town, seconds, rows.glows);
	writeRain(seconds, camera, rows.rain);
	for (const name of NIGHT_SPRITES) drawn[name].draw(rows[name]);
}

// Textures made in code: the facades, the street and the sidewalk.

/** The facade map's layout: each tile spans one bay across, the ground floor below and a floor above. */
export const FACADE_TEXTURE = 512;

/** A facade kind's wall color, its windows' share of a bay, and its window frames' paint or metal. */
const FACADE_LOOKS: Readonly<
	Record<
		FacadeKind,
		{
			wall: readonly [number, number, number];
			glassShare: number;
			frame: readonly [number, number, number];
			frameMetal: number;
		}
	>
> = {
	brick: { wall: [0.5, 0.22, 0.15], glassShare: 0.48, frame: [0.62, 0.6, 0.55], frameMetal: 0 },
	plaster: { wall: [0.7, 0.62, 0.5], glassShare: 0.48, frame: [0.13, 0.2, 0.17], frameMetal: 0 },
	concrete: {
		wall: [0.5, 0.5, 0.48],
		glassShare: 0.56,
		frame: [0.42, 0.43, 0.45],
		frameMetal: 0.8,
	},
	glass: { wall: [0.13, 0.15, 0.17], glassShare: 0.9, frame: [0.09, 0.09, 0.1], frameMetal: 0.85 },
};

/** The maps of a facade: color with the window mask in alpha, packed occlusion, roughness, metalness, and normals. */
export interface FacadeMaps {
	color: TextureData;
	orm: TextureData;
	normal: TextureData;
}

/** The bay's width that the facade map draws, in meters: each wall's bays stretch it a little. */
const TILE_WIDTH = BAY;

/** One texel of a facade: its sRGB color, whether it is glass, its roughness, metalness and height. */
interface FacadeTexel {
	r: number;
	g: number;
	b: number;
	glass: boolean;
	roughness: number;
	metalness: number;
	height: number;
}

/**
 * The window of a floor: the glass's edges across the bay (u) and up the floor (from 0 at its
 * floor to 1 at the next). The ground floor holds a wide shop window under the sign fascia.
 */
function windowBox(kind: FacadeKind, ground: boolean): readonly [number, number, number, number] {
	if (ground) return [0.06, 0.94, 0.06, 0.68];
	const half = FACADE_LOOKS[kind].glassShare / 2;
	return kind === 'glass'
		? [0.5 - half, 0.5 + half, 0.08, 0.94]
		: [0.5 - half, 0.5 + half, 0.22, 0.84];
}

/** Each facade kind's windows on an upper floor, as the shaders draw the room behind them: u0, u1, v0, v1. */
export const FACADE_WINDOW: Readonly<
	Record<FacadeKind, readonly [number, number, number, number]>
> = {
	brick: windowBox('brick', false),
	plaster: windowBox('plaster', false),
	concrete: windowBox('concrete', false),
	glass: windowBox('glass', false),
};

/** How far the room behind a window reaches back from its glass, in meters. */
export const ROOM_DEPTH = 2.4;

/** The distance from a place to the nearest of some lines across one axis. */
function nearLine(at: number, lines: readonly number[]): number {
	let best = Number.POSITIVE_INFINITY;
	for (const line of lines) best = Math.min(best, Math.abs(at - line));
	return best;
}

/**
 * A facade texel at (u, v) of the tile. Walls by kind: bricks of uneven shades in light mortar with
 * a soldier course over each window; concrete panels with seams, tie holes and rain stains under
 * the windows; plaster with grooved courses on the ground floor; or a glass curtain wall with dark
 * spandrels. Every window has a frame that stands out from the glass, with mullions and a transom,
 * and soot gathers under the sills.
 */
function facadeTexel(kind: FacadeKind, u: number, v: number, seed: number): FacadeTexel {
	const look = FACADE_LOOKS[kind];
	const ground = v < 0.5;
	const fv = ground ? v * 2 : (v - 0.5) * 2;
	const floor = ground ? GROUND_FLOOR : FLOOR_HEIGHT;
	// Meters across the bay and up the floor.
	const x = u * TILE_WIDTH;
	const y = fv * floor;
	const [u0, u1, v0, v1] = windowBox(kind, ground);
	const left = u0 * TILE_WIDTH;
	const right = u1 * TILE_WIDTH;
	const bottom = v0 * floor;
	const top = v1 * floor;
	// The distance into the glass, negative outside it.
	const inward = Math.min(x - left, right - x, y - bottom, top - y);
	const grime = fbm(u, v, 4, 4, seed + 3);

	// The frame around the glass, and the bars that split it into panes.
	const frameWidth = ground ? 0.09 : 0.07;
	if (inward > -frameWidth) {
		let bar = inward < 0.03;
		if (!bar && inward > 0) {
			const across = (left + right) / 2;
			if (kind === 'glass') {
				const pane = (right - left) / 4;
				bar =
					nearLine(x, [left + pane, left + 2 * pane, left + 3 * pane]) < 0.025 ||
					Math.abs(y - (bottom + top) / 2) < 0.03;
			} else if (ground) {
				const third = (right - left) / 3;
				bar =
					nearLine(x, [left + third, left + 2 * third]) < 0.035 ||
					Math.abs(y - (bottom + 0.78 * (top - bottom))) < 0.035;
			} else {
				bar =
					Math.abs(x - across) < 0.025 || Math.abs(y - (bottom + 0.68 * (top - bottom))) < 0.025;
			}
		}
		if (bar || inward <= 0) {
			const [fr, fg, fb] = look.frame;
			const wear = 0.85 + 0.25 * grime;
			return {
				r: fr * wear,
				g: fg * wear,
				b: fb * wear,
				glass: false,
				roughness: look.frameMetal > 0 ? 0.35 : 0.5,
				metalness: look.frameMetal,
				height: inward <= 0 ? 0.5 : 0.42,
			};
		}
		// The glass, darker under the window's head where the reveal shades it.
		const reveal = 0.6 + 0.4 * smoothstep((top - y) / 0.25);
		return {
			r: 0.05 * reveal,
			g: 0.06 * reveal,
			b: 0.07 * reveal,
			glass: true,
			roughness: 0.06,
			metalness: 0,
			height: 0.3,
		};
	}

	// The wall.
	let [r, g, b] = look.wall;
	let shade = 0.85 + 0.3 * grime;
	let roughness = 0.82 + 0.1 * grime;
	let height = 0.62 + 0.06 * grime;
	if (kind === 'brick') {
		const course = 0.133;
		const length = 0.3;
		const row = Math.floor(y / course);
		// A soldier course of upright bricks over each window, a little wider than it.
		const soldier =
			!ground && y > top + 0.08 && y < top + 0.08 + 0.24 && x > left - 0.12 && x < right + 0.12;
		const along = soldier ? x / 0.09 : x / length + (row % 2) * 0.5;
		const brick = Math.floor(along);
		const joint = soldier
			? along - brick < 0.12 || y < top + 0.1 || y > top + 0.3
			: (y / course) % 1 < 0.12 || along - brick < 0.05;
		if (joint) {
			r = 0.42;
			g = 0.4;
			b = 0.37;
			shade = 0.9 + 0.2 * grime;
			roughness = 0.95;
			height = 0.42;
		} else {
			const pick = hash01(seed, row + (soldier ? 977 : 0), brick + (ground ? 4099 : 0));
			const speckle = tiledNoise(u * 180, v * 180, 180, seed + 21);
			shade *= 0.72 + 0.42 * pick + 0.08 * speckle;
			if (pick < 0.12) shade *= 0.6;
			else if (pick > 0.9) {
				r *= 1.16;
				g *= 1.12;
				b *= 0.85;
			}
			if (soldier) shade *= 0.82;
			height = 0.62 + 0.05 * speckle;
		}
	} else if (kind === 'concrete') {
		const seam = x < 0.015 || x > TILE_WIDTH - 0.015 || y < 0.02 || y > floor - 0.02;
		const panelY = ground ? y : y - 0.2;
		const tie =
			Math.hypot(((x / (TILE_WIDTH / 4)) % 1) - 0.5, (((panelY + 0.5) / 0.8) % 1) - 0.5) < 0.05;
		const aggregate = tiledNoise(u * 220, v * 220, 220, seed + 23);
		shade *= 0.9 + 0.18 * aggregate;
		// Rain stains run down from each sill's ends.
		if (!ground && y < bottom) {
			const streak = tiledNoise(u * 48, v * 3, 48, seed + 25);
			const under = smoothstep(1 - (x < left ? left - x : x > right ? x - right : 0) / 0.25);
			shade *= 1 - 0.35 * under * streak * smoothstep(1 - (bottom - y) / 1.6);
		}
		if (seam || tie) {
			shade *= 0.55;
			height = 0.4;
		}
	} else if (kind === 'plaster') {
		shade *= 0.9 + 0.14 * tiledNoise(u * 96, v * 96, 96, seed + 9);
		// Grooved courses on the ground floor, and a band at each floor's foot.
		if ((ground && y % 0.42 < 0.03) || (!ground && y < 0.18)) {
			shade *= ground ? 0.6 : 1.15;
			height = ground ? 0.4 : 0.72;
		}
	} else {
		// Spandrels of dark stone between the glass of each floor.
		roughness = 0.4;
		shade *= 0.9 + 0.2 * tiledNoise(u * 64, v * 64, 64, seed + 27);
	}
	// Soot under the sills, and damp at the foot of the building.
	if (!ground && y < bottom && x > left - 0.1 && x < right + 0.1)
		shade *= 0.75 + 0.25 * smoothstep((bottom - y) / 0.9);
	if (ground && y < 0.6) {
		shade *= 0.7 + 0.3 * smoothstep(y / 0.6);
		roughness *= 0.6;
	}
	return {
		r: r * shade,
		g: g * shade,
		b: b * shade,
		glass: false,
		roughness,
		metalness: 0,
		height,
	};
}

/** The facade maps of a kind, FACADE_TEXTURE texels a side. Setup code. */
export function facadeMaps(kind: FacadeKind, seed = NIGHT_SEED): FacadeMaps {
	const size = FACADE_TEXTURE;
	const color = new Uint8Array(size * size * 4);
	const orm = new Uint8Array(size * size * 4);
	const normal = new Uint8Array(size * size * 4);
	const height = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const t = facadeTexel(kind, (x + 0.5) / size, (y + 0.5) / size, seed);
			color.set([byte(t.r), byte(t.g), byte(t.b), t.glass ? 255 : 0], i * 4);
			orm.set([255, byte(t.roughness), byte(t.metalness), 255], i * 4);
			height[i] = t.height;
		}
	normalFromHeight(height, size, 6, normal);
	return {
		color: { size, data: color, colorSpace: 'srgb' },
		orm: { size, data: orm, colorSpace: 'linear' },
		normal: { size, data: normal, colorSpace: 'linear' },
	};
}

/** Writes a tangent-space normal map from heights, wrapping at the edges. */
function normalFromHeight(
	height: Float32Array,
	size: number,
	depth: number,
	out: Uint8Array,
): void {
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const h = (dx: number, dy: number) =>
				height[((y + dy + size) % size) * size + ((x + dx + size) % size)] as number;
			const nx = (h(-1, 0) - h(1, 0)) * depth;
			const ny = (h(0, -1) - h(0, 1)) * depth;
			const length = Math.hypot(nx, ny, 1);
			out.set(
				[
					byte(0.5 + (0.5 * nx) / length),
					byte(0.5 + (0.5 * ny) / length),
					byte(0.5 + 0.5 / length),
					255,
				],
				(y * size + x) * 4,
			);
		}
}

/** The street's maps: asphalt that tiles every STREET_TILE meters, and the puddles' map. */
export const STREET_TILE = 4;
export const PUDDLE_TILE = 36;
export const STREET_TEXTURE = 256;

/**
 * The asphalt's maps, and the puddles' depth in the red channel of a map of its own. The color
 * map's alpha holds the cracks, which collect water.
 */
export function streetMaps(seed = NIGHT_SEED): FacadeMaps & { puddles: TextureData } {
	const size = STREET_TEXTURE;
	const color = new Uint8Array(size * size * 4);
	const orm = new Uint8Array(size * size * 4);
	const normal = new Uint8Array(size * size * 4);
	const puddles = new Uint8Array(size * size * 4);
	const height = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			const i = y * size + x;
			const stones = tiledNoise(u * 96, v * 96, 96, seed + 1);
			const patch = fbm(u, v, 3, 4, seed + 2);
			const crack = Math.abs(fbm(u, v, 5, 3, seed + 4) - 0.5) < 0.012 ? 1 : 0;
			const shade = (0.16 + 0.05 * stones + 0.06 * patch) * (1 - 0.5 * crack);
			color.set([byte(shade), byte(shade), byte(shade * 1.04), byte(crack)], i * 4);
			orm.set([255, byte(0.78 + 0.15 * stones), 0, 255], i * 4);
			height[i] = 0.5 + 0.3 * stones - 0.4 * crack;
			const depth = fbm(u, v, 3, 5, seed + 6);
			puddles.set([byte(depth), byte(fbm(u, v, 6, 3, seed + 8)), 0, 255], i * 4);
		}
	normalFromHeight(height, size, 2, normal);
	return {
		color: { size, data: color, colorSpace: 'srgb' },
		orm: { size, data: orm, colorSpace: 'linear' },
		normal: { size, data: normal, colorSpace: 'linear' },
		puddles: { size, data: puddles, colorSpace: 'linear' },
	};
}

/** The sidewalk: square flags of stone, 1.5 m a side, with the texture spanning two by two. */
export const SIDEWALK_TILE = 3;
export function sidewalkMaps(seed = NIGHT_SEED): FacadeMaps {
	const size = 128;
	const color = new Uint8Array(size * size * 4);
	const orm = new Uint8Array(size * size * 4);
	const normal = new Uint8Array(size * size * 4);
	const height = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			const i = y * size + x;
			const flag = hash01(seed, Math.floor(u * 2), Math.floor(v * 2));
			const joint = (u * 2) % 1 < 0.025 || (v * 2) % 1 < 0.025;
			const grain = tiledNoise(u * 64, v * 64, 64, seed + 11);
			const shade = joint ? 0.12 : 0.3 + 0.08 * flag + 0.05 * grain;
			color.set([byte(shade), byte(shade * 0.98), byte(shade * 0.95), 255], i * 4);
			orm.set([255, byte(joint ? 0.3 : 0.55 + 0.2 * grain), 0, 255], i * 4);
			height[i] = joint ? 0.2 : 0.6 + 0.1 * grain;
		}
	normalFromHeight(height, size, 3, normal);
	return {
		color: { size, data: color, colorSpace: 'srgb' },
		orm: { size, data: orm, colorSpace: 'linear' },
		normal: { size, data: normal, colorSpace: 'linear' },
	};
}

// Colors and surfaces.

/** sRGB hex to linear components, as both engines convert colors. */
export function linearOf(hex: Hex): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	const channel = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
}

export interface NeonColor {
	hex: Hex;
	linear: [number, number, number];
}
const neon = (hex: Hex): NeonColor => ({ hex, linear: linearOf(hex) });
/** The signs' colors: pink, cyan, amber and green. */
export const NEON_COLORS: readonly NeonColor[] = [
	neon('#ff2d95'),
	neon('#2de2ff'),
	neon('#ffb02d'),
	neon('#7dff5a'),
];

/** The car paints. */
export const CAR_PAINTS: readonly Hex[] = [
	'#b0161c',
	'#1d3f8a',
	'#e8e6e0',
	'#1c1c1f',
	'#d9a51e',
	'#2d6b4f',
];

/** The street lamps' light: a warm sodium white. */
export const LAMP_LIGHT = { hex: '#ffb469' as Hex, linear: linearOf('#ffb469') };

/** The share of each facade kind's windows that are lit. */
export const FACADE_LIT_SHARE: Readonly<Record<FacadeKind, number>> = {
	brick: 0.42,
	plaster: 0.38,
	concrete: 0.34,
	glass: 0.5,
};

/** The look: the moonlit sky, the lights, fog, bloom, ambient occlusion, tone curve and grade. */
export const NIGHT_LOOK = {
	/** `timeOfDay(23, { heading, noonElevation })`: the moon low over the far end of the street shot. */
	time: { hours: 23, heading: 0.4, noonElevation: 0.5 },
	/**
	 * That time's sky with clearer air, which three.js's Sky draws alike. It gives the town its
	 * environment light; the sky dome draws the sky that shows.
	 */
	sky: {
		sunPosition: [-0.09171388153626528, 0.4630895095203464, -0.8815535548710339] as const,
		turbidity: 2,
		rayleigh: 2,
		mieCoefficient: 0.002,
		mieDirectionalG: 0.6,
	},
	/** The factor of the sky's light, which dims the moon's day-for-night sky. */
	skyIntensity: 0.002283920577915905,
	/**
	 * The sky that shows: a dome around the camera with clouds that drift and that the moon lights
	 * from behind, the moon's disc and halo, stars in the gaps, and the city's glow low down. `cover`
	 * is the clouds' share of the sky and `brightness` scales the whole dome.
	 */
	dome: { radius: 700, cover: 0.55, brightness: 1 },
	/** The moon: its direction of travel, linear color and intensity. */
	moon: {
		direction: [0.09171388153626528, -0.4630895095203464, 0.8815535548710339] as const,
		color: [0.55, 0.68, 1] as const,
		intensity: 0.4,
		shadowDistance: 160,
	},
	exposure: 3.5,
	/** Height fog: dense near the ground, with a glow toward the moon. */
	fog: {
		color: '#0b1220' as Hex,
		density: 0.011,
		height: 0,
		heightFalloff: 0.045,
		sunGlow: 0.15,
		sunGlowExponent: 6,
	},
	background: '#05080f' as Hex,
	camera: { fov: 50, near: 0.1, far: 900 },
	/** Lights, in candela as three.js's units since r155. */
	lamp: { intensity: 26, range: 17, decay: 2, lens: 9 },
	sign: { intensity: 36, range: 12, decay: 2, tubes: 2.2 },
	headlight: {
		color: '#fff3dc' as Hex,
		intensity: 90,
		range: 30,
		decay: 2,
		angle: 0.42,
		penumbra: 0.55,
		lens: 14,
	},
	tail: { color: '#ff1a10' as Hex, intensity: 3, range: 5, decay: 2, lens: 5 },
	/** The windows' light, scaled per window by the facade shader, and the shops' neon. */
	windows: { intensity: 0.3, shops: 0.22, neon: 1.2 },
	/** The awnings' stripes. */
	awning: {
		colors: ['#7a1420', '#1b4d5c', '#6b4a12', '#24452a'] as const satisfies readonly Hex[],
	},
	steam: { color: [0.24, 0.24, 0.26] as const, alpha: 0.4 },
	exhaust: { color: [0.2, 0.2, 0.21] as const, alpha: 0.3 },
	rain: { color: [0.14, 0.16, 0.2] as const, alpha: 0.4 },
	glow: {
		lamp: 0.22,
		lampSize: 4.5,
		sign: 0.3,
		signSize: 6,
		head: 0.5,
		headSize: 1.4,
		tail: 0.35,
		tailSize: 0.9,
		flyer: 0.65,
		flyerSize: 2.8,
	},
	/**
	 * The street's wetness: the puddles' share, how dark wet asphalt turns, and how much of the
	 * mirror the wet asphalt between the puddles shows.
	 */
	street: { puddleShare: 0.6, wetDarken: 0.25, wetMirror: 0.5 },
	/**
	 * Screen-space reflections, for when the comparison draws them: null3D's `post.set({ ssr })`
	 * and three.js's SSR passes. They then take the wet asphalt's share of the mirror and the cars'
	 * and windows' reflections.
	 */
	ssr: { intensity: 1, maxDistance: 60, thickness: 0.6, maxRoughness: 0.45 },
	/** Bloom, as UnrealBloomPass's settings; the others map it as Factory's look does. */
	bloom: { threshold: 1, strength: 0.6, radius: 0.5 },
	bloomChain: {
		intensity: 3.07,
		knee: 0.01,
		weights: [0, 0.0916, 0.2194, 0.1308, 0.1398, 0.1492, 0.1058, 0.149, 0.0145],
	},
	ao: { radius: 0.8, intensity: 1, scale: 0.5 },
	/** A night grade: cool teal shadows, warm highlights and a little more contrast. */
	grade: {
		contrast: 1.1,
		saturation: 1.1,
		lift: [0.0, 0.012, 0.055],
		gamma: [1, 1, 1],
		gain: [1.05, 1.0, 0.95],
	} satisfies GradeLook,
	/** A lens grade: fringes at the edges, an anamorphic streak on the brightest light, and grain. */
	lens: { shift: 5, streak: 0.3, grain: 0.035 },
} as const;

// The camera: a minute's loop that starts high over the town, sinks into a street at the height
// of a person, drives down it among the cars, and climbs back out.

export const NIGHT_CAMERA: CameraLoop = {
	seconds: 60,
	positions: [
		80, 46, 92, 18, 40, 112, -62, 30, 82, -50, 12, 38, -21, 2.8, 28, -21, 2.6, 0, -21, 2.8, -28, -6,
		14, -62, 42, 30, -72, 92, 40, 22,
	],
	targets: [
		0, 0, -8, -10, 2, 0, 0, 4, 0, -21, 4, 0, -21, 3, -12, -19, 8, -40, -15, 8, -62, 0, 3, -10, 0, 0,
		0, 0, 0, 0,
	],
};

/** The camera loop's wide shot over the town and its shot down a street, in simulation seconds. */
export const WIDE_SHOT = 3;
export const STREET_SHOT = 33;

// What the comparison page needs to know about the scene.

/**
 * The ramp of each device class, in lights. Each tops out under 1,024 lights, the most that both
 * engines' clustered lighting lists at once. Each row is a first guess until a device sitting
 * measures it.
 */
export const NIGHT_RAMPS = {
	desktop: { start: 60, factor: 1.2, max: 1_020 },
	tablet: { start: 48, factor: 1.2, max: 720 },
	phone: { start: 36, factor: 1.2, max: 480 },
} as const satisfies Record<DeviceClass, RampPlan>;

/**
 * The frame that the image tests hold: the wide shot, with a part of the town. three.js builds its
 * shaders for each count of lights, and its WebGPURenderer takes minutes for the whole town on a
 * busy machine, so the test waits longer and draws fewer blocks. On the software GPU both engines'
 * tests draw fewer blocks still.
 */
export const NIGHT_HOLD = {
	seconds: WIDE_SHOT,
	count: 96,
	timeoutSeconds: 180,
	softwareCount: 24,
} as const;

/** Triangles in the town for a count of lights, before shadows and particles. */
export function nightTriangles(
	town: NightTown,
	lights: number,
	meshes: Record<NightMesh, MeshData>,
): number {
	const blocks = Math.min(town.capacity, nightBlocks(lights));
	let total =
		triangleCount(meshes.ground) +
		FLYER_COUNT *
			(triangleCount(meshes.flyerBody) +
				triangleCount(meshes.flyerHead) +
				triangleCount(meshes.flyerTail));
	for (let b = 0; b < blocks; b++) {
		total +=
			triangleCount(meshes.slab) +
			LAMPS_PER_BLOCK * (triangleCount(meshes.lampPost) + triangleCount(meshes.lampLens));
		for (let l = 0; l < LOTS_PER_BLOCK; l++) {
			const d = town.lotDesign[b * LOTS_PER_BLOCK + l] as number;
			total +=
				triangleCount(meshes[`facade${d}`] as MeshData) +
				triangleCount(meshes[`trim${d}`] as MeshData);
		}
		for (let s = 0; s < SIGNS_PER_BLOCK; s++)
			total +=
				triangleCount(meshes.signBoard) +
				triangleCount(meshes.awning) +
				triangleCount(
					meshes[`signTubes${town.signShape[b * SIGNS_PER_BLOCK + s] as number}`] as MeshData,
				);
		const car = triangleCount(meshes.carBody) + triangleCount(meshes.carCabin);
		total +=
			CARS_PER_BLOCK * (car + triangleCount(meshes.headlamps) + triangleCount(meshes.tailLamps)) +
			PARKED_PER_BLOCK * car;
	}
	return total;
}

// Battle: two armies of animated soldiers, with a mech in every fifty and tanks behind each line,
// meet on a scarred field at dusk. Soldiers and mechs march, find the nearest enemy, turn to it and
// fire tracers. Tanks turn their turrets and fire shells that explode in fire, smoke and sparks. A
// fallen soldier plays its fall, lies still, and joins the back of its army again. The count is the
// soldiers and mechs of both armies together.
//
// This module is the one description that both engines draw: the seeded simulation in fixed steps,
// the terrain, the scenery, the meshes, the surfaces, the lights, the particles and the camera. It
// imports no engine. The soldiers and the mechs are models from files, which both engines load.
//
// The game code is kept cheap, as it runs on one thread in both engines: target search uses a grid
// and runs five times a second for each soldier, spread over the steps.

import {
	boxGeometry,
	type CameraLoop,
	type CompareMode,
	clamp,
	cylinderGeometry,
	type GradeLook,
	type Hex,
	hash01,
	lerp,
	type MeshData,
	type OutArray,
	quatYaw,
	SIM_STEP,
	type SurfaceKind,
	smoothstep,
	TAU,
	triangleCount,
} from '../../lib/compare-scene';
import { addSprite, FIRE_FRAMES, type SpriteRows } from '../../lib/particles';
import type { DeviceClass, RampPlan } from '../../lib/ramp';
import {
	clothGeometry,
	deadTree,
	grassClump,
	hedgehog,
	heightGrid,
	merged,
	placed,
	rockGeometry,
	ruinedWall,
	tankParts,
	taperedCylinder,
	turn,
} from './shapes';

export const BATTLE_SEED = 7;

// The models. Both engines load the same two files from the sample content.

/** The soldier's and the mech's figures, from their files. */
export const MODELS = {
	soldier: {
		/** The skinned mesh's node, which takes the army's material. */
		mesh: 'Soldier',
		/** The height of the file's rest pose, and the scale that makes it 1.8 m. */
		restHeight: 2.2027,
		scale: 1.8 / 2.2027,
		/** Triangles of the body and of the rifle on the right hand. */
		triangles: 5828 + 1122,
	},
	mech: {
		mesh: 'George',
		restHeight: 6.5086,
		scale: 3.6 / 6.5086,
		triangles: 3000,
	},
} as const;
export type ModelName = keyof typeof MODELS;

/** The four clips of both models, by the number that the simulation keeps. */
export const CLIP_NAMES = ['idle', 'run', 'shoot', 'die'] as const;
export const Clip = { idle: 0, run: 1, shoot: 2, die: 3 } as const;
/** Seconds over which a unit fades from one clip to the next. */
export const CLIP_FADE_SECONDS = 0.25;

// Armies and formations. Army 0 starts at -X and faces +X; army 1 starts at +X and faces -X. Unit i
// belongs to army i & 1 and has formation slot i >> 1, so a count covers both armies evenly.

/** The most units, soldiers and mechs of both armies, that a scene can hold. */
export const MAX_UNITS = 40_000;
export const SPAWN_X = 62;
export const FORMATION_COLUMNS = 64;
export const COLUMN_SPACING = 1.7;
export const ROW_SPACING = 2.1;
/** Every fiftieth slot of an army holds a mech. */
export const MECH_EVERY = 50;
/** One tank for every 60 units of an army, at least one, and at most MAX_TANKS. */
export const UNITS_PER_TANK = 60;
export const MAX_TANKS_PER_ARMY = 60;
/** Parts of a tank: the hull, the turret on it, and the barrel on the turret. */
export const TANK_PARTS = 3;

export const UnitKind = { soldier: 0, mech: 1 } as const;
export const UnitState = { march: 0, fight: 1, dead: 2 } as const;

const SOLDIER = { speed: 2.6, range: 42, fireSeconds: 1.6, hitChance: 0.22 } as const;
const MECH = { speed: 1.7, range: 60, fireSeconds: 0.6, hitChance: 0.35 } as const;
const TANK = { speed: 1.4, range: 95, fireSeconds: 4.5, blastRadius: 4.5, blastKills: 6 } as const;
const DEAD_SECONDS = 4;
const TURN_RATE = 3;
/** Units search for targets once every this many steps: five times a second at 120 steps. */
const SEARCH_EVERY = 24;
const TRACER_SPEED = 160;
const SHELL_SPEED = 95;
export const EXPLOSION_SECONDS = 1.1;
/** The muzzle's height above a soldier's feet, and how far ahead of it, at a soldier's size. */
const MUZZLE_HEIGHT = 1.3;
const MUZZLE_AHEAD = 0.75;

/** Units for a count: an even number from 2 to MAX_UNITS, so both armies have the same. */
export function battleUnits(count: number): number {
	const perArmy = Math.max(1, Math.min(MAX_UNITS / 2, Math.ceil(count / 2)));
	return perArmy * 2;
}

export function tanksPerArmy(perArmy: number): number {
	return Math.min(MAX_TANKS_PER_ARMY, Math.max(1, Math.floor(perArmy / UNITS_PER_TANK)));
}

export function unitKindOf(i: number): number {
	return (i >> 1) % MECH_EVERY === MECH_EVERY - 1 ? UnitKind.mech : UnitKind.soldier;
}

/** Mechs among the first `units` units. */
export function mechsAmong(units: number): number {
	return 2 * Math.floor(units / 2 / MECH_EVERY);
}

/** Writes a formation slot's place on the ground (x, z). */
export function formationSlot(army: number, slot: number, out: OutArray): void {
	const row = Math.floor(slot / FORMATION_COLUMNS);
	const column = slot % FORMATION_COLUMNS;
	const side = army === 0 ? -1 : 1;
	// Rows stagger by half a column, so the lines read as a crowd rather than a grid.
	out[0] = side * (SPAWN_X + row * ROW_SPACING);
	out[1] = (column - (FORMATION_COLUMNS - 1) / 2 + (row % 2) * 0.5) * COLUMN_SPACING;
}

// The terrain: a shallow valley between hills, scarred by shell craters in the middle.

/** The detailed middle of the field, and its grid's step in meters. */
export const FIELD = { halfX: 150, halfZ: 100, step: 1.25 } as const;
/** The coarse land around it, past the end of the fog, and its grid's step. */
export const LAND = { halfX: 900, halfZ: 700, step: 12.5 } as const;

interface Crater {
	x: number;
	z: number;
	radius: number;
	depth: number;
}

/** The craters of the field, seeded: most where the lines meet, a few behind each line. */
export const CRATERS: readonly Crater[] = Array.from({ length: 44 }, (_, k) => {
	const spread = k < 30 ? 55 : 120;
	return {
		x: (hash01(BATTLE_SEED, k, 1) * 2 - 1) * spread,
		z: (hash01(BATTLE_SEED, k, 2) * 2 - 1) * 80,
		radius: 2.5 + 5 * hash01(BATTLE_SEED, k, 3) ** 2,
		depth: 0.5 + 0.9 * hash01(BATTLE_SEED, k, 4),
	};
});

/** The land without craters: gentle swells, rising into hills on the flanks and far behind. */
export function landHeight(x: number, z: number): number {
	const swell =
		0.9 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.027 - 0.4) +
		0.5 * Math.sin(x * 0.047 + z * 0.039 + 2.1) +
		0.25 * Math.sin(x * 0.11 - z * 0.09);
	const flank = Math.max(0, Math.abs(z) - 110);
	const behind = Math.max(0, Math.abs(x) - 260);
	const hills = 0.0006 * flank * flank + 0.00025 * behind * behind;
	const ridges = (flank + behind) * 0.03 * (Math.sin(x * 0.013) + Math.sin(z * 0.017 + 1.7) + 2);
	return swell + Math.min(hills + ridges, 90);
}

/** The crater's change of height at (x, z): a bowl with a raised rim. */
function craterHeight(x: number, z: number): number {
	let h = 0;
	for (const c of CRATERS) {
		const dx = x - c.x;
		const dz = z - c.z;
		const reach = c.radius * 1.8;
		if (dx * dx + dz * dz > reach * reach) continue;
		const r = Math.hypot(dx, dz) / c.radius;
		if (r < 1) h -= c.depth * (1 - r * r);
		h += 0.35 * c.depth * Math.exp(-(((r - 1) / 0.35) ** 2));
	}
	return h;
}

/** The terrain's height at (x, z): the land and the craters. */
export function terrainHeight(x: number, z: number): number {
	const inField = Math.abs(x) < FIELD.halfX && Math.abs(z) < FIELD.halfZ;
	return landHeight(x, z) + (inField ? craterHeight(x, z) : 0);
}

/** How scorched the ground is at (x, z), from 0 to 1: darkest in and around each crater. */
function scorch(x: number, z: number): number {
	let s = 0;
	for (const c of CRATERS) {
		const r = Math.hypot(x - c.x, z - c.z) / c.radius;
		if (r < 2.4) s = Math.max(s, 1 - smoothstep((r - 0.6) / 1.8));
	}
	return s;
}

/** Smooth noise over the plane, from 0 to 1. */
function fieldNoise(x: number, z: number, scale: number, seed: number): number {
	const fx = x * scale;
	const fz = z * scale;
	const x0 = Math.floor(fx);
	const z0 = Math.floor(fz);
	const tx = smoothstep(fx - x0);
	const tz = smoothstep(fz - z0);
	const at = (i: number, j: number) => hash01(seed, i, j);
	return lerp(
		lerp(at(x0, z0), at(x0 + 1, z0), tx),
		lerp(at(x0, z0 + 1), at(x0 + 1, z0 + 1), tx),
		tz,
	);
}

/**
 * The ground's color at a point, linear: dry grass and earth by noise, trampled dirt where the
 * armies march, scorched earth around craters, and darker hills.
 */
export function groundColor(x: number, z: number, y: number): [number, number, number] {
	const n = 0.6 * fieldNoise(x, z, 0.05, 3) + 0.4 * fieldNoise(x, z, 0.21, 4);
	const grass: [number, number, number] = [0.17, 0.17, 0.07];
	const dry: [number, number, number] = [0.3, 0.24, 0.12];
	const dirt: [number, number, number] = [0.26, 0.19, 0.12];
	const burnt: [number, number, number] = [0.045, 0.04, 0.035];
	const trampled =
		clamp(1 - (Math.abs(z) - 30) / 50, 0, 1) * clamp(1 - (Math.abs(x) - 120) / 80, 0, 1);
	const s = scorch(x, z);
	const mix = (a: readonly number[], b: readonly number[], t: number) =>
		[0, 1, 2].map((k) => lerp(a[k] as number, b[k] as number, t)) as [number, number, number];
	let c = mix(grass, dry, smoothstep(n));
	c = mix(c, dirt, trampled * (0.55 + 0.4 * n));
	c = mix(c, burnt, s * 0.92);
	// The hills darken a little with height, and the bottom of each bowl holds ash.
	const shade = 1 - clamp(y / 120, 0, 0.35);
	return [c[0] * shade, c[1] * shade, c[2] * shade];
}

/** The detailed field's mesh, and the land's mesh around it. The land sinks under the field. */
export function terrainMeshes(): { field: MeshData; land: MeshData } {
	const { halfX, halfZ, step } = FIELD;
	const field = heightGrid(
		-halfX,
		halfX,
		-halfZ,
		halfZ,
		Math.round((2 * halfX) / step),
		Math.round((2 * halfZ) / step),
		terrainHeight,
		groundColor,
	);
	const inside = (x: number, z: number) => Math.abs(x) < halfX - 1e-3 && Math.abs(z) < halfZ - 1e-3;
	const land = heightGrid(
		-LAND.halfX,
		LAND.halfX,
		-LAND.halfZ,
		LAND.halfZ,
		Math.round((2 * LAND.halfX) / LAND.step),
		Math.round((2 * LAND.halfZ) / LAND.step),
		(x, z) => landHeight(x, z) - (inside(x, z) ? 1.5 : 0),
		(x, z) => groundColor(x, z, landHeight(x, z)),
	);
	return { field, land };
}

// The scenery, seeded: rocks, ruins, dead trees, tank traps, grass, burning wrecks and flags. Each
// list gives positions on the ground, a turn about +Y and a scale.

export interface Placed {
	x: number;
	y: number;
	z: number;
	yaw: number;
	scale: number;
	/** Which variant of the mesh, where the kind has several. */
	variant: number;
}

const placeAt = (x: number, z: number, yaw: number, scale: number, variant = 0): Placed => ({
	x,
	y: terrainHeight(x, z),
	z,
	yaw,
	scale,
	variant,
});

/** Variants of the rock and the dead tree. */
export const ROCK_VARIANTS = 4;
export const TREE_VARIANTS = 3;

/** True where the armies march, which the scenery keeps clear. */
const inLanes = (z: number) => Math.abs(z) < (FORMATION_COLUMNS * COLUMN_SPACING) / 2 + 6;

/** A seeded point on the flanks or far beyond, never in the lanes. */
function flankPoint(k: number, salt: number, reachX: number, nearZ: number, farZ: number) {
	const x = (hash01(BATTLE_SEED, k, salt) * 2 - 1) * reachX;
	const side = hash01(BATTLE_SEED, k, salt + 1) < 0.5 ? -1 : 1;
	const z = side * lerp(nearZ, farZ, hash01(BATTLE_SEED, k, salt + 2));
	return { x, z };
}

export const ROCKS: readonly Placed[] = Array.from({ length: 140 }, (_, k) => {
	const { x, z } = flankPoint(k, 10, 260, 60, 190);
	const big = hash01(BATTLE_SEED, k, 14) > 0.85;
	const scale = big
		? 1.6 + 2.2 * hash01(BATTLE_SEED, k, 15)
		: 0.35 + 0.8 * hash01(BATTLE_SEED, k, 15);
	return placeAt(x, z, hash01(BATTLE_SEED, k, 16) * TAU, scale, k % ROCK_VARIANTS);
});

export const TREES: readonly Placed[] = Array.from({ length: 46 }, (_, k) => {
	const { x, z } = flankPoint(k, 20, 320, 70, 240);
	return placeAt(
		x,
		z,
		hash01(BATTLE_SEED, k, 24) * TAU,
		0.8 + 0.5 * hash01(BATTLE_SEED, k, 25),
		k % TREE_VARIANTS,
	);
});

export const TANK_TRAPS: readonly Placed[] = Array.from({ length: 70 }, (_, k) => {
	// Rows of traps along each flank, a little ragged.
	const side = k % 2 === 0 ? -1 : 1;
	const along = Math.floor(k / 2);
	const x = -95 + along * 5.6 + (hash01(BATTLE_SEED, k, 31) - 0.5) * 2;
	const z = side * (60 + (hash01(BATTLE_SEED, k, 32) - 0.5) * 5);
	return placeAt(x, z, hash01(BATTLE_SEED, k, 33) * TAU, 0.9 + 0.25 * hash01(BATTLE_SEED, k, 34));
});

/** Clumps of grass, in patches over the field, sparse where the armies march. */
export const GRASS: readonly Placed[] = (() => {
	const out: Placed[] = [];
	for (let k = 0; out.length < 5000 && k < 40_000; k++) {
		const x = (hash01(BATTLE_SEED, k, 41) * 2 - 1) * FIELD.halfX;
		const z = (hash01(BATTLE_SEED, k, 42) * 2 - 1) * FIELD.halfZ;
		const patch = fieldNoise(x, z, 0.05, 3);
		const keep = (inLanes(z) ? 0.08 : 0.55) * smoothstep(patch * 1.4 - 0.2) * (1 - scorch(x, z));
		if (hash01(BATTLE_SEED, k, 43) > keep) continue;
		out.push(
			placeAt(
				x,
				z,
				hash01(BATTLE_SEED, k, 44) * TAU,
				0.7 + 0.8 * hash01(BATTLE_SEED, k, 45),
				k % 4,
			),
		);
	}
	return out;
})();

/** Ruined walls: a farm on each flank and a broken church tower, each wall a run along its yaw. */
export const RUINS: readonly (Placed & { length: number; height: number })[] = [
	{ ...placeAt(-26, -76, 0.15, 1), length: 16, height: 5.2 },
	{ ...placeAt(-26, -76, 0.15 + Math.PI / 2, 1), length: 9, height: 4.6 },
	{ ...placeAt(-12.6, -74, 0.15 + Math.PI / 2, 1, 1), length: 7, height: 3.4 },
	{ ...placeAt(34, 72, Math.PI + 0.3, 1), length: 14, height: 4.8 },
	{ ...placeAt(34, 72, Math.PI / 2 + 0.3, 1, 1), length: 8, height: 3.8 },
	{ ...placeAt(-60, 68, -0.4, 1, 1), length: 20, height: 2.2 },
	{ ...placeAt(88, -70, 0.9, 1, 1), length: 18, height: 2.4 },
].map((wall, k) => ({ ...wall, variant: k }));

/** The church tower's base and its broken height. */
export const TOWER = { ...placeAt(14, -96, 0.25, 1), side: 6.5, height: 17 } as const;

/** Burning wrecks of tanks: a tilt about their length, and a smoke column each. */
export const WRECKS: readonly (Placed & { tilt: number })[] = [
	{ ...placeAt(-8, 26, 0.7, 1), tilt: 0.12 },
	{ ...placeAt(22, -34, 2.5, 1), tilt: -0.18 },
	{ ...placeAt(-44, -18, 4.2, 1), tilt: 0.08 },
];

/** Flags on poles: a row behind each army's line. */
export const FLAGS: readonly (Placed & { army: number })[] = [0, 1].flatMap((army) =>
	[-36, -12, 12, 36].map((z, k) => ({
		...placeAt((army === 0 ? -1 : 1) * (SPAWN_X - 6), z, army === 0 ? 0 : Math.PI, 1, k),
		army,
	})),
);
export const FLAG_POLE_HEIGHT = 7;
export const FLAG_SIZE = { width: 2.6, height: 1.6 } as const;

// The simulation.

const CELL = 10;
const GRID_HALF_X = 700;
const GRID_HALF_Z = 160;
const GRID_X = (2 * GRID_HALF_X) / CELL;
const GRID_Z = (2 * GRID_HALF_Z) / CELL;
const GRID_CELLS = GRID_X * GRID_Z;

function cellX(x: number): number {
	return clamp(Math.floor((x + GRID_HALF_X) / CELL), 0, GRID_X - 1);
}

function cellZ(z: number): number {
	return clamp(Math.floor((z + GRID_HALF_Z) / CELL), 0, GRID_Z - 1);
}

export function angleDifference(a: number, b: number): number {
	let d = (a - b) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d < -Math.PI) d += TAU;
	return d;
}

export interface BattleState {
	/** Units with state, both armies. The first `active` of them take part. */
	capacity: number;
	active: number;
	step: number;
	time: number;
	kind: Uint8Array;
	state: Uint8Array;
	stateTime: Float32Array;
	x: Float32Array;
	y: Float32Array;
	z: Float32Array;
	heading: Float32Array;
	target: Int32Array;
	cooldown: Float32Array;
	clip: Uint8Array;
	clipTime: Float32Array;
	previousClip: Uint8Array;
	previousTime: Float32Array;
	/** From 0 (all previous clip) to 1 (all current clip). */
	fade: Float32Array;
	/** Times the unit fell, which names its life: a unit that respawns starts a new one. */
	deaths: Uint32Array;
	// Tanks, both armies: 2 x tankCapacity.
	tankCapacity: number;
	tankX: Float32Array;
	tankY: Float32Array;
	tankZ: Float32Array;
	tankHeading: Float32Array;
	tankTurret: Float32Array;
	tankTarget: Int32Array;
	tankCooldown: Float32Array;
	/** Seconds since the tank last fired: its recoil and muzzle flash. */
	tankFired: Float32Array;
	// Tracers and shells: a ring of flights from a start to an end point.
	flights: number;
	flightActive: Uint8Array;
	/** 0 tracer, 1 shell. */
	flightKind: Uint8Array;
	flightFrom: Float32Array;
	flightTo: Float32Array;
	flightAge: Float32Array;
	flightDuration: Float32Array;
	flightTarget: Int32Array;
	flightChance: Float32Array;
	flightArmy: Uint8Array;
	flightNext: number;
	activeFlights: number;
	flightCount: number;
	// Explosions: a ring too.
	blasts: number;
	blastActive: Uint8Array;
	blastPosition: Float32Array;
	blastAge: Float32Array;
	/** The blast's number since the start, which seeds its particles. */
	blastSerial: Uint32Array;
	blastNext: number;
	blastCount: number;
	activeBlasts: number;
	// Grids, one per army.
	cellStart: Int32Array[];
	cellCursor: Int32Array;
	sorted: Int32Array[];
	shots: number;
}

const slot = new Float64Array(2);

function resetUnit(s: BattleState, i: number): void {
	formationSlot(i & 1, i >> 1, slot);
	const x = slot[0] as number;
	const z = slot[1] as number;
	s.x[i] = x;
	s.z[i] = z;
	s.y[i] = terrainHeight(x, z);
	s.heading[i] = (i & 1) === 0 ? Math.PI / 2 : -Math.PI / 2;
	s.state[i] = UnitState.march;
	s.stateTime[i] = 0;
	s.target[i] = -1;
	s.cooldown[i] = hash01(BATTLE_SEED, i, 1) * SOLDIER.fireSeconds;
	s.clip[i] = Clip.run;
	s.clipTime[i] = hash01(BATTLE_SEED, i, (s.deaths[i] as number) + 2);
	s.previousClip[i] = Clip.run;
	s.previousTime[i] = 0;
	s.fade[i] = 1;
}

function resetTank(s: BattleState, t: number): void {
	const army = t & 1;
	const index = t >> 1;
	const side = army === 0 ? -1 : 1;
	const row = Math.floor(index / 12);
	const column = index % 12;
	const x = side * (SPAWN_X + 14 + row * 15);
	const z = (column - 5.5) * 9.5 + (row % 2) * 4;
	s.tankX[t] = x;
	s.tankZ[t] = z;
	s.tankY[t] = terrainHeight(x, z);
	s.tankHeading[t] = army === 0 ? Math.PI / 2 : -Math.PI / 2;
	s.tankTurret[t] = 0;
	s.tankTarget[t] = -1;
	s.tankCooldown[t] = 1 + hash01(BATTLE_SEED, t, 3) * TANK.fireSeconds;
	s.tankFired[t] = 100;
}

/** Makes the state of `capacity` units, all in formation. Setup code. */
export function createBattle(capacity: number): BattleState {
	const units = battleUnits(capacity);
	const tanks = tanksPerArmy(units / 2) * 2;
	const flights = Math.max(512, Math.min(80_000, units));
	const blasts = Math.max(64, tanks * 2);
	const s: BattleState = {
		capacity: units,
		active: units,
		step: 0,
		time: 0,
		kind: new Uint8Array(units),
		state: new Uint8Array(units),
		stateTime: new Float32Array(units),
		x: new Float32Array(units),
		y: new Float32Array(units),
		z: new Float32Array(units),
		heading: new Float32Array(units),
		target: new Int32Array(units),
		cooldown: new Float32Array(units),
		clip: new Uint8Array(units),
		clipTime: new Float32Array(units),
		previousClip: new Uint8Array(units),
		previousTime: new Float32Array(units),
		fade: new Float32Array(units),
		deaths: new Uint32Array(units),
		tankCapacity: tanks / 2,
		tankX: new Float32Array(tanks),
		tankY: new Float32Array(tanks),
		tankZ: new Float32Array(tanks),
		tankHeading: new Float32Array(tanks),
		tankTurret: new Float32Array(tanks),
		tankTarget: new Int32Array(tanks),
		tankCooldown: new Float32Array(tanks),
		tankFired: new Float32Array(tanks),
		flights,
		flightActive: new Uint8Array(flights),
		flightKind: new Uint8Array(flights),
		flightFrom: new Float32Array(flights * 3),
		flightTo: new Float32Array(flights * 3),
		flightAge: new Float32Array(flights),
		flightDuration: new Float32Array(flights),
		flightTarget: new Int32Array(flights),
		flightChance: new Float32Array(flights),
		flightArmy: new Uint8Array(flights),
		flightNext: 0,
		activeFlights: 0,
		flightCount: 0,
		blasts,
		blastActive: new Uint8Array(blasts),
		blastPosition: new Float32Array(blasts * 3),
		blastAge: new Float32Array(blasts),
		blastSerial: new Uint32Array(blasts),
		blastNext: 0,
		blastCount: 0,
		activeBlasts: 0,
		cellStart: [new Int32Array(GRID_CELLS + 1), new Int32Array(GRID_CELLS + 1)],
		cellCursor: new Int32Array(GRID_CELLS),
		sorted: [new Int32Array(units / 2), new Int32Array(units / 2)],
		shots: 0,
	};
	for (let i = 0; i < units; i++) {
		s.kind[i] = unitKindOf(i);
		resetUnit(s, i);
	}
	for (let t = 0; t < tanks; t++) resetTank(s, t);
	return s;
}

/** Sets the units that take part, both armies. New units join at their formation slot. */
export function setActiveUnits(s: BattleState, count: number): void {
	const next = Math.min(s.capacity, battleUnits(count));
	for (let i = s.active; i < next; i++) resetUnit(s, i);
	const tanksBefore = activeTanks(s);
	const tanksAfter = Math.min(s.tankCapacity, tanksPerArmy(next / 2));
	for (let t = tanksBefore * 2; t < tanksAfter * 2; t++) resetTank(s, t);
	s.active = next;
}

/** Tanks per army that take part. */
export function activeTanks(s: BattleState): number {
	return Math.min(s.tankCapacity, tanksPerArmy(s.active / 2));
}

function setClip(s: BattleState, i: number, clip: number): void {
	if (s.clip[i] === clip) return;
	s.previousClip[i] = s.clip[i] as number;
	s.previousTime[i] = s.clipTime[i] as number;
	s.clip[i] = clip;
	s.clipTime[i] = 0;
	s.fade[i] = 0;
}

function kill(s: BattleState, i: number): void {
	if (s.state[i] === UnitState.dead) return;
	s.state[i] = UnitState.dead;
	s.stateTime[i] = 0;
	s.target[i] = -1;
	s.deaths[i] = (s.deaths[i] as number) + 1;
	setClip(s, i, Clip.die);
}

function buildGrids(s: BattleState): void {
	const units = s.active;
	for (let army = 0; army < 2; army++) {
		const start = s.cellStart[army] as Int32Array;
		start.fill(0);
		for (let i = army; i < units; i += 2) {
			if (s.state[i] === UnitState.dead) continue;
			const c = cellZ(s.z[i] as number) * GRID_X + cellX(s.x[i] as number);
			start[c + 1] = (start[c + 1] as number) + 1;
		}
		for (let c = 0; c < GRID_CELLS; c++)
			start[c + 1] = (start[c + 1] as number) + (start[c] as number);
		const cursor = s.cellCursor;
		cursor.set(start.subarray(0, GRID_CELLS));
		const sorted = s.sorted[army] as Int32Array;
		for (let i = army; i < units; i += 2) {
			if (s.state[i] === UnitState.dead) continue;
			const c = cellZ(s.z[i] as number) * GRID_X + cellX(s.x[i] as number);
			const at = cursor[c] as number;
			sorted[at] = i;
			cursor[c] = at + 1;
		}
	}
}

/** The nearest living enemy of `army` within `range` of (x, z), or -1. Rings of cells outward. */
function nearestEnemy(s: BattleState, army: number, x: number, z: number, range: number): number {
	const enemies = 1 - army;
	const start = s.cellStart[enemies] as Int32Array;
	const sorted = s.sorted[enemies] as Int32Array;
	const cx = cellX(x);
	const cz = cellZ(z);
	const rings = Math.ceil(range / CELL);
	let best = -1;
	let bestDistance = range * range;
	for (let r = 0; r <= rings; r++) {
		for (let gz = cz - r; gz <= cz + r; gz++) {
			if (gz < 0 || gz >= GRID_Z) continue;
			const edgeRow = gz === cz - r || gz === cz + r;
			for (let gx = cx - r; gx <= cx + r; gx += edgeRow || r === 0 ? 1 : 2 * r) {
				if (gx < 0 || gx >= GRID_X) continue;
				const c = gz * GRID_X + gx;
				for (let k = start[c] as number; k < (start[c + 1] as number); k++) {
					const j = sorted[k] as number;
					const dx = (s.x[j] as number) - x;
					const dz = (s.z[j] as number) - z;
					const d = dx * dx + dz * dz;
					if (d < bestDistance) {
						bestDistance = d;
						best = j;
					}
				}
			}
		}
		// Cells beyond the next ring are at least r cells away; stop once a hit is that close.
		if (best >= 0 && bestDistance <= r * r * CELL * CELL) break;
	}
	return best;
}

function launch(
	s: BattleState,
	kind: number,
	army: number,
	fromX: number,
	fromY: number,
	fromZ: number,
	target: number,
	chance: number,
	speed: number,
): void {
	const f = s.flightNext;
	s.flightNext = (f + 1) % s.flights;
	if (s.flightActive[f] === 0) s.activeFlights++;
	s.flightActive[f] = 1;
	s.flightKind[f] = kind;
	s.flightArmy[f] = army;
	s.flightFrom[f * 3] = fromX;
	s.flightFrom[f * 3 + 1] = fromY;
	s.flightFrom[f * 3 + 2] = fromZ;
	const toX = s.x[target] as number;
	const toZ = s.z[target] as number;
	s.flightTo[f * 3] = toX;
	s.flightTo[f * 3 + 1] = (s.y[target] as number) + (kind === 0 ? 1.1 : 0.2);
	s.flightTo[f * 3 + 2] = toZ;
	const distance = Math.hypot(toX - fromX, toZ - fromZ);
	s.flightAge[f] = 0;
	s.flightDuration[f] = Math.max(0.05, distance / speed);
	s.flightTarget[f] = target;
	s.flightChance[f] = chance;
	s.flightCount++;
}

function explode(s: BattleState, x: number, z: number, army: number): void {
	const b = s.blastNext;
	s.blastNext = (b + 1) % s.blasts;
	if (s.blastActive[b] === 0) s.activeBlasts++;
	s.blastActive[b] = 1;
	s.blastPosition[b * 3] = x;
	s.blastPosition[b * 3 + 1] = terrainHeight(x, z);
	s.blastPosition[b * 3 + 2] = z;
	s.blastAge[b] = 0;
	s.blastSerial[b] = s.blastCount++;
	// The blast hits the enemies of the army that fired it, near the point.
	const enemies = 1 - army;
	const start = s.cellStart[enemies] as Int32Array;
	const sorted = s.sorted[enemies] as Int32Array;
	const cx = cellX(x);
	const cz = cellZ(z);
	let kills = 0;
	const r2 = TANK.blastRadius * TANK.blastRadius;
	for (let gz = cz - 1; gz <= cz + 1 && kills < TANK.blastKills; gz++) {
		if (gz < 0 || gz >= GRID_Z) continue;
		for (let gx = cx - 1; gx <= cx + 1 && kills < TANK.blastKills; gx++) {
			if (gx < 0 || gx >= GRID_X) continue;
			const c = gz * GRID_X + gx;
			for (
				let k = start[c] as number;
				k < (start[c + 1] as number) && kills < TANK.blastKills;
				k++
			) {
				const j = sorted[k] as number;
				const dx = (s.x[j] as number) - x;
				const dz = (s.z[j] as number) - z;
				if (dx * dx + dz * dz <= r2 && s.state[j] !== UnitState.dead) {
					kill(s, j);
					kills++;
				}
			}
		}
	}
}

/** True while a tank with no target drives on: it stops a little behind its army's first line. */
function tankAdvances(army: number, x: number): boolean {
	const stop = SPAWN_X - 22;
	return army === 0 ? x < -stop : x > stop;
}

function turnToward(current: number, wanted: number, dt: number): number {
	const d = angleDifference(wanted, current);
	const most = TURN_RATE * dt;
	return current + (d > most ? most : d < -most ? -most : d);
}

/** Runs one simulation step of SIM_STEP seconds. Allocates nothing. */
export function stepBattle(s: BattleState): void {
	const dt = SIM_STEP;
	s.step++;
	s.time += dt;
	buildGrids(s);
	const units = s.active;
	const phase = s.step % SEARCH_EVERY;
	for (let i = 0; i < units; i++) {
		const army = i & 1;
		const mech = s.kind[i] === UnitKind.mech;
		const stats = mech ? MECH : SOLDIER;
		s.clipTime[i] = (s.clipTime[i] as number) + dt;
		s.previousTime[i] = (s.previousTime[i] as number) + dt;
		const fade = (s.fade[i] as number) + dt / CLIP_FADE_SECONDS;
		s.fade[i] = fade > 1 ? 1 : fade;
		if (s.state[i] === UnitState.dead) {
			const t = (s.stateTime[i] as number) + dt;
			s.stateTime[i] = t;
			if (t >= DEAD_SECONDS) resetUnit(s, i);
			continue;
		}
		// Search for a target five times a second, each unit on its own step.
		let target = s.target[i] as number;
		if (target >= 0 && (target >= units || s.state[target] === UnitState.dead)) target = -1;
		const x = s.x[i] as number;
		const z = s.z[i] as number;
		if (i % SEARCH_EVERY === phase) target = nearestEnemy(s, army, x, z, stats.range);
		s.target[i] = target;
		const forward = army === 0 ? Math.PI / 2 : -Math.PI / 2;
		if (target >= 0) {
			const dx = (s.x[target] as number) - x;
			const dz = (s.z[target] as number) - z;
			if (dx * dx + dz * dz <= stats.range * stats.range) {
				s.state[i] = UnitState.fight;
				const heading = turnToward(s.heading[i] as number, Math.atan2(dx, dz), dt);
				s.heading[i] = heading;
				setClip(s, i, Clip.shoot);
				const cooldown = (s.cooldown[i] as number) - dt;
				if (cooldown <= 0) {
					s.cooldown[i] = stats.fireSeconds * (0.8 + 0.4 * hash01(BATTLE_SEED, i, s.step));
					const size = mech ? 2 : 1;
					launch(
						s,
						0,
						army,
						x + Math.sin(heading) * MUZZLE_AHEAD * size,
						(s.y[i] as number) + MUZZLE_HEIGHT * size,
						z + Math.cos(heading) * MUZZLE_AHEAD * size,
						target,
						stats.hitChance,
						TRACER_SPEED,
					);
					s.shots++;
				} else {
					s.cooldown[i] = cooldown;
				}
				continue;
			}
		}
		// March toward the enemy's side, and turn toward a seen target.
		s.state[i] = UnitState.march;
		const wanted =
			target >= 0 ? Math.atan2((s.x[target] as number) - x, (s.z[target] as number) - z) : forward;
		const heading = turnToward(s.heading[i] as number, wanted, dt);
		s.heading[i] = heading;
		const limit = SPAWN_X + 20;
		if (army === 0 ? x < limit : x > -limit) {
			const nx = x + Math.sin(heading) * stats.speed * dt;
			const nz = clamp(z + Math.cos(heading) * stats.speed * dt, -GRID_HALF_Z + 1, GRID_HALF_Z - 1);
			s.x[i] = nx;
			s.z[i] = nz;
			s.y[i] = terrainHeight(nx, nz);
			setClip(s, i, Clip.run);
		} else {
			setClip(s, i, Clip.idle);
		}
	}
	// Tanks.
	const tanks = activeTanks(s) * 2;
	for (let t = 0; t < tanks; t++) {
		const army = t & 1;
		const x = s.tankX[t] as number;
		const z = s.tankZ[t] as number;
		s.tankFired[t] = (s.tankFired[t] as number) + dt;
		let target = s.tankTarget[t] as number;
		if (target >= 0 && (target >= units || s.state[target] === UnitState.dead)) target = -1;
		if (t % SEARCH_EVERY === s.step % SEARCH_EVERY)
			target = nearestEnemy(s, army, x, z, TANK.range);
		s.tankTarget[t] = target;
		const heading = s.tankHeading[t] as number;
		if (target >= 0) {
			const bearing = Math.atan2((s.x[target] as number) - x, (s.z[target] as number) - z);
			s.tankTurret[t] =
				turnToward((s.tankTurret[t] as number) + heading, bearing, dt * 0.5) - heading;
			const cooldown = (s.tankCooldown[t] as number) - dt;
			if (cooldown <= 0) {
				s.tankCooldown[t] =
					TANK.fireSeconds * (0.8 + 0.4 * hash01(BATTLE_SEED, t + 100_000, s.step));
				const aim = heading + (s.tankTurret[t] as number);
				launch(
					s,
					1,
					army,
					x + Math.sin(aim) * 5.4,
					(s.tankY[t] as number) + 2.15,
					z + Math.cos(aim) * 5.4,
					target,
					1,
					SHELL_SPEED,
				);
				s.tankFired[t] = 0;
			} else {
				s.tankCooldown[t] = cooldown;
			}
		} else {
			s.tankTurret[t] = turnToward(s.tankTurret[t] as number, 0, dt * 0.5);
			if (tankAdvances(army, x)) {
				const nx = x + Math.sin(heading) * TANK.speed * dt;
				s.tankX[t] = nx;
				s.tankY[t] = terrainHeight(nx, z);
			}
		}
	}
	// Flights: tracers may hit their target; shells explode where they land.
	for (let f = 0; f < s.flights; f++) {
		if (s.flightActive[f] === 0) continue;
		const age = (s.flightAge[f] as number) + dt;
		s.flightAge[f] = age;
		if (age < (s.flightDuration[f] as number)) continue;
		s.flightActive[f] = 0;
		s.activeFlights--;
		const target = s.flightTarget[f] as number;
		if (s.flightKind[f] === 0) {
			if (
				target < units &&
				hash01(BATTLE_SEED, f, s.flightCount + s.step) < (s.flightChance[f] as number)
			)
				kill(s, target);
		} else {
			explode(
				s,
				s.flightTo[f * 3] as number,
				s.flightTo[f * 3 + 2] as number,
				s.flightArmy[f] as number,
			);
		}
	}
	for (let b = 0; b < s.blasts; b++) {
		if (s.blastActive[b] === 0) continue;
		const age = (s.blastAge[b] as number) + dt;
		s.blastAge[b] = age;
		// A blast's smoke outlives its fire, so the slot stays busy while the smoke lingers.
		if (age >= SMOKE_SECONDS) {
			s.blastActive[b] = 0;
			s.activeBlasts--;
		}
	}
}

// Transforms for the engines.

/** Writes a flight's position now and a rotation that points its +Z along its path. */
export function flightTransform(
	s: BattleState,
	f: number,
	outPosition: OutArray,
	outRotation: OutArray,
): void {
	const t = clamp((s.flightAge[f] as number) / (s.flightDuration[f] as number), 0, 1);
	const fx = s.flightFrom[f * 3] as number;
	const fy = s.flightFrom[f * 3 + 1] as number;
	const fz = s.flightFrom[f * 3 + 2] as number;
	const dx = (s.flightTo[f * 3] as number) - fx;
	const dy = (s.flightTo[f * 3 + 1] as number) - fy;
	const dz = (s.flightTo[f * 3 + 2] as number) - fz;
	// Shells fly in an arc and tip along it; tracers fly straight.
	const shell = s.flightKind[f] === 1;
	const reach = Math.hypot(dx, dz);
	const arc = shell ? 4 * t * (1 - t) * 0.12 * reach : 0;
	outPosition[0] = fx + dx * t;
	outPosition[1] = fy + dy * t + arc;
	outPosition[2] = fz + dz * t;
	const climb = (dy + (shell ? 0.48 * reach * (1 - 2 * t) : 0)) / Math.max(reach, 1e-3);
	const yaw = Math.atan2(dx, dz);
	const pitch = -Math.atan(climb);
	// Yaw about +Y after a pitch about +X.
	const cy = Math.cos(yaw / 2);
	const sy = Math.sin(yaw / 2);
	const cp = Math.cos(pitch / 2);
	const sp = Math.sin(pitch / 2);
	outRotation[0] = cy * sp;
	outRotation[1] = sy * cp;
	outRotation[2] = -sy * sp;
	outRotation[3] = cy * cp;
}

/** Writes a unit's rotation about +Y: its heading. */
export function unitRotation(s: BattleState, i: number, out: OutArray): void {
	quatYaw(out, 0, s.heading[i] as number);
}

/** A tank's turret, relative to the hull, and the barrel's recoil along its length. */
export const TANK_TURRET_HEIGHT = 1.62;
export const TANK_BARREL_PIVOT = [0, 0.45, 1.55] as const;
export function barrelRecoil(s: BattleState, t: number): number {
	const fired = s.tankFired[t] as number;
	return fired < 0.5 ? -0.45 * (1 - fired / 0.5) ** 2 : 0;
}

/** Objects in the null3D scene at a count: one per unit and its rifle, three per tank, and the rest. */
export function battleObjects(count: number, mode: CompareMode = 'scene-graph'): number {
	const units = battleUnits(count);
	const tanks = tanksPerArmy(units / 2) * 2;
	const perUnit = units * 3;
	const fixed = STILL_OBJECTS + FLAGS.length * 2;
	return perUnit + (mode === 'instanced' ? 0 : tanks * TANK_PARTS) + fixed;
}

/** Objects that stand still whatever the count: the terrain, the ruins, the tower and the wrecks. */
const STILL_OBJECTS = 2 + 7 + 1 + 3 * 2;

// Meshes.

export type BattleMesh =
	| 'field'
	| 'land'
	| 'rock'
	| 'tree'
	| 'trap'
	| 'grass'
	| 'wall'
	| 'tower'
	| 'pole'
	| 'flag'
	| 'hull'
	| 'turret'
	| 'barrel'
	| 'wreck'
	| 'tracer'
	| 'shell';

/** One mesh per kind of thing, with variants where the kind has several. Setup code. */
export function battleMeshes(): {
	single: Record<Exclude<BattleMesh, 'rock' | 'tree' | 'wall' | 'grass'>, MeshData>;
	rocks: MeshData[];
	trees: MeshData[];
	walls: MeshData[];
	grass: MeshData[];
} {
	const { field, land } = terrainMeshes();
	const { hull, turret, barrel } = tankParts();
	const tower = towerMesh();
	return {
		single: {
			field,
			land,
			trap: hedgehog(),
			tower,
			pole: placed(taperedCylinder(0.07, 0.05, FLAG_POLE_HEIGHT, 8), {
				position: [0, FLAG_POLE_HEIGHT / 2, 0],
			}),
			flag: clothGeometry(FLAG_SIZE.width, FLAG_SIZE.height, 16, 8),
			hull,
			turret,
			barrel,
			wreck: merged([
				hull,
				[turret, { position: [0.3, TANK_TURRET_HEIGHT - 0.1, -0.4], rotation: turn(0, 1, 0, 0.6) }],
				[
					barrel,
					{ position: [1.2, TANK_TURRET_HEIGHT + 0.25, 0.8], rotation: turn(0, 1, 0, 0.6 + 0.4) },
				],
			]),
			// A tracer is a thin streak of light along +Z; a shell a short dark slug.
			tracer: boxGeometry(0.07, 0.07, 2.4),
			shell: placed(cylinderGeometry(0.1, 0.5, 8), { rotation: turn(1, 0, 0, Math.PI / 2) }),
		},
		rocks: Array.from({ length: ROCK_VARIANTS }, (_, k) => rockGeometry(BATTLE_SEED * 13 + k)),
		trees: Array.from({ length: TREE_VARIANTS }, (_, k) => deadTree(BATTLE_SEED * 17 + k)),
		walls: RUINS.map((wall, k) =>
			ruinedWall(wall.length, wall.height, BATTLE_SEED + k, wall.height > 3),
		),
		grass: Array.from({ length: 4 }, (_, k) => grassClump(BATTLE_SEED * 19 + k)),
	};
}

/** The church tower: four broken walls around a hollow, with a stair of fallen blocks. */
function towerMesh(): MeshData {
	const { side, height } = TOWER;
	const half = side / 2;
	const wall = (k: number) =>
		ruinedWall(side, height * (k % 2 === 0 ? 1 : 0.7), BATTLE_SEED + 50 + k, true);
	return merged([
		[wall(0), { position: [-half, 0, -half] }],
		[wall(1), { position: [half, 0, -half], rotation: turn(0, 1, 0, -Math.PI / 2) }],
		[wall(2), { position: [half, 0, half], rotation: turn(0, 1, 0, Math.PI) }],
		[wall(3), { position: [-half, 0, half], rotation: turn(0, 1, 0, Math.PI / 2) }],
	]);
}

/** Triangles in the scene at a count, before shadows, particles, tracers and shells. */
export function battleTriangles(count: number, meshes: ReturnType<typeof battleMeshes>): number {
	const units = battleUnits(count);
	const mechs = mechsAmong(units);
	const tanks = tanksPerArmy(units / 2) * 2;
	const { single } = meshes;
	const tank =
		triangleCount(single.hull) + triangleCount(single.turret) + triangleCount(single.barrel);
	const placedTriangles = (list: readonly Placed[], variants: MeshData[]) =>
		list.reduce(
			(sum, p) => sum + triangleCount(variants[p.variant % variants.length] as MeshData),
			0,
		);
	return (
		(units - mechs) * MODELS.soldier.triangles +
		mechs * MODELS.mech.triangles +
		tanks * tank +
		triangleCount(single.field) +
		triangleCount(single.land) +
		placedTriangles(ROCKS, meshes.rocks) +
		placedTriangles(TREES, meshes.trees) +
		placedTriangles(GRASS, meshes.grass) +
		meshes.walls.reduce((sum, m) => sum + triangleCount(m), 0) +
		TANK_TRAPS.length * triangleCount(single.trap) +
		triangleCount(single.tower) +
		WRECKS.length * triangleCount(single.wreck) +
		FLAGS.length * (triangleCount(single.pole) + triangleCount(single.flag))
	);
}

// Surfaces.

/** A material: a surface tinted by `color`, or a plain one, or a glow. */
export interface BattleMaterial {
	color: Hex;
	surface?: SurfaceKind;
	/** Meters of the surface per meter of the mesh. */
	repeat?: number;
	roughness?: number;
	metalness?: number;
	/** The mesh's vertex colors multiply the color. */
	vertexColors?: boolean;
	emissive?: Hex;
	emissiveIntensity?: number;
	/** Both faces draw, as thin blades and cloth need. */
	doubleSided?: boolean;
	/** True for things that cast no shadow, such as tracers. */
	noShadow?: boolean;
}

/** Each army's colors: its tanks' paint, its flag, and the tint of its soldiers' uniforms. */
export const ARMIES = [
	{ tank: '#6f7a4f' as Hex, flag: '#7d1f1a' as Hex, tint: '#d2dcc0' as Hex },
	{ tank: '#8f8065' as Hex, flag: '#1f3c6e' as Hex, tint: '#f0d2b4' as Hex },
] as const;

export const BATTLE_MATERIALS = {
	/** The field and the land: the ground surface, tinted by the terrain's vertex colors. */
	ground: { color: '#ffffff', surface: 'ground', repeat: 0.35, vertexColors: true },
	rock: { color: '#8a8378', surface: 'rock', repeat: 0.5 },
	tree: { color: '#3a3029', roughness: 0.9, metalness: 0 },
	trap: { color: '#6b4a36', surface: 'paint', repeat: 2 },
	wall: { color: '#b8ab95', surface: 'masonry' },
	pole: { color: '#4a3b2c', roughness: 0.8, metalness: 0 },
	tracer: {
		color: '#000000',
		roughness: 1,
		metalness: 0,
		emissive: '#ffcf7a',
		emissiveIntensity: 40,
		noShadow: true,
	},
	shell: { color: '#2b2b2b', roughness: 0.4, metalness: 0.8, noShadow: true },
	grass: { color: '#9a9a5e', roughness: 0.85, metalness: 0, doubleSided: true },
	flag: { color: '#ffffff', roughness: 0.9, metalness: 0, doubleSided: true },
} as const satisfies Record<string, BattleMaterial>;

/** A wreck's charred steel: dark, rough, with embers that glow in its cracks (the ember shader). */
export const WRECK_LOOK = {
	color: '#2a2622' as Hex,
	roughness: 0.85,
	metalness: 0.4,
	/** The embers' color and their brightest glow. */
	ember: '#ff5a14' as Hex,
	emberIntensity: 6,
} as const;

/** Grass and flags sway with the wind (the sway shader): how far, and how fast. */
export const WIND = {
	grass: { amount: 0.12, speed: 1.7 },
	flag: { amount: 0.28, speed: 4.2 },
} as const;

/** Texels on each side of each surface's maps. */
export const SURFACE_SIZE = 256;

// The look: a dusk sky, the low sun with cascaded shadows, the sky's light, height fog with a
// glow toward the sun, bloom on the fire and tracers, ambient occlusion, AgX and a grade.

/** A point toward the low sun: behind army 0's left flank, about 7 degrees up. */
export const SUN_POSITION = [-0.62, 0.125, -0.775] as const;

export const BATTLE_LOOK = {
	camera: { fov: 46, near: 0.3, far: 2400 },
	toneMapping: 'agx' as const,
	exposure: 1.15,
	sky: {
		sunPosition: SUN_POSITION,
		turbidity: 9,
		rayleigh: 2.6,
		mieCoefficient: 0.006,
		mieDirectionalG: 0.82,
		cloudCoverage: 0.42,
		cloudDensity: 0.5,
		cloudElevation: 0.55,
	},
	/** The sky as the background, and its environment light. */
	skyIntensity: 0.85,
	environmentIntensity: 0.55,
	sun: {
		/** The direction that the light travels: away from the sun. */
		direction: [-SUN_POSITION[0], -SUN_POSITION[1], -SUN_POSITION[2]] as const,
		color: '#ffb877' as Hex,
		intensity: 3.4,
		cascades: 3,
		/** Meters from the camera that the cascades cover. */
		distance: 320,
		mapSize: 2048,
		bias: 0.03,
		normalBias: 0.05,
	},
	/** A fill from the sky's blue side, so the shadowed sides keep some color. */
	hemisphere: { sky: '#6a7da8' as Hex, ground: '#4a3a28' as Hex, intensity: 0.35 },
	fog: {
		color: '#9a8a86' as Hex,
		density: 0.0045,
		height: 0,
		heightFalloff: 0.045,
		sunGlow: 1.1,
		sunGlowExponent: 6,
	},
	/** Bloom, as UnrealBloomPass's settings; null3D's chain takes the mapped settings below. */
	bloom: { threshold: 1, strength: 0.45, radius: 0.35 },
	bloomChain: {
		intensity: 3.6,
		knee: 0.01,
		weights: [0, 0.0916, 0.2194, 0.1308, 0.1398, 0.1492, 0.1058, 0.149, 0.0145],
	},
	ao: { radius: 0.9, intensity: 1, scale: 0.5 },
	/** Warm highlights and teal shadows, with more contrast: the dusk of a war film. */
	grade: {
		contrast: 1.12,
		saturation: 0.88,
		lift: [0.0, 0.012, 0.03],
		gamma: [0.98, 1.0, 1.03],
		gain: [1.06, 0.99, 0.9],
	} satisfies GradeLook,
} as const;

/** The explosion and wreck fire lights: a pool of point lights, given to the newest blasts. */
export const BLAST_LIGHTS = 6;
export const FIRE_LIGHT = { color: '#ff8a3c' as Hex, intensity: 900, range: 26, decay: 2 } as const;
export const WRECK_LIGHT = {
	color: '#ff7a2c' as Hex,
	intensity: 160,
	range: 14,
	decay: 2,
} as const;
export const LIGHT_COUNT = BLAST_LIGHTS + WRECKS.length;

/**
 * Writes the lights' positions and intensities at `seconds`: the newest blasts' flashes first, then
 * the wrecks' flicker. Four floats per light: x, y, z and intensity. Allocates nothing.
 */
export function writeLights(s: BattleState, seconds: number, out: Float32Array): void {
	out.fill(0);
	// The youngest blasts, newest first: walk back from the ring's next slot.
	let light = 0;
	for (let k = 1; k <= s.blasts && light < BLAST_LIGHTS; k++) {
		const b = (s.blastNext - k + s.blasts) % s.blasts;
		if (s.blastActive[b] === 0) continue;
		const age = s.blastAge[b] as number;
		if (age > FLASH_SECONDS) continue;
		const fade = (1 - age / FLASH_SECONDS) ** 2;
		out[light * 4] = s.blastPosition[b * 3] as number;
		out[light * 4 + 1] = (s.blastPosition[b * 3 + 1] as number) + 2.5;
		out[light * 4 + 2] = s.blastPosition[b * 3 + 2] as number;
		out[light * 4 + 3] = FIRE_LIGHT.intensity * fade;
		light++;
	}
	for (let w = 0; w < WRECKS.length; w++) {
		const wreck = WRECKS[w] as (typeof WRECKS)[number];
		const at = (BLAST_LIGHTS + w) * 4;
		const flicker = 0.75 + 0.15 * Math.sin(seconds * 13 + w * 2) + 0.1 * Math.sin(seconds * 31 + w);
		out[at] = wreck.x;
		out[at + 1] = wreck.y + 2.4;
		out[at + 2] = wreck.z;
		out[at + 3] = WRECK_LIGHT.intensity * flicker;
	}
}

// Particles: fire, sparks and flashes in an additive layer; smoke and dust in a blended layer.

/** Seconds of a blast's flash of light, and of its smoke. */
const FLASH_SECONDS = 0.45;
export const SMOKE_SECONDS = 5;
const FIREBALLS_PER_BLAST = 5;
const SPARKS_PER_BLAST = 14;
const SMOKE_PER_BLAST = 7;
const SMOKE_PER_WRECK = 26;
const EMBERS_PER_WRECK = 10;
const DUST_PER_TANK = 6;
const MUZZLE_FLASH_SECONDS = 0.06;

/** The particle layers' capacities for a state's pools. */
export function particleCapacity(s: BattleState): { fire: number; smoke: number } {
	const tanks = s.tankCapacity * 2;
	return {
		fire:
			s.blasts * (FIREBALLS_PER_BLAST + SPARKS_PER_BLAST) +
			WRECKS.length * (EMBERS_PER_WRECK + 2) +
			tanks +
			Math.min(s.flights, 4096),
		smoke: s.blasts * SMOKE_PER_BLAST + WRECKS.length * SMOKE_PER_WRECK + tanks * DUST_PER_TANK,
	};
}

/** Writes every live particle at `seconds` into the fire and smoke rows. Allocates nothing. */
export function writeParticles(
	s: BattleState,
	seconds: number,
	fire: SpriteRows,
	smoke: SpriteRows,
): void {
	fire.count = 0;
	smoke.count = 0;
	// Muzzle flashes: a bright star at the muzzle while a flight is young.
	for (let f = 0; f < s.flights; f++) {
		if (s.flightActive[f] === 0) continue;
		const age = s.flightAge[f] as number;
		if (age > MUZZLE_FLASH_SECONDS) continue;
		const shell = s.flightKind[f] === 1;
		const fade = 1 - age / MUZZLE_FLASH_SECONDS;
		const size = (shell ? 2.6 : 0.55) * (0.6 + 0.4 * fade);
		const glow = (shell ? 14 : 9) * fade;
		addSprite(
			fire,
			s.flightFrom[f * 3] as number,
			s.flightFrom[f * 3 + 1] as number,
			s.flightFrom[f * 3 + 2] as number,
			size,
			hash01(BATTLE_SEED, f, 5) * TAU,
			glow,
			glow * 0.75,
			glow * 0.45,
			1,
			FIRE_FRAMES.flash + (f % FIRE_FRAMES.flashFrames),
		);
	}
	for (let b = 0; b < s.blasts; b++) {
		if (s.blastActive[b] === 0) continue;
		writeBlast(s, b, fire, smoke);
	}
	for (let w = 0; w < WRECKS.length; w++) writeWreck(w, seconds, fire, smoke);
	// Dust behind each moving tank.
	const tanks = activeTanks(s) * 2;
	for (let t = 0; t < tanks; t++) {
		const army = t & 1;
		const x = s.tankX[t] as number;
		if (!tankAdvances(army, x) || (s.tankTarget[t] as number) >= 0) continue;
		const heading = s.tankHeading[t] as number;
		for (let k = 0; k < DUST_PER_TANK; k++) {
			const life = 2.4;
			const cycle = seconds / life + (k / DUST_PER_TANK + hash01(BATTLE_SEED, t, k) * 0.3);
			const age = (cycle - Math.floor(cycle)) * life;
			const back = 3.2 + age * 1.6;
			const side = (k % 2 === 0 ? -1 : 1) * (1.5 + age * 0.5);
			const px = x - Math.sin(heading) * back + Math.cos(heading) * side;
			const pz = (s.tankZ[t] as number) - Math.cos(heading) * back - Math.sin(heading) * side;
			const alpha = 0.35 * (1 - age / life) * smoothstep(age * 4);
			addSprite(
				smoke,
				px,
				(s.tankY[t] as number) + 0.6 + age * 0.7,
				pz,
				1.8 + age * 2.2,
				hash01(BATTLE_SEED, t, k + 7) * TAU + age * 0.3,
				0.55,
				0.44,
				0.32,
				alpha,
				(t + k) % 4,
			);
		}
	}
}

function writeBlast(s: BattleState, b: number, fire: SpriteRows, smoke: SpriteRows): void {
	const age = s.blastAge[b] as number;
	const serial = s.blastSerial[b] as number;
	const x = s.blastPosition[b * 3] as number;
	const y = s.blastPosition[b * 3 + 1] as number;
	const z = s.blastPosition[b * 3 + 2] as number;
	// Fireballs: a few balls that swell and climb as their frames run.
	if (age < EXPLOSION_SECONDS) {
		const life = age / EXPLOSION_SECONDS;
		for (let k = 0; k < FIREBALLS_PER_BLAST; k++) {
			const start = k * 0.06;
			const t = clamp((age - start) / (EXPLOSION_SECONDS - start), 0, 1);
			if (age < start) continue;
			const angle = hash01(serial, k, 1) * TAU;
			const out = k === 0 ? 0 : 0.8 + 1.2 * hash01(serial, k, 2);
			const frame = Math.min(FIRE_FRAMES.ballFrames - 1, Math.floor(t * FIRE_FRAMES.ballFrames));
			const size = (k === 0 ? 5.5 : 3.5) * (0.45 + 0.75 * Math.sqrt(t));
			const glow = 3.2 * (1 - life * 0.6);
			addSprite(
				fire,
				x + Math.cos(angle) * out * (0.5 + t),
				y + 1 + t * 2.4 + k * 0.4,
				z + Math.sin(angle) * out * (0.5 + t),
				size,
				hash01(serial, k, 3) * TAU + t * 0.6,
				glow,
				glow,
				glow,
				1,
				frame,
			);
		}
		// Sparks: thrown out and falling, bright while they fly.
		for (let k = 0; k < SPARKS_PER_BLAST; k++) {
			const angle = hash01(serial, k, 11) * TAU;
			const speed = 6 + 10 * hash01(serial, k, 12);
			const up = 5 + 9 * hash01(serial, k, 13);
			const t = age * (0.8 + 0.4 * hash01(serial, k, 14));
			const height = y + 0.5 + up * t - 4.9 * t * t;
			if (height < y) continue;
			const glow = 18 * (1 - life);
			addSprite(
				fire,
				x + Math.cos(angle) * speed * t,
				height,
				z + Math.sin(angle) * speed * t,
				0.22,
				0,
				glow,
				glow * 0.6,
				glow * 0.25,
				1,
				FIRE_FRAMES.spark,
			);
		}
	}
	// Smoke: dark puffs that rise, spread and thin over the blast's life.
	for (let k = 0; k < SMOKE_PER_BLAST; k++) {
		const start = 0.15 + k * 0.08;
		if (age < start) continue;
		const t = (age - start) / (SMOKE_SECONDS - start);
		const angle = hash01(serial, k, 21) * TAU;
		const out = 1.2 * hash01(serial, k, 22) + t * 3;
		const alpha = 0.75 * smoothstep(clamp((age - start) * 3, 0, 1)) * (1 - t) ** 1.3;
		const shade = 0.08 + 0.12 * t;
		addSprite(
			smoke,
			x + Math.cos(angle) * out + t * 4,
			y + 1.5 + t * 9 + k * 0.5,
			z + Math.sin(angle) * out,
			3.2 + t * 9,
			hash01(serial, k, 23) * TAU + t * (hash01(serial, k, 24) - 0.5) * 2,
			shade,
			shade * 0.95,
			shade * 0.9,
			alpha,
			k % 4,
		);
	}
}

function writeWreck(w: number, seconds: number, fire: SpriteRows, smoke: SpriteRows): void {
	const wreck = WRECKS[w] as (typeof WRECKS)[number];
	const life = 7;
	// A column of smoke that leans with the wind, made of puffs on a loop of their own.
	for (let k = 0; k < SMOKE_PER_WRECK; k++) {
		const cycle = seconds / life + k / SMOKE_PER_WRECK + w * 0.37;
		const born = Math.floor(cycle);
		const t = cycle - born;
		const wobble = hash01(w * 1000 + k, born, 1) - 0.5;
		const alpha = 0.7 * smoothstep(t * 6) * (1 - t) ** 1.1;
		const shade = 0.05 + 0.1 * t;
		addSprite(
			smoke,
			wreck.x + t * 14 + wobble * 2,
			wreck.y + 1.6 + t * 22,
			wreck.z + t * 5 + wobble * 1.5,
			1.6 + t * 9,
			hash01(w, k, born) * TAU + t * wobble,
			shade,
			shade * 0.95,
			shade * 0.9,
			alpha,
			(k + born) % 4,
		);
	}
	// Flames at the base and embers that rise and fade.
	for (let k = 0; k < 2; k++) {
		const flicker = 0.8 + 0.2 * Math.sin(seconds * (11 + k * 4) + w);
		const frame = 3 + Math.floor((seconds * 9 + k * 5 + w * 3) % 5);
		addSprite(
			fire,
			wreck.x + (k - 0.5) * 1.2,
			wreck.y + 1.5 + k * 0.4,
			wreck.z,
			2.6 * flicker,
			seconds * 0.5 + k,
			2.4 * flicker,
			2.4 * flicker,
			2.4 * flicker,
			1,
			frame,
		);
	}
	for (let k = 0; k < EMBERS_PER_WRECK; k++) {
		const emberLife = 2.2;
		const cycle = seconds / emberLife + k / EMBERS_PER_WRECK + w * 0.21;
		const born = Math.floor(cycle);
		const t = cycle - born;
		const glow = 10 * (1 - t);
		addSprite(
			fire,
			wreck.x + (hash01(w, k, born) - 0.5) * 2 + t * 3,
			wreck.y + 1.6 + t * 6,
			wreck.z + (hash01(w, k, born + 1) - 0.5) * 2 + t,
			0.14,
			0,
			glow,
			glow * 0.45,
			glow * 0.12,
			1,
			FIRE_FRAMES.spark,
		);
	}
}

// The camera, and what the comparison page needs.

/**
 * The camera's loop of two minutes: a wide pass behind army 0 with the sun ahead, a low pass along
 * the front where the lines meet, a high pass over the smoke, and back.
 */
export const BATTLE_CAMERA: CameraLoop = {
	seconds: 120,
	positions: [-130, 34, 60, -40, 9, 34, 10, 6, 30, 60, 22, 70, 120, 46, -40, 0, 60, -150],
	targets: [0, 2, -10, 10, 3, 0, -10, 3, -6, 0, 4, -10, -20, 2, 0, 0, 2, 0],
};

/** Ramps of each device class: the units of both armies. Each row is a first guess. */
export const BATTLE_RAMPS = {
	desktop: { start: 200, factor: 1.2, max: 20_000 },
	tablet: { start: 100, factor: 1.2, max: 8_000 },
	phone: { start: 100, factor: 1.2, max: 4_000 },
} as const satisfies Record<DeviceClass, RampPlan>;

/** The frame that the image tests hold: the lines have met and the guns fire. */
export const BATTLE_HOLD = { seconds: 21, count: 600 } as const;

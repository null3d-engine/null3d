// The island's people and vehicles: what moves, how many, and what the caller supplies.
//
// Vehicles follow closed loops cut from the stored road network at its junctions. Cars take a
// spread of those loops at their own speeds and phases, and one bus runs a long loop that passes
// the harbour, waiting at stops. They move together with a headway: a vehicle holds when its body
// would reach another's, so no two pass through each other. A few cars stand parked at the kerbs.
// A car drives a run of one loop, fades from sight over its last metres, and starts its next run on
// another loop, at a place that clears every other body. The fade follows the distance driven, so a
// car held in a queue never fades; a car that stands too long at a junction, or meets a car facing
// it, starts its next run instead of standing there.
//
// People walk pavements and footpaths between houses, the square, the church, the harbour and the
// beach. Each person takes a place of its own across the pavement, and each route is cut to the
// stretches clear of the houses, of the standing objects and of the moving traffic. Two people
// never walk one line. A person's itinerary holds several walks, each one out and back along its
// route from a place of its own: the person fades from sight at the end of a walk, stays out of
// sight for a moment, and fades back in where the next walk begins. The only waits happen out of
// sight, so a person in view is always walking.
//
// The plan is deterministic from a seed. Speeds are stratified so that no two cars share one, and
// cars that share a loop are spread around it. A different seed gives a different island of traffic.
//
// The caller supplies the models. `createPlaceholderModels` gives simple geometry for a first run;
// the real car, bus and person models replace it without a change to the motion. Each model is a
// list of parts, and every part of a model takes the same transform, so a model with a body, glass
// and wheels draws as several instance batches that move in step. The people near the camera's
// route draw as skinned walkers that play their own clips, and the rest draw as far proxies. A
// proxy has no rig, so its own instance row carries the walk: a rise at the rate of its stride, a
// roll about its heading and a small surge along it. A walker's clip rests while the person is out
// of sight and starts again with the next walk. A row fades by shrinking every part about one ground
// point, so the model keeps its shape; a skinned walker hides whole, because scaling its rig tears
// the mesh and the engine's opaque materials give no fade that moves no geometry.
//
// A vehicle's plain body parts take a colour for each row, so a car and a bus carry a livery of
// their own. A wheel part spins by the distance that its vehicle travels over its radius, and a
// front wheel turns a little into the curve.
//
// Counts at the default options: 9 cars, 1 bus, 8 parked cars and 18 people. A frame samples each
// mover's path and writes its transform into one vertex row per part: 28 movers and about 0.01 ms
// of work on this Mac.

import {
	color,
	type InstanceBatch,
	type Material,
	type Mesh,
	type MeshGeometry,
	type Prefab,
	type PrefabInstance,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import { random } from '../../lib/procedural';
import { BAY, hypot, SEA_LEVEL, sandAt } from './island';
import { HOUSE_KINDS } from './kit';
import {
	CHURCH_AT,
	doorOf,
	FILL_SPOTS,
	groundHeight,
	LOTS,
	type Lot,
	ROADS,
	SHRUBS,
	SQUARE,
	STAIRS,
	TERRACES,
	TREE_SPOTS,
} from './plan';
import { LOUNGER_OFFSETS } from './props';
import type { Road, RoadPoint } from './routes';
import { parasolSpots } from './town';

/** A point in the world, in meters. */
interface Point {
	x: number;
	y: number;
	z: number;
}

/** A path that a mover follows: its points, the distance at each point, and its whole length. */
export interface Path {
	/** Three numbers per point, x, y and z. */
	readonly xyz: Float32Array;
	/** The distance from the path's start at each point, in meters. */
	readonly distance: Float32Array;
	/** The length of the whole path, in meters. */
	readonly length: number;
}

/** A mover's place and the way it faces, in radians about +y. */
export interface Pose {
	x: number;
	y: number;
	z: number;
	yaw: number;
}

/** A leg of a script: a walk between two distances, or a wait at one. */
export interface Leg {
	/** The seconds the leg lasts. */
	readonly seconds: number;
	/** The distance along the path where it starts. */
	readonly from: number;
	/** The distance along the path where it ends. Equal to `from` for a wait. */
	readonly to: number;
	/** True while the mover is out of sight, inside a building or a car. */
	readonly hidden: boolean;
}

/** A repeating sequence of legs, with the time each one ends at. */
export interface Script {
	readonly legs: readonly Leg[];
	/** The seconds from one pass to the next. */
	readonly cycle: number;
	/** The time at the end of each leg, in seconds from the script's start. */
	readonly ends: Float64Array;
}

/** A car or a bus. */
export interface VehicleActor {
	readonly kind: 'car' | 'bus';
	/** The closed loop it runs on. */
	readonly route: Path;
	/** Its speed when no wait holds it, in meters a second. */
	readonly speed: number;
	/** The distance along the route at the start, in meters. */
	readonly phase: number;
	/** The offset from the route's middle line to its side of the road, in meters. */
	readonly lateral: number;
	/** The half length and half width of its body, in meters. */
	readonly halfLength: number;
	readonly halfWidth: number;
	/** The bus's stops and waits; a car has none and runs its loop without stopping. */
	readonly script: Script | undefined;
	/** A car's runs in turn: each covers a stretch of a loop before the car hides and starts again. */
	readonly runs?: readonly VehicleRun[];
}

/** One run of a car: a stretch of a loop that it drives before it hides and starts again. */
export interface VehicleRun {
	/** The loop driven. */
	readonly route: Path;
	/** The offset from the loop's middle line to the car's side of the road, in meters. */
	readonly lateral: number;
	/** The meters along the route where the car appears. */
	readonly from: number;
	/** The meters that the car drives before it fades out and starts its next run. */
	readonly distance: number;
}

/** One walk in a person's itinerary: a walk out and back, with its own hidden ends. */
export interface PersonTrip {
	/** The path walked, from a place on it to its far end. */
	readonly walk: Path;
	/** The walking and hidden legs over that path. */
	readonly script: Script;
	/** The seconds into the person's itinerary when the trip begins. */
	readonly start: number;
}

/** A person who walks a repeating itinerary of walks, each starting at a different place. */
export interface PersonActor {
	/** The path of the first walk, from a door or the road to the far end. */
	readonly walk: Path;
	/** The speed of the walking legs, in meters a second. */
	readonly speed: number;
	/** The seconds into the itinerary at the start. */
	readonly phase: number;
	/** The offset from the walk's line to the person's side of the pavement, in meters. */
	readonly lateral: number;
	/** The walking and hidden legs of the first walk. */
	readonly script: Script;
	/** The walks that the person takes in turn, each from a place of its own. */
	readonly trips: readonly PersonTrip[];
	/** The seconds of the whole itinerary, which repeats. */
	readonly cycle: number;
	/** True when the first walk ends beside a car that the person gets into. */
	readonly ride: boolean;
}

/** A car that stands still. */
export interface ParkedCar {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
}

/** What moves, where, and how it is scripted. */
export interface TrafficPlan {
	readonly vehicles: readonly VehicleActor[];
	readonly people: readonly PersonActor[];
	readonly parked: readonly ParkedCar[];
	readonly counts: {
		readonly cars: number;
		readonly buses: number;
		readonly parkedCars: number;
		readonly people: number;
	};
}

/** The options that shape the plan. */
export interface TrafficOptions {
	/** The seed of every variation. The same seed gives the same plan. */
	readonly seed?: number;
	/** How many cars run. The default is 9. */
	readonly cars?: number;
	/** How many cars stand parked. The default is 8. */
	readonly parkedCars?: number;
	/** How many people walk. The default is 18. */
	readonly people?: number;
	/** False leaves the bus out. The default runs it. */
	readonly bus?: boolean;
	/**
	 * The places that the camera visits. The people whose walks come nearest them draw as skinned
	 * walkers; the rest stand as far proxies. Left out, every person draws as a proxy.
	 */
	readonly watch?: readonly (readonly [number, number, number])[];
	/** How many people walk as models near the watch places. The default is 12. */
	readonly walkers?: number;
}

/** A part of a model that takes a colour for each row. */
export type TintRole = 'paint' | 'accent' | 'cloth' | 'legs' | 'feet';

/** How a wheel turns: by the distance travelled over its radius, and a front wheel into a curve. */
export interface WheelSpin {
	/** The wheel's radius, in meters. */
	readonly radius: number;
	/** True for a front wheel, which steers into the curve. */
	readonly front?: boolean;
}

/** One drawable part of a car, a bus or a person. */
export interface TrafficPart {
	readonly mesh: MeshGeometry;
	readonly material: Material;
	/** The meters the part's middle stands above the path's surface. The default is 0. */
	readonly lift?: number;
	/** The radians added to the path's heading, so the model's front points forward. The default is 0. */
	readonly yaw?: number;
	/** The part's uniform scale, multiplied into its node's own scale. The default is 1. */
	readonly scale?: number;
	/**
	 * The part's own place in its file, which the parts of a quantized model store in their nodes.
	 * The position is in the model's meters, and the scale is per axis.
	 */
	readonly position?: readonly [number, number, number];
	readonly rotation?: readonly [number, number, number, number];
	readonly nodeScale?: readonly [number, number, number];
	/** The colour role of the part, when its plain material takes a colour for each row. */
	readonly tint?: TintRole;
	/** How the part turns, when it is a wheel. */
	readonly wheel?: WheelSpin;
}

/** A mesh node of a skinned walker, and the colour that its clothing takes. */
export interface WalkerPart {
	/** The node's name in the model file. */
	readonly name: string;
	/** The colour role of the node, when its plain material takes a colour of its own. */
	readonly tint?: TintRole;
}

/** A skinned walker that a person near the camera's route draws. */
export interface WalkerModel {
	/** The file that holds the walker. */
	readonly prefab: Prefab;
	/** The walker's mesh nodes, and the colour of each clothing part. */
	readonly parts: readonly WalkerPart[];
	/** The nodes of the file that a copy hides, which are the models that it does not draw. */
	readonly hidden: readonly string[];
	/** The clip that the walker plays. */
	readonly clip: string;
}

/** A person's model: the far proxy that stands, and the skinned walker when the file holds one. */
export interface PersonModel {
	/** The standing parts that draw this person far from the camera. */
	readonly parts: readonly TrafficPart[];
	/** The skinned walker, or undefined while the file holds only the standing parts. */
	readonly walker?: WalkerModel;
}

/** The models that the motion draws. Every part of one model takes that model's transform. */
export interface TrafficModels {
	readonly car: readonly TrafficPart[];
	readonly bus: readonly TrafficPart[];
	/** The people's models, which the people's indices cycle through. */
	readonly people: readonly PersonModel[];
}

/** The moving scene, as the caller drives it. */
export interface Traffic {
	/** Places every mover at the given seconds since the scene started. */
	update(seconds: number): void;
	/** Removes every batch, walker copy and material that the traffic made. */
	destroy(): void;
	readonly counts: TrafficPlan['counts'];
	/** The number of instance rows that draw. */
	readonly rows: number;
	/** The number of instance batches, which is one draw call each. */
	readonly batches: number;
	/**
	 * The moving vehicles' drawn places, three numbers a vehicle: x, y and z. The cars come first,
	 * in the plan's order, and the bus is last when it runs. Parked cars are not included.
	 */
	readonly vehicles: Float32Array;
	/** The speed of each moving vehicle, in meters a second, in the same order; 0 out of sight. */
	readonly speeds: Float32Array;
}

/** The seed of the default plan. */
export const TRAFFIC_SEED = 20261122;

/** The default numbers of cars, parked cars and people. */
const DEFAULT_CARS = 9;
const DEFAULT_PARKED = 8;
const DEFAULT_PEOPLE = 18;
/** How many people walk as models near the camera's route, by default. */
const DEFAULT_WALKERS = 12;
/** How near a walk must pass a watched place to read as close, in meters. */
const WATCH_STEP = 2;

/** How far past a road's edge a pavement runs, in meters. */
const PAVEMENT = 1;
/**
 * The height of the drawn pavement above a road's stored middle line, in meters. The town draws its
 * road's flat shoulder at that height, so a walk that takes its points from the stored line stands
 * this much lower than the surface that people see.
 */
const PAVEMENT_LIFT = 0.26;
/** How near a road's end must lie to another road's middle line to make a junction, in meters. */
const JUNCTION_TOL = 4;
/** The shortest loop that a car runs, in meters, so that a car never whips round a tight circle. */
const MIN_CYCLE = 120;
/** The shortest loop that a car takes, in meters, so that its laps do not read as a racetrack. */
const MIN_CAR_CYCLE = 350;
/** The shortest loop that the bus takes, in meters, and the longest, so that it passes often. */
const MIN_BUS_CYCLE = 300;
const MAX_BUS_CYCLE = 2000;
/** How near the harbour front a loop must pass to carry the bus, in meters. */
const BUS_HARBOUR_REACH = 160;
/** The point on the quay road that stands for the harbour front. */
const HARBOUR_FRONT = { x: -77, z: 276 };
/** The shortest and longest car and bus speeds, in meters a second. */
const CAR_SPEED = [7.5, 12] as const;
const BUS_SPEED = [7, 8.5] as const;
/** The shortest and longest walking speeds, in meters a second. */
const WALK_SPEED = [1.05, 1.5] as const;
/** How far past the kerb a parked car stands, so that moving traffic passes it, in meters. */
const PARKED_KERB = 0.5;
/** The least gap between a parked car's middle and a moving car's middle, in meters. */
const PARKED_CLEAR = 2;
/** The margin that a parked car's outline keeps from a house, in meters. */
const PARKED_HOUSE_CLEAR = 0.05;
/** The height of the drawn road's surface over its stored middle line, in meters. */
const ROAD_SURFACE = 0.3;
/** The number of stops that the bus makes on its loop. */
const BUS_STOPS = 5;
/** The seconds a bus waits at a stop. */
const BUS_WAIT = [8, 13] as const;
/** How far a person's model stands above the path's surface, in meters. */
const PERSON_LIFT = 0.8;
/** How far ahead and behind a mover the heading is read, in meters. */
const HEADING_SPAN = 1.2;
/** The half lengths and half widths of a car's and a bus's body, in meters. */
export const CAR_HALF_LENGTH = 2.1;
export const CAR_HALF_WIDTH = 0.9;
export const BUS_HALF_LENGTH = 4.3;
export const BUS_HALF_WIDTH = 1.2;
/** The least gap that a follower keeps between its body and another vehicle's body, in meters. */
const VEHICLE_GAP = 0.5;
/** The radius of a person's body, in meters. */
export const PERSON_RADIUS = 0.3;
/** The least gap between two visible people, in meters. */
const PERSON_CLEAR = 0.6;
/** The shortest walk that a rider keeps after the walk is cut back to its car, in meters. */
const MIN_RIDER_WALK = 5;
/** The shortest walk that a person keeps, so that a person never blinks in and out of one place. */
const MIN_PERSON_WALK = 4;
/** The places that people take across one pavement, a body's width apart, in meters. */
const SIDES_FOUR = [-1.05, -0.35, 0.35, 1.05] as const;
const SIDES_THREE = [-0.7, 0, 0.7] as const;
const SIDES_ONE = [1.05] as const;
/** The margin that a walk keeps from every house wall, in meters. */
const HOUSE_CLEAR = 0.45;
/** How far ahead of a door a person steps out before the walk counts, in meters. */
const DOOR_STEP = 0.5;

/** The speed that each walk clip's steps are made for, in meters a second. */
const WALK_CLIP_SPEED = 1.4;
/** The meters that a full stride covers, which sets the rate of a proxy's walk. */
const STRIDE_LENGTH = 1.45;
/** How high a stride lifts a proxy, in meters; its lowest point keeps the feet on the ground. */
const STRIDE_BOB = 0.035;
/** How far a proxy rolls about its heading, in radians. */
const STRIDE_ROLL = 0.035;
/** How far a proxy surges along its heading, in meters. */
const STRIDE_SWAY = 0.025;
/** The seconds that a stride takes to fade in at the start of a walk and out at its end. */
const STRIDE_EASE = 0.35;
/** The seconds that a person stays out of sight between two walks, so the move reads as a fade. */
const TRIP_GAP = [0.6, 1.8] as const;
/** How many walks a person's itinerary holds, the first one included. */
const TRIP_COUNT = 4;
/** The meters over which a car fades from sight at the end of a run and back at its start. */
const RUN_FADE_METERS = 5;
/** The seconds that a car may stand before it starts its next run rather than hold a junction. */
const HELD_ESCAPE = 4;
/** The shortest and longest run that a car drives before it hides and starts again, in seconds. */
const RUN_SECONDS = [45, 110] as const;
/** How many runs a car's cycle holds, which send it round a different loop each time. */
const CAR_RUNS = 3;
/** The places that a car tries on a loop where it starts again, across the loop. */
const RUN_STARTS = 24;
/** The stretch of route over which a front wheel reads its curve, in meters. */
const STEER_SPAN = 1.4;
/** The most that a front wheel turns into a curve, in radians. */
const MAX_STEER = 0.5;
/** The palette of the cars on the road, as sRGB hex colors. */
const MOVING_CAR_COLOURS = [
	'#b8452f',
	'#2f608c',
	'#5f6b3f',
	'#c9a24a',
	'#6d7076',
	'#d9d3c4',
] as const;
/** The palette of the cars at the kerb, which shares no color with the moving ones. */
const PARKED_CAR_COLOURS = ['#9aa3a8', '#7d9995', '#8899ab', '#cfc6b1'] as const;
/** The bus's hull and its band. */
const BUS_PAINT = '#2f5d85';
const BUS_BAND = '#e8e0cc';
/** The shirts that the people of the town wear, as sRGB hex colors. */
const SHIRT_COLOURS = ['#b8482f', '#3f6f8f', '#6a7f4a', '#d8c9a3', '#7a5a83', '#3d7a6e'] as const;
/** The trousers and dresses that they wear. */
const LEG_COLOURS = ['#3d4550', '#6a5c4a', '#5a6a74', '#8a7f6a', '#4a5b52', '#6b4a44'] as const;
/** The shoes that every person wears. */
const SHOE_COLOUR = '#3e352c';
/** The unit axes that a wheel turns about: across the vehicle, and up. */
const AXLE = [1, 0, 0] as const;
const UP = [0, 1, 0] as const;

/** A linear RGBA colour. */
type Rgba = readonly [number, number, number, number];

/** The linear RGBA of an sRGB hex colour. */
function linear(hex: string): Rgba {
	const rgb = color.fromHex([0, 0, 0], hex);
	return [rgb[0] as number, rgb[1] as number, rgb[2] as number, 1];
}

/** The colours of the cars on the road, and of the cars at the kerb, as linear RGBA. */
const MOVING_CAR_PAINT = MOVING_CAR_COLOURS.map(linear);
const PARKED_CAR_PAINT = PARKED_CAR_COLOURS.map(linear);
/** The bus's two colours, and the shoe colour, as linear RGBA. */
const BUS_PAINT_RGBA = linear(BUS_PAINT);
const BUS_BAND_RGBA = linear(BUS_BAND);
const SHOE_RGBA = linear(SHOE_COLOUR);

/** The shirt, legs and shoes of the person at a place in the plan, as sRGB hex colors. */
function clothingOf(index: number): { shirt: string; legs: string; feet: string } {
	return {
		shirt: SHIRT_COLOURS[index % SHIRT_COLOURS.length] as string,
		legs: LEG_COLOURS[index % LEG_COLOURS.length] as string,
		feet: SHOE_COLOUR,
	};
}

/** The distances from the start at each point of a line. */
function distancesOf(points: readonly Point[]): Float64Array {
	const out = new Float64Array(points.length);
	for (let k = 1; k < points.length; k++) {
		const a = points[k - 1] as Point;
		const b = points[k] as Point;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dz = b.z - a.z;
		out[k] = (out[k - 1] as number) + Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
	return out;
}

/** The arc distances of each stored road, worked out once. */
const ARC_TABLES = new Map<Road, Float64Array>();
function arcsOf(road: Road): Float64Array {
	let table = ARC_TABLES.get(road);
	if (!table) {
		table = distancesOf(road.points);
		ARC_TABLES.set(road, table);
	}
	return table;
}

/** The unit tangent of a road at an arc distance. */
function tangentAt(road: Road, cumulative: Float64Array, at: number): [number, number] {
	const points = road.points;
	let k = 0;
	while (k + 2 < cumulative.length && (cumulative[k + 1] as number) < at) k++;
	const a = points[k] as RoadPoint;
	const b = points[Math.min(k + 1, points.length - 1)] as RoadPoint;
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length = hypot(dx, dz) || 1;
	return [dx / length, dz / length];
}

/** Builds a path from points, dropping points that sit on the one before. */
export function makePath(points: readonly Point[]): Path {
	const kept: Point[] = [];
	for (const point of points) {
		const last = kept[kept.length - 1];
		if (
			!last ||
			hypot(point.x - last.x, point.z - last.z) > 0.02 ||
			Math.abs(point.y - last.y) > 0.02
		)
			kept.push({ x: point.x, y: point.y, z: point.z });
	}
	if (kept.length === 0) kept.push({ x: 0, y: 0, z: 0 });
	if (kept.length === 1)
		kept.push({ x: (kept[0] as Point).x, y: (kept[0] as Point).y, z: (kept[0] as Point).z });
	const distance = distancesOf(kept);
	const length = distance[distance.length - 1] as number;
	const xyz = new Float32Array(kept.length * 3);
	kept.forEach((point, k) => {
		xyz[k * 3] = point.x;
		xyz[k * 3 + 1] = point.y;
		xyz[k * 3 + 2] = point.z;
	});
	return { xyz, distance: Float32Array.from(distance), length };
}

/** Writes a point of a path at a distance into `out`. Clamps to the path's ends. */
export function pathAt(path: Path, at: number, out: Pose): Pose {
	const d = Math.max(0, Math.min(path.length, at));
	const distance = path.distance;
	let lo = 0;
	let hi = distance.length - 1;
	while (lo + 1 < hi) {
		const mid = (lo + hi) >> 1;
		if ((distance[mid] as number) <= d) lo = mid;
		else hi = mid;
	}
	const a = lo;
	const b = hi;
	const span = (distance[b] as number) - (distance[a] as number);
	const t = span > 1e-9 ? (d - (distance[a] as number)) / span : 0;
	const xyz = path.xyz;
	out.x = (xyz[a * 3] as number) + ((xyz[b * 3] as number) - (xyz[a * 3] as number)) * t;
	out.y =
		(xyz[a * 3 + 1] as number) + ((xyz[b * 3 + 1] as number) - (xyz[a * 3 + 1] as number)) * t;
	out.z =
		(xyz[a * 3 + 2] as number) + ((xyz[b * 3 + 2] as number) - (xyz[a * 3 + 2] as number)) * t;
	const dx = (xyz[b * 3] as number) - (xyz[a * 3] as number);
	const dz = (xyz[b * 3 + 2] as number) - (xyz[a * 3 + 2] as number);
	if (dx * dx + dz * dz > 1e-9) out.yaw = Math.atan2(dx, dz);
	return out;
}

/** Wraps a distance into a closed path. */
function loopDistance(distance: number, length: number): number {
	if (length <= 0) return 0;
	const wrapped = distance % length;
	return wrapped < 0 ? wrapped + length : wrapped;
}

/**
 * Samples a path at a distance and to one side of it. With `closed`, the distance wraps and the
 * heading is read across the wrap; otherwise both clamp to the ends. The heading is read over a
 * short span, so a vehicle turns into a junction rather than snapping to the new road's line.
 */
function poseAlong(
	path: Path,
	at: number,
	lateral: number,
	closed: boolean,
	out: Pose,
	scratch: Pose,
): void {
	const length = path.length;
	const d = closed ? loopDistance(at, length) : Math.max(0, Math.min(length, at));
	pathAt(path, d, out);
	const back = closed ? loopDistance(d - HEADING_SPAN, length) : Math.max(0, d - HEADING_SPAN);
	const ahead = closed
		? loopDistance(d + HEADING_SPAN, length)
		: Math.min(length, d + HEADING_SPAN);
	pathAt(path, back, scratch);
	const bx = scratch.x;
	const bz = scratch.z;
	pathAt(path, ahead, scratch);
	if (hypot(scratch.x - bx, scratch.z - bz) > 1e-4)
		out.yaw = Math.atan2(scratch.x - bx, scratch.z - bz);
	if (lateral !== 0) {
		const nx = Math.cos(out.yaw);
		const nz = -Math.sin(out.yaw);
		out.x += nx * lateral;
		out.z += nz * lateral;
	}
}

/** A pose reused by the exported samplers, so that a caller that keeps no pose allocates nothing. */
const SHARED_POSE: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const SHARED_SCRATCH: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/** One edge of the road network: a stretch of one stored road, between two junctions. */
export interface NetworkEdge {
	readonly id: number;
	/** The stored road's place in the plan's list. */
	readonly road: number;
	/** The nodes at its two ends. */
	readonly from: number;
	readonly to: number;
	/** The stretch, from `from` to `to`. */
	readonly path: Path;
	/** The half width of the road. */
	readonly half: number;
}

/** A closed loop of edges. */
export interface Cycle {
	readonly path: Path;
	readonly length: number;
	/** The narrowest half width of the roads it runs on, in meters. */
	readonly minHalf: number;
	/** The edges it uses, sorted, which name it uniquely. */
	readonly edges: readonly number[];
}

/** The roads cut into edges at their junctions, with every closed loop that they make. */
export interface RoadNetwork {
	readonly edges: readonly NetworkEdge[];
	readonly cycles: readonly Cycle[];
}

/** Projects a point onto a road's middle line. */
function projectOnRoad(
	road: Road,
	x: number,
	z: number,
): { at: number; x: number; y: number; z: number; d: number } {
	const points = road.points;
	let at = 0;
	let best = {
		at: 0,
		x: (points[0] as RoadPoint).x,
		y: (points[0] as RoadPoint).y,
		z: (points[0] as RoadPoint).z,
		d: Number.POSITIVE_INFINITY,
	};
	for (let k = 0; k + 1 < points.length; k++) {
		const a = points[k] as RoadPoint;
		const b = points[k + 1] as RoadPoint;
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const length2 = dx * dx + dz * dz;
		if (length2 < 1e-9) continue;
		let t = ((x - a.x) * dx + (z - a.z) * dz) / length2;
		t = Math.max(0, Math.min(1, t));
		const px = a.x + dx * t;
		const pz = a.z + dz * t;
		const d = hypot(x - px, z - pz);
		const segment = Math.sqrt(length2);
		if (d < best.d) best = { at: at + segment * t, x: px, y: a.y + (b.y - a.y) * t, z: pz, d };
		at += segment;
	}
	return best;
}

/** The point of a road at an arc distance. */
function pointAt(road: Road, cumulative: Float64Array, at: number): Point {
	const points = road.points;
	const length = cumulative[cumulative.length - 1] as number;
	const d = Math.max(0, Math.min(length, at));
	let k = 0;
	while (k + 2 < cumulative.length && (cumulative[k + 1] as number) < d) k++;
	const a = points[k] as RoadPoint;
	const b = points[Math.min(k + 1, points.length - 1)] as RoadPoint;
	const span =
		(cumulative[Math.min(k + 1, cumulative.length - 1)] as number) - (cumulative[k] as number);
	const t = span > 1e-9 ? (d - (cumulative[k] as number)) / span : 0;
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** A stretch of a road between two arc distances, in order from `from` to `to`. */
function roadSlice(road: Road, cumulative: Float64Array, from: number, to: number): Point[] {
	const forward = (a: number, b: number): Point[] => {
		const out: Point[] = [pointAt(road, cumulative, a)];
		for (let k = 0; k < road.points.length; k++) {
			const d = cumulative[k] as number;
			if (d > a + 1e-6 && d < b - 1e-6) {
				const p = road.points[k] as RoadPoint;
				out.push({ x: p.x, y: p.y, z: p.z });
			}
		}
		out.push(pointAt(road, cumulative, b));
		return out;
	};
	if (from <= to) return forward(from, to);
	return forward(to, from).reverse();
}

/** Moves every point of a line to one side of it. The side's sign picks the side. */
function offsetLine(points: readonly Point[], distance: number, side: number): Point[] {
	const out: Point[] = [];
	for (let k = 0; k < points.length; k++) {
		const before = points[Math.max(0, k - 1)] as Point;
		const after = points[Math.min(points.length - 1, k + 1)] as Point;
		const here = points[k] as Point;
		let tx = after.x - before.x;
		let tz = after.z - before.z;
		const length = hypot(tx, tz) || 1;
		tx /= length;
		tz /= length;
		const nx = tz * side;
		const nz = -tx * side;
		out.push({ x: here.x + nx * distance, y: here.y, z: here.z + nz * distance });
	}
	return out;
}

/** The side of a road, at an arc distance, that a place lies on. */
function sideToward(
	road: Road,
	cumulative: Float64Array,
	at: number,
	x: number,
	z: number,
): number {
	const here = pointAt(road, cumulative, at);
	const [tx, tz] = tangentAt(road, cumulative, at);
	return (x - here.x) * tz - (z - here.z) * tx >= 0 ? 1 : -1;
}

/** The arc distance on a road nearest a place. */
function arcNear(road: Road, x: number, z: number): number {
	return projectOnRoad(road, x, z).at;
}

/** The stored road whose middle line lies nearest a place, among roads of a half width. */
function roadNear(x: number, z: number, half?: number): Road {
	const nearestOf = (match: (road: Road) => boolean): Road | undefined => {
		let best: Road | undefined;
		let nearest = Number.POSITIVE_INFINITY;
		for (const road of ROADS) {
			if (!match(road)) continue;
			const d = projectOnRoad(road, x, z).d;
			if (d < nearest) {
				nearest = d;
				best = road;
			}
		}
		return best;
	};
	const matched =
		half === undefined ? undefined : nearestOf((road) => Math.abs(road.half - half) <= 1e-6);
	return matched ?? nearestOf(() => true) ?? (ROADS[0] as Road);
}

/** Cuts the stored roads into edges at their junctions, then finds every closed loop they make. */
export function buildRoadNetwork(roads: readonly Road[]): RoadNetwork {
	const cumulative = roads.map(arcsOf);
	const roadLength = cumulative.map((c) => c[c.length - 1] as number);
	const nodes: { x: number; z: number }[] = [];
	const nodeOf = (x: number, z: number): number => {
		for (let k = 0; k < nodes.length; k++) {
			const node = nodes[k] as { x: number; z: number };
			if (hypot(node.x - x, node.z - z) < 0.75) return k;
		}
		nodes.push({ x, z });
		return nodes.length - 1;
	};
	const splits: { at: number; node: number }[][] = roads.map(() => []);
	for (let i = 0; i < roads.length; i++) {
		const road = roads[i] as Road;
		const ends = [road.points[0] as RoadPoint, road.points[road.points.length - 1] as RoadPoint];
		for (const end of ends) {
			let best = { d: Number.POSITIVE_INFINITY, road: -1, at: 0 };
			for (let j = 0; j < roads.length; j++) {
				if (j === i) continue;
				const found = projectOnRoad(roads[j] as Road, end.x, end.z);
				if (found.d < best.d) best = { d: found.d, road: j, at: found.at };
			}
			if (best.road >= 0 && best.d <= JUNCTION_TOL)
				(splits[best.road] as { at: number; node: number }[]).push({
					at: best.at,
					node: nodeOf(end.x, end.z),
				});
		}
		for (let k = 0; k < 2; k++) {
			const end = ends[k] as RoadPoint;
			(splits[i] as { at: number; node: number }[]).push({
				at: k === 0 ? 0 : (roadLength[i] as number),
				node: nodeOf(end.x, end.z),
			});
		}
	}
	const edges: NetworkEdge[] = [];
	for (let i = 0; i < roads.length; i++) {
		const road = roads[i] as Road;
		const cum = cumulative[i] as Float64Array;
		const list = (splits[i] as { at: number; node: number }[]).slice().sort((a, b) => a.at - b.at);
		const cut: { at: number; node: number }[] = [];
		for (const split of list) {
			const last = cut[cut.length - 1];
			if (last && Math.abs(last.at - split.at) < 0.4) continue;
			cut.push(split);
		}
		for (let k = 0; k + 1 < cut.length; k++) {
			const a = cut[k] as { at: number; node: number };
			const b = cut[k + 1] as { at: number; node: number };
			if (b.at - a.at < 0.5) continue;
			// Both ends take the junction's own place, so two roads that end a little apart still meet
			// at one point and a loop of them does not double back across the gap.
			const slice = roadSlice(road, cum, a.at, b.at);
			const head = nodes[a.node] as { x: number; z: number };
			const tail = nodes[b.node] as { x: number; z: number };
			(slice[0] as Point).x = head.x;
			(slice[0] as Point).z = head.z;
			const last = slice[slice.length - 1] as Point;
			last.x = tail.x;
			last.z = tail.z;
			const path = makePath(slice);
			if (path.length < 1e-3) continue;
			edges.push({ id: edges.length, road: i, from: a.node, to: b.node, path, half: road.half });
		}
	}
	const adjacency = new Map<number, number[]>();
	for (const edge of edges) {
		const from = adjacency.get(edge.from);
		if (from) from.push(edge.id);
		else adjacency.set(edge.from, [edge.id]);
		const to = adjacency.get(edge.to);
		if (to) to.push(edge.id);
		else adjacency.set(edge.to, [edge.id]);
	}
	// A spanning tree of the edges, then the one loop that each edge outside it closes. Every loop of
	// the network comes out of some choice of tree, and this tree gives the island's long loops as
	// well as its short ones.
	const roots = [...adjacency.keys()].sort((a, b) => a - b);
	const treeEdge = new Set<number>();
	const parentNode = new Map<number, number>();
	const parentEdge = new Map<number, number>();
	const depth = new Map<number, number>();
	const visited = new Set<number>();
	for (const root of roots) {
		if (visited.has(root)) continue;
		visited.add(root);
		parentNode.set(root, -1);
		parentEdge.set(root, -1);
		depth.set(root, 0);
		const queue = [root];
		for (let head = 0; head < queue.length; head++) {
			const node = queue[head] as number;
			for (const id of adjacency.get(node) ?? []) {
				const edge = edges[id] as NetworkEdge;
				const other = edge.from === node ? edge.to : edge.from;
				if (visited.has(other)) continue;
				visited.add(other);
				parentNode.set(other, node);
				parentEdge.set(other, id);
				depth.set(other, (depth.get(node) as number) + 1);
				treeEdge.add(id);
				queue.push(other);
			}
		}
	}
	const ancestorOf = (a: number, b: number): number => {
		let x = a;
		let y = b;
		while ((depth.get(x) as number) > (depth.get(y) as number)) x = parentNode.get(x) as number;
		while ((depth.get(y) as number) > (depth.get(x) as number)) y = parentNode.get(y) as number;
		while (x !== y) {
			x = parentNode.get(x) as number;
			y = parentNode.get(y) as number;
		}
		return x;
	};
	const found: { chain: number[]; start: number }[] = [];
	const keys = new Set<string>();
	for (const edge of edges) {
		if (treeEdge.has(edge.id)) continue;
		const common = ancestorOf(edge.from, edge.to);
		const chain: number[] = [];
		for (let node = edge.from; node !== common; node = parentNode.get(node) as number)
			chain.push(parentEdge.get(node) as number);
		const down: number[] = [];
		for (let node = edge.to; node !== common; node = parentNode.get(node) as number)
			down.push(parentEdge.get(node) as number);
		down.reverse();
		chain.push(...down, edge.id);
		const key = [...chain].sort((a, b) => a - b).join(',');
		if (keys.has(key)) continue;
		keys.add(key);
		found.push({ chain, start: edge.from });
	}
	const cycles: Cycle[] = [];
	for (const { chain, start } of found) {
		if (chain.length === 0) continue;
		let node = start;
		for (const edgeId of chain) {
			const edge = edges[edgeId] as NetworkEdge;
			node = edge.from === node ? edge.to : edge.from;
		}
		if (node !== start) continue;
		const points: Point[] = [];
		node = start;
		let minHalf = Number.POSITIVE_INFINITY;
		const ordered: number[] = [];
		for (const edgeId of chain) {
			const edge = edges[edgeId] as NetworkEdge;
			ordered.push(edgeId);
			minHalf = Math.min(minHalf, edge.half);
			const path = edge.path;
			const forward = edge.from === node;
			const count = path.distance.length;
			for (let k = 0; k < count; k++) {
				const index = forward ? k : count - 1 - k;
				const x = path.xyz[index * 3] as number;
				const y = path.xyz[index * 3 + 1] as number;
				const z = path.xyz[index * 3 + 2] as number;
				const last = points[points.length - 1];
				if (!last || hypot(last.x - x, last.z - z) > 0.1 || Math.abs(last.y - y) > 0.1)
					points.push({ x, y, z });
			}
			node = forward ? edge.to : edge.from;
		}
		const firstPoint = points[0] as Point;
		const last = points[points.length - 1] as Point;
		if (hypot(last.x - firstPoint.x, last.z - firstPoint.z) > 0.1)
			points.push({ x: firstPoint.x, y: firstPoint.y, z: firstPoint.z });
		const path = makePath(points);
		if (path.length < MIN_CYCLE) continue;
		cycles.push({ path, length: path.length, minHalf, edges: [...ordered].sort((a, b) => a - b) });
	}
	cycles.sort((a, b) => b.length - a.length || a.edges.join(',').localeCompare(b.edges.join(',')));
	return { edges, cycles };
}

/** How much of a loop runs on edges that other loops already use, from 0 to 1. */
function overlap(cycle: Cycle, picked: readonly Cycle[]): number {
	const used = new Set<number>();
	for (const other of picked) for (const edge of other.edges) used.add(edge);
	let shared = 0;
	for (const edge of cycle.edges) if (used.has(edge)) shared++;
	return cycle.edges.length > 0 ? shared / cycle.edges.length : 0;
}

/** The nearest sample of a loop to a place. */
function loopNear(cycle: Cycle, x: number, z: number): number {
	let best = Number.POSITIVE_INFINITY;
	const xyz = cycle.path.xyz;
	for (let k = 0; k < xyz.length; k += 3) {
		const d = hypot((xyz[k] as number) - x, (xyz[k + 2] as number) - z);
		if (d < best) best = d;
	}
	return best;
}

/** Ends a script: the time at the end of each leg, and the whole cycle. */
function finishScript(legs: Leg[]): Script {
	const ends = new Float64Array(legs.length);
	let total = 0;
	legs.forEach((leg, k) => {
		total += leg.seconds;
		ends[k] = total;
	});
	return { legs, cycle: total, ends };
}

/** A script with no legs, for a place that holds none yet. */
const EMPTY_SCRIPT: Script = { legs: [], cycle: 0, ends: new Float64Array(0) };

/** Adds a leg to a script, unless it has no duration. */
function addLeg(legs: Leg[], from: number, to: number, seconds: number, hidden: boolean): void {
	if (seconds <= 1e-9) return;
	legs.push({ seconds, from, to, hidden });
}

/**
 * Builds a person's first walk. A person who gets into a car at the far end walks there and stays
 * out of sight; every other person walks out and back, then stands out of sight where it started.
 * The person is never seen standing still.
 */
function buildFirstTrip(
	walk: Path,
	speed: number,
	lead: number,
	tail: number,
	ride: boolean,
): Script {
	const legs: Leg[] = [];
	addLeg(legs, 0, 0, lead, true);
	addLeg(legs, 0, walk.length, walk.length / speed, false);
	if (ride) addLeg(legs, walk.length, walk.length, tail, true);
	else {
		addLeg(legs, walk.length, 0, walk.length / speed, false);
		addLeg(legs, 0, 0, tail, true);
	}
	return finishScript(legs);
}

/** Builds a later walk: from a place on the path to its far end and back, out of sight at each end. */
function buildLaterTrip(walk: Path, speed: number, from: number, tail: number): Script {
	const legs: Leg[] = [];
	addLeg(legs, from, walk.length, (walk.length - from) / speed, false);
	addLeg(legs, walk.length, from, (walk.length - from) / speed, false);
	addLeg(legs, from, from, tail, true);
	return finishScript(legs);
}

/** Builds a script for a closed loop: the stops pass in order and the loop wraps at its end. */
function buildLoopScript(
	length: number,
	speed: number,
	stops: readonly { at: number; seconds: number }[],
): Script {
	const legs: Leg[] = [];
	const add = (from: number, to: number, seconds: number): void => {
		if (seconds <= 1e-9) return;
		legs.push({ seconds, from, to, hidden: false });
	};
	const ordered = stops.slice().sort((a, b) => a.at - b.at);
	let at = 0;
	for (const stop of ordered) {
		add(at, stop.at, Math.abs(stop.at - at) / speed);
		add(stop.at, stop.at, stop.seconds);
		at = stop.at;
	}
	add(at, length, Math.abs(length - at) / speed);
	return finishScript(legs);
}

/** Where a script is at a time: its distance and whether it is out of sight. */
interface ScriptState {
	distance: number;
	hidden: boolean;
	forward: boolean;
}

/** The state scratch that every script sample writes into. */
const SCRIPT_STATE: ScriptState = { distance: 0, hidden: false, forward: true };

/** A script's leg at a time, and how much of that leg has passed. */
interface LegState {
	leg: Leg;
	/** The leg's place in the script. */
	index: number;
	/** The seconds from the leg's start. */
	elapsed: number;
}

/** The leg scratch that every script read writes into. */
const LEG_STATE: LegState = {
	leg: { seconds: 0, from: 0, to: 0, hidden: true },
	index: 0,
	elapsed: 0,
};

/** Reads the leg of a script at a local time, which lies between zero and the cycle. */
function legAt(script: Script, local: number, out: LegState = LEG_STATE): LegState {
	const ends = script.ends;
	let lo = 0;
	let hi = ends.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((ends[mid] as number) <= local) lo = mid + 1;
		else hi = mid;
	}
	const before = lo === 0 ? 0 : (ends[lo - 1] as number);
	out.leg = script.legs[lo] as Leg;
	out.index = lo;
	out.elapsed = local - before;
	return out;
}

/** Reads a script at a time. The script repeats; a negative time wraps like a positive one. */
function sampleScript(script: Script, seconds: number, out: ScriptState): ScriptState {
	if (script.cycle <= 1e-9 || script.legs.length === 0) {
		out.distance = 0;
		out.hidden = true;
		out.forward = true;
		return out;
	}
	let local = seconds % script.cycle;
	if (local < 0) local += script.cycle;
	const { leg, elapsed } = legAt(script, local, LEG_STATE);
	const t = leg.seconds > 1e-9 ? elapsed / leg.seconds : 0;
	out.distance = leg.from + (leg.to - leg.from) * t;
	out.hidden = leg.hidden;
	out.forward = leg.to >= leg.from;
	return out;
}

/** One plan's vehicles, moved together with a minimum headway between their bodies. */
interface VehicleMotion {
	readonly actors: readonly VehicleActor[];
	/** The order that vehicles settle each step: the bus first, then cars by index. */
	readonly order: readonly number[];
	/** The seconds of one step. */
	readonly step: number;
	/** The chosen distance of each vehicle at each cached step, one row per step. */
	data: Float32Array;
	/** The rows cached, including step 0. */
	steps: number;
	capacity: number;
	/** The loop of each vehicle's current run, or undefined while it runs its plan's route. */
	readonly paths: (Path | undefined)[];
	/** The offset of each vehicle from the middle line of its current run's loop, in meters. */
	readonly laterals: Float64Array;
	/** The loops that the runs have used, which the step rows name. */
	readonly pathList: Path[];
	/** The loop of each vehicle at each cached step, plus one, or 0 for its plan's route. */
	stepPaths: Uint16Array;
	/** The offset of each vehicle from its loop's middle line at each cached step, in meters. */
	stepLaterals: Float32Array;
	/** One byte per row: 1 where the vehicle started a run at that step. */
	respawned: Uint8Array;
	/** The share of each vehicle that draws at each cached step, from 0 to 1. */
	stepFade: Float32Array;
	/** The meters that each car has driven since its run began. */
	readonly runMeters: Float64Array;
	/** The seconds that each car has stood without moving. */
	readonly held: Float64Array;
	/** The run of each car's list that it is driving. */
	readonly runIndex: Uint8Array;
	/** The random stream that picks where a run begins, so a plan repeats for its seed. */
	readonly rand: () => number;
	/** The body of each vehicle at the last step. */
	readonly curX: Float64Array;
	readonly curZ: Float64Array;
	readonly curFX: Float64Array;
	readonly curFZ: Float64Array;
	/** Scratch for the bodies that this step settles on. */
	readonly nextX: Float64Array;
	readonly nextZ: Float64Array;
	readonly nextFX: Float64Array;
	readonly nextFZ: Float64Array;
	/** Scratch for each vehicle's distance and settled state during a step. */
	readonly sim: Float64Array;
	readonly settled: Uint8Array;
	/** One for each car that must start its next run rather than stand, such as one facing a car. */
	readonly rescued: Uint8Array;
}

/** The motion that each planned vehicle belongs to, and its place in it. */
const MOTIONS = new WeakMap<VehicleActor, { motion: VehicleMotion; index: number }>();

/** The seconds of one step of the headway simulation. */
const MOTION_STEP = 1 / 30;
/** The rows that a new motion starts with. */
const MOTION_ROWS = 4096;

/** A scratch pose and its heading sample for the headway's body checks. */
const MOTION_POSE: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const MOTION_SCRATCH: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/** The distance between two 2-D segments. */
function segmentDistance(
	ax: number,
	az: number,
	bx: number,
	bz: number,
	cx: number,
	cz: number,
	dx: number,
	dz: number,
): number {
	const abx = bx - ax;
	const abz = bz - az;
	const cdx = dx - cx;
	const cdz = dz - cz;
	const acx = cx - ax;
	const acz = cz - az;
	const a = abx * abx + abz * abz;
	const e = cdx * cdx + cdz * cdz;
	const f = cdx * acx + cdz * acz;
	if (a < 1e-9 && e < 1e-9) return hypot(acx, acz);
	let s = 0;
	let t = 0;
	if (a < 1e-9) {
		t = Math.max(0, Math.min(1, f / e));
	} else {
		const c = abx * acx + abz * acz;
		if (e < 1e-9) {
			s = Math.max(0, Math.min(1, -c / a));
		} else {
			const b = abx * cdx + abz * cdz;
			const denom = a * e - b * b;
			s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Math.max(0, Math.min(1, -c / a));
			} else if (t > 1) {
				t = 1;
				s = Math.max(0, Math.min(1, (b - c) / a));
			}
		}
	}
	return hypot(ax + abx * s - (cx + cdx * t), az + abz * s - (cz + cdz * t));
}

/** Reads a vehicle's body: its middle and its forward direction, at a distance. */
function bodyAt(
	path: Path,
	lateral: number,
	at: number,
	x: Float64Array,
	z: Float64Array,
	fx: Float64Array,
	fz: Float64Array,
	index: number,
): void {
	poseAlong(path, at, lateral, true, MOTION_POSE, MOTION_SCRATCH);
	x[index] = MOTION_POSE.x;
	z[index] = MOTION_POSE.z;
	fx[index] = Math.sin(MOTION_POSE.yaw);
	fz[index] = Math.cos(MOTION_POSE.yaw);
}

/** Where a car starts a run: a place on the loop clear of every other vehicle's body. */
function runStart(
	motion: VehicleMotion,
	index: number,
	actor: VehicleActor,
	path: Path,
	lateral: number,
	base: number,
): number {
	const count = motion.actors.length;
	const span = path.length / RUN_STARTS;
	const turn = Math.floor(motion.rand() * RUN_STARTS);
	for (let pick = 0; pick < RUN_STARTS; pick++) {
		const at = (base + ((turn + pick) % RUN_STARTS) * span) % path.length;
		bodyAt(path, lateral, at, motion.nextX, motion.nextZ, motion.nextFX, motion.nextFZ, index);
		let clear = true;
		for (let j = 0; j < count && clear; j++) {
			if (j === index) continue;
			const other = motion.actors[j] as VehicleActor;
			const ox = motion.settled[j] ? (motion.nextX[j] as number) : (motion.curX[j] as number);
			const oz = motion.settled[j] ? (motion.nextZ[j] as number) : (motion.curZ[j] as number);
			const ofx = motion.settled[j] ? (motion.nextFX[j] as number) : (motion.curFX[j] as number);
			const ofz = motion.settled[j] ? (motion.nextFZ[j] as number) : (motion.curFZ[j] as number);
			const reach = actor.halfLength;
			const otherReach = other.halfLength;
			const d = segmentDistance(
				(motion.nextX[index] as number) - (motion.nextFX[index] as number) * reach,
				(motion.nextZ[index] as number) - (motion.nextFZ[index] as number) * reach,
				(motion.nextX[index] as number) + (motion.nextFX[index] as number) * reach,
				(motion.nextZ[index] as number) + (motion.nextFZ[index] as number) * reach,
				ox - ofx * otherReach,
				oz - ofz * otherReach,
				ox + ofx * otherReach,
				oz + ofz * otherReach,
			);
			if (d < actor.halfWidth + other.halfWidth + VEHICLE_GAP) clear = false;
		}
		if (clear) return at;
	}
	return base % path.length;
}

/** The code of a loop in a motion's list, which a step row stores, or adds it. */
function pathCode(motion: VehicleMotion, path: Path): number {
	let code = motion.pathList.indexOf(path);
	if (code < 0) {
		motion.pathList.push(path);
		code = motion.pathList.length - 1;
	}
	return code + 1;
}

/** Makes a motion's rows big enough for the next step. */
function growMotion(motion: VehicleMotion): void {
	const count = motion.actors.length;
	if (motion.steps + 1 <= motion.capacity) return;
	let capacity = motion.capacity;
	while (capacity < motion.steps + 1) capacity *= 2;
	const data = new Float32Array(capacity * count);
	data.set(motion.data);
	motion.data = data;
	const respawned = new Uint8Array(capacity * count);
	respawned.set(motion.respawned);
	motion.respawned = respawned;
	const stepPaths = new Uint16Array(capacity * count);
	stepPaths.set(motion.stepPaths);
	motion.stepPaths = stepPaths;
	const stepLaterals = new Float32Array(capacity * count);
	stepLaterals.set(motion.stepLaterals);
	motion.stepLaterals = stepLaterals;
	const stepFade = new Float32Array(capacity * count);
	stepFade.set(motion.stepFade);
	motion.stepFade = stepFade;
	motion.capacity = capacity;
}

/** Moves every vehicle one step, holding a follower that would come too near a body. */
function stepMotion(motion: VehicleMotion): void {
	const {
		actors,
		order,
		data,
		steps,
		curX,
		curZ,
		curFX,
		curFZ,
		nextX,
		nextZ,
		nextFX,
		nextFZ,
		sim,
		settled,
		rescued,
		paths,
		laterals,
		stepPaths,
		stepLaterals,
		respawned,
		stepFade,
		runMeters,
		runIndex,
		held,
	} = motion;
	const count = actors.length;
	const previous = (steps - 1) * count;
	const row = steps * count;
	const from = (steps - 1) * motion.step;
	const to = steps * motion.step;
	for (let i = 0; i < count; i++) {
		sim[i] = data[previous + i] as number;
		settled[i] = 0;
		stepPaths[row + i] = stepPaths[previous + i] as number;
		stepLaterals[row + i] = stepLaterals[previous + i] as number;
		stepFade[row + i] = stepFade[previous + i] as number;
		rescued[i] = 0;
	}
	for (let k = 0; k < count; k++) {
		const i = order[k] as number;
		const actor = actors[i] as VehicleActor;
		const current = sim[i] as number;
		let speed = actor.speed;
		if (actor.script) {
			const before = sampleScript(actor.script, from, SCRIPT_STATE).distance;
			const after = sampleScript(actor.script, to, SCRIPT_STATE).distance;
			let delta = after - before;
			if (delta < 0) delta += actor.route.length;
			speed = Math.max(0, Math.min(actor.speed, delta / motion.step));
		}
		const proposed = current + speed * motion.step;
		bodyAt(
			paths[i] ?? actor.route,
			laterals[i] as number,
			proposed,
			nextX,
			nextZ,
			nextFX,
			nextFZ,
			i,
		);
		let clear = true;
		for (let j = 0; j < count && clear; j++) {
			if (j === i) continue;
			const other = actors[j] as VehicleActor;
			const ox = settled[j] ? (nextX[j] as number) : (curX[j] as number);
			const oz = settled[j] ? (nextZ[j] as number) : (curZ[j] as number);
			const ofx = settled[j] ? (nextFX[j] as number) : (curFX[j] as number);
			const ofz = settled[j] ? (nextFZ[j] as number) : (curFZ[j] as number);
			const reach = actor.halfLength;
			const otherReach = other.halfLength;
			const d = segmentDistance(
				(nextX[i] as number) - (nextFX[i] as number) * reach,
				(nextZ[i] as number) - (nextFZ[i] as number) * reach,
				(nextX[i] as number) + (nextFX[i] as number) * reach,
				(nextZ[i] as number) + (nextFZ[i] as number) * reach,
				ox - ofx * otherReach,
				oz - ofz * otherReach,
				ox + ofx * otherReach,
				oz + ofz * otherReach,
			);
			if (d < actor.halfWidth + other.halfWidth + VEHICLE_GAP) {
				clear = false;
				// Two cars that face each other can never pass, so the one that moved last starts
				// its next run instead of standing nose to nose.
				const facing = (nextFX[i] as number) * ofx + (nextFZ[i] as number) * ofz;
				if (facing < -0.5) rescued[i] = 1;
			}
		}
		if (clear) {
			sim[i] = proposed;
		} else {
			sim[i] = current;
			nextX[i] = curX[i] as number;
			nextZ[i] = curZ[i] as number;
			nextFX[i] = curFX[i] as number;
			nextFZ[i] = curFZ[i] as number;
		}
		settled[i] = 1;
	}
	// Each car's run ends after the distance that the plan gave it. The fade follows that distance,
	// so a car held in a queue keeps its fade and never vanishes while it stands.
	for (let i = 0; i < count; i++) {
		const actor = actors[i] as VehicleActor;
		const runs = actor.runs;
		if (!runs || runs.length === 0) continue;
		let run = runs[runIndex[i] as number] as VehicleRun;
		const stepMoved = (sim[i] as number) - (data[previous + i] as number);
		held[i] = stepMoved <= 1e-6 ? (held[i] as number) + motion.step : 0;
		if (rescued[i] === 1 || (held[i] as number) >= HELD_ESCAPE) {
			// The car leaves at once, without a fade, because it is standing in a head-on knot.
			runIndex[i] = ((runIndex[i] as number) + 1) % runs.length;
			run = runs[runIndex[i] as number] as VehicleRun;
			const path = run.route;
			paths[i] = path;
			laterals[i] = run.lateral;
			stepPaths[row + i] = pathCode(motion, path);
			stepLaterals[row + i] = run.lateral;
			const at = runStart(motion, i, actor, path, run.lateral, run.from);
			sim[i] = at;
			runMeters[i] = 0;
			stepFade[row + i] = 0;
			respawned[row + i] = 1;
			bodyAt(path, run.lateral, at, nextX, nextZ, nextFX, nextFZ, i);
			continue;
		}
		const moved = (sim[i] as number) - (data[previous + i] as number);
		if (moved > 1e-6) runMeters[i] = (runMeters[i] as number) + moved;
		const travelled = runMeters[i] as number;
		// A run's last meters fade the car out, and its first meters fade it back in.
		let fade = Math.min(
			1,
			travelled / RUN_FADE_METERS,
			(run.distance - travelled) / RUN_FADE_METERS,
		);
		fade = Math.max(0, fade);
		if (moved <= 1e-6) stepFade[row + i] = stepFade[previous + i] as number;
		else stepFade[row + i] = fade;
		if (travelled < run.distance - 1e-6 || moved <= 1e-6) continue;
		// The car starts its next run somewhere else on another loop, clear of every body.
		runIndex[i] = ((runIndex[i] as number) + 1) % runs.length;
		run = runs[runIndex[i] as number] as VehicleRun;
		const path = run.route;
		paths[i] = path;
		laterals[i] = run.lateral;
		stepPaths[row + i] = pathCode(motion, path);
		stepLaterals[row + i] = run.lateral;
		const at = runStart(motion, i, actor, path, run.lateral, run.from);
		sim[i] = at;
		runMeters[i] = 0;
		stepFade[row + i] = 0;
		respawned[row + i] = 1;
		bodyAt(path, run.lateral, at, nextX, nextZ, nextFX, nextFZ, i);
	}
	for (let i = 0; i < count; i++) {
		data[row + i] = sim[i] as number;
		curX[i] = nextX[i] as number;
		curZ[i] = nextZ[i] as number;
		curFX[i] = nextFX[i] as number;
		curFZ[i] = nextFZ[i] as number;
	}
	motion.steps++;
}

/** Builds the headway motion of a plan's vehicles and lets `vehicleAt` read it. */
function createMotion(actors: readonly VehicleActor[], seed: number): VehicleMotion {
	const count = actors.length;
	const data = new Float32Array(MOTION_ROWS * count);
	for (let i = 0; i < count; i++) data[i] = (actors[i] as VehicleActor).phase;
	const motion: VehicleMotion = {
		actors,
		order: actors
			.map((actor, index) => ({ index, priority: actor.kind === 'bus' ? -1 : index }))
			.sort((a, b) => a.priority - b.priority)
			.map((entry) => entry.index),
		step: MOTION_STEP,
		data,
		steps: 1,
		capacity: MOTION_ROWS,
		paths: new Array<Path | undefined>(count).fill(undefined),
		laterals: Float64Array.from(actors, (actor) => actor.lateral),
		pathList: [],
		stepPaths: new Uint16Array(MOTION_ROWS * count),
		stepLaterals: Float32Array.from(
			{ length: MOTION_ROWS * count },
			(_, k) => (actors[k % count] as VehicleActor).lateral,
		),
		respawned: new Uint8Array(MOTION_ROWS * count),
		stepFade: Float32Array.from({ length: MOTION_ROWS * count }, (_, k) =>
			(actors[k % count] as VehicleActor).runs ? 0 : 1,
		),
		runMeters: new Float64Array(count),
		runIndex: new Uint8Array(count),
		held: new Float64Array(count),
		rand: random(seed),
		curX: new Float64Array(count),
		curZ: new Float64Array(count),
		curFX: new Float64Array(count),
		curFZ: new Float64Array(count),
		nextX: new Float64Array(count),
		nextZ: new Float64Array(count),
		nextFX: new Float64Array(count),
		nextFZ: new Float64Array(count),
		sim: new Float64Array(count),
		settled: new Uint8Array(count),
		rescued: new Uint8Array(count),
	};
	actors.forEach((actor, index) => {
		MOTIONS.set(actor, { motion, index });
		bodyAt(
			actor.route,
			actor.lateral,
			actor.phase,
			motion.curX,
			motion.curZ,
			motion.curFX,
			motion.curFZ,
			index,
		);
	});
	return motion;
}

/** Caches the motion up to a time. */
function advanceMotion(motion: VehicleMotion, seconds: number): void {
	const need = Math.max(1, Math.ceil(Math.max(0, seconds) / motion.step) + 1);
	while (motion.steps < need) {
		growMotion(motion);
		stepMotion(motion);
	}
}

/** A vehicle's place on its loop at a time: its distance, its loop and its side of it. */
const LANE = { distance: 0, path: undefined as Path | undefined, lateral: 0 };

/** Reads a vehicle's distance and loop at a time. */
function laneOf(actor: VehicleActor, seconds: number): typeof LANE {
	const bound = MOTIONS.get(actor);
	if (bound) {
		const { motion, index } = bound;
		advanceMotion(motion, seconds);
		const x = Math.max(0, seconds) / motion.step;
		const i0 = Math.min(motion.steps - 1, Math.floor(x));
		const i1 = Math.min(motion.steps - 1, i0 + 1);
		const f = Math.max(0, Math.min(1, x - i0));
		const count = motion.actors.length;
		const a = motion.data[i0 * count + index] as number;
		// A run's first step moves the car to another loop: keep the old place until it lands.
		const respawn = i1 > i0 && motion.respawned[i1 * count + index] === 1;
		const b = motion.data[i1 * count + index] as number;
		// A run's first step lands the car at once: read that step's place and loop, not a mix.
		LANE.distance = respawn ? b : a + (b - a) * f;
		const at = (respawn ? i1 : i0) * count + index;
		const code = motion.stepPaths[at] as number;
		LANE.path = code === 0 ? actor.route : (motion.pathList[code - 1] as Path);
		LANE.lateral = motion.stepLaterals[at] as number;
		return LANE;
	}
	LANE.path = actor.route;
	LANE.lateral = actor.lateral;
	LANE.distance = actor.script
		? sampleScript(actor.script, seconds, SCRIPT_STATE).distance
		: actor.phase + actor.speed * seconds;
	return LANE;
}

/** The distance that a vehicle has travelled at a time, along its own route. */
function travelledOf(actor: VehicleActor, seconds: number): number {
	return laneOf(actor, seconds).distance;
}

/**
 * The distance that a vehicle has travelled at a time, in meters. A wheel turns by it over the
 * wheel's radius.
 */
export function vehicleDistanceAt(actor: VehicleActor, seconds: number): number {
	return travelledOf(actor, Math.max(0, seconds));
}

/**
 * Where a vehicle is at a time. Its plan's motion moves every vehicle with a minimum headway, and
 * a bus waits at its stops. The result is written to `out`, or to a shared pose when it is left out.
 */
export function vehicleAt(actor: VehicleActor, seconds: number, out: Pose = SHARED_POSE): Pose {
	const lane = laneOf(actor, seconds);
	poseAlong(lane.path ?? actor.route, lane.distance, lane.lateral, true, out, SHARED_SCRATCH);
	out.y += ROAD_SURFACE;
	return out;
}

/**
 * How much of a vehicle draws at a time, from 0 out of sight to 1 fully in view. A car fades out
 * at the end of a run and fades back in where its next run begins; a vehicle without runs is
 * always in view.
 */
export function vehicleFadeAt(actor: VehicleActor, seconds: number): number {
	const bound = MOTIONS.get(actor);
	if (!bound) return 1;
	const { motion, index } = bound;
	advanceMotion(motion, seconds);
	const x = Math.max(0, seconds) / motion.step;
	const i0 = Math.min(motion.steps - 1, Math.floor(x));
	const i1 = Math.min(motion.steps - 1, i0 + 1);
	const f = Math.max(0, Math.min(1, x - i0));
	const count = motion.actors.length;
	// The fade belongs to the step, so a car's fade holds while the car stands.
	if (i1 > i0 && motion.respawned[i1 * count + index] === 1)
		return motion.stepFade[i1 * count + index] as number;
	const a = motion.stepFade[i0 * count + index] as number;
	const b = motion.stepFade[i1 * count + index] as number;
	return a + (b - a) * f;
}

/** Where a person is at a time, and how far it has faded into sight. */
export interface PersonState extends Pose {
	hidden: boolean;
	/** The share of the person that draws, from 0 out of sight to 1 fully in view. */
	fade: number;
}

/** The shared person state. */
const SHARED_PERSON: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };

/** The trip of an itinerary at a local time, and the seconds from that trip's start. */
const TRIP = { trip: undefined as PersonTrip | undefined, index: 0, elapsed: 0 };

/** Reads the trip of an itinerary at a time, which lies between zero and the cycle. */
function tripAt(
	actor: PersonActor,
	local: number,
): {
	trip: PersonTrip;
	index: number;
	elapsed: number;
} {
	const trips = actor.trips;
	let lo = 0;
	let hi = trips.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if ((trips[mid] as PersonTrip).start <= local) lo = mid;
		else hi = mid - 1;
	}
	const trip = trips[lo] as PersonTrip;
	TRIP.trip = trip;
	TRIP.index = lo;
	TRIP.elapsed = local - trip.start;
	return TRIP as { trip: PersonTrip; index: number; elapsed: number };
}

/**
 * Where a person is at a time. The result is written to `out`, or to a shared state when it is
 * left out. A person walks one trip of its itinerary, fades from sight at the end of it, and
 * returns to sight at the start of the next, somewhere else on the island.
 */
export function personAt(
	actor: PersonActor,
	seconds: number,
	out: PersonState = SHARED_PERSON,
): PersonState {
	const clock = seconds + actor.phase;
	let local = actor.cycle > 1e-9 ? clock % actor.cycle : 0;
	if (local < 0) local += actor.cycle;
	const { trip, elapsed } = tripAt(actor, local);
	const state = sampleScript(trip.script, elapsed, SCRIPT_STATE);
	poseAlong(trip.walk, state.distance, actor.lateral, false, out, SHARED_SCRATCH);
	if (!state.forward) out.yaw += Math.PI;
	out.fade = fadeOf(trip.script, elapsed, state.hidden);
	out.hidden = out.fade <= 0;
	return out;
}

/**
 * The share of a person that draws at a time of its script. A person is drawn whole while it walks
 * and is gone at once when the script takes it out of sight: no shrinking, so no part can come apart.
 */
function fadeOf(_script: Script, _local: number, hidden: boolean): number {
	return hidden ? 0 : 1;
}

/** The rise, roll and surge of a person's stride at a time. */
export interface PersonStride {
	/** The height above the ground, in meters, which never goes below zero. */
	bob: number;
	/** The roll about the heading, in radians. */
	roll: number;
	/** The surge along the heading, in meters. */
	sway: number;
}

/** The shared stride, for a caller that reads one person at a time. */
const SHARED_STRIDE: PersonStride = { bob: 0, roll: 0, sway: 0 };

/**
 * The stride of a person at a time, written to `out`, or undefined while the person stands still.
 * The clock reads the time and phase of `personAt`, and it advances only over the walking legs, so
 * the step rate follows the walking speed and the stride rests while the person waits. The rise is
 * a lifted cosine, so a footfall meets the ground and a mid-stride is the highest point. The
 * amplitude fades at each end of a walking leg, so a stride starts and stops without a jolt.
 */
export function personStrideAt(
	actor: PersonActor,
	seconds: number,
	out: PersonStride = SHARED_STRIDE,
): PersonStride | undefined {
	out.bob = 0;
	out.roll = 0;
	out.sway = 0;
	if (actor.cycle <= 1e-9 || actor.trips.length === 0) return undefined;
	const clock = seconds + actor.phase;
	let local = clock % actor.cycle;
	if (local < 0) local += actor.cycle;
	const trip = tripAt(actor, local);
	const script = trip.trip.script;
	const { leg, index, elapsed } = legAt(script, trip.elapsed, LEG_STATE);
	if (leg.to === leg.from) return undefined;
	let walked = elapsed;
	for (let k = 0; k < index; k++) {
		const each = script.legs[k] as Leg;
		if (each.to !== each.from) walked += each.seconds;
	}
	const phase = (2 * Math.PI * actor.speed * walked) / STRIDE_LENGTH;
	const ease = Math.min(1, elapsed / STRIDE_EASE, (leg.seconds - elapsed) / STRIDE_EASE);
	const swing = Math.max(0, ease);
	out.bob = STRIDE_BOB * 0.5 * (1 - Math.cos(2 * phase)) * swing;
	out.roll = STRIDE_ROLL * Math.sin(phase) * swing;
	out.sway = STRIDE_SWAY * Math.sin(2 * phase) * swing;
	return out;
}

/** A house's footprint, as a rectangle turned by its lot's yaw. */
interface HouseRect {
	x: number;
	z: number;
	yaw: number;
	hw: number;
	hd: number;
}

/** The side of a cell of the house grid, in meters. */
const HOUSE_CELL = 20;
/** The house footprints, each in every cell it may reach into. */
const HOUSE_GRID = (() => {
	const grid = new Map<string, HouseRect[]>();
	for (const lot of LOTS) {
		const half = (HOUSE_KINDS[lot.kind] as { half: readonly [number, number] }).half;
		const house = { x: lot.x, z: lot.z, yaw: lot.yaw, hw: half[0], hd: half[1] };
		const reach = Math.ceil((Math.max(house.hw, house.hd) + HOUSE_CLEAR) / HOUSE_CELL);
		const [ci, cj] = [Math.floor(lot.x / HOUSE_CELL), Math.floor(lot.z / HOUSE_CELL)];
		for (let i = ci - reach; i <= ci + reach; i++)
			for (let j = cj - reach; j <= cj + reach; j++) {
				const key = `${i},${j}`;
				const list = grid.get(key);
				if (list) list.push(house);
				else grid.set(key, [house]);
			}
	}
	return grid;
})();

/**
 * Whether a place lies within a house's rectangle, widened by a margin. The rectangle is read both
 * as the lot's turn draws it and in the turn's mirror, which keeps every walk clear of a house on
 * either reading.
 */
function insideHouse(house: HouseRect, x: number, z: number, margin: number): boolean {
	const [c, s] = [Math.cos(house.yaw), Math.sin(house.yaw)];
	const dx = x - house.x;
	const dz = z - house.z;
	// The drawn frame: the house's front looks along the lot's turn, so its depth lies on that axis.
	const along = dx * s + dz * c;
	const across = dx * c - dz * s;
	if (Math.abs(across) < house.hw + margin && Math.abs(along) < house.hd + margin) return true;
	// The same lot read the other way round, so a walk keeps the wider of the two footprints.
	return (
		Math.abs(dx * c + dz * s) < house.hw + margin && Math.abs(-dx * s + dz * c) < house.hd + margin
	);
}

/** Whether a place stands clear of every house beside it, by a margin. */
function housesClear(x: number, z: number, margin = HOUSE_CLEAR): boolean {
	for (const house of HOUSE_GRID.get(
		`${Math.floor(x / HOUSE_CELL)},${Math.floor(z / HOUSE_CELL)}`,
	) ?? [])
		if (insideHouse(house, x, z, margin)) return false;
	return true;
}

/** The radius of a circle standing for a body that a walk must keep out of, in meters. */
interface Body {
	x: number;
	z: number;
	r: number;
}

/** A stretch of a body, such as a wall or a stair, that a walk must keep out of. */
interface BodyRun {
	ax: number;
	az: number;
	bx: number;
	bz: number;
	half: number;
}

/** The radius of each tree kind's trunk at its foot, before the spot's own scale, in meters. */
const TRUNK_RADIUS = [0.3, 0.36, 0.39, 0.5] as const;
/** The radius of the clump that a shrub's stems rise from, before the spot's own scale, in meters. */
const SHRUB_FOOT = 0.25;
/** The radius of a parasol's pole, and of the circle that stands for a lounger, in meters. */
const PARASOL_POLE = 0.05;
const LOUNGER_FOOT = 1;
/** The half thickness of a terrace's dry stone wall, and the half width of a stone stair, in meters. */
const TERRACE_HALF = 0.26;
const STAIR_HALF = 0.8;
/** The margin that a walk keeps from a standing object's body, in meters. */
const BODY_CLEAR = 0.1;
/** How wide a clear strip the way down to the sand needs for the people who spread across it, in meters. */
const BEACH_ROOM = PERSON_RADIUS + 1.05 + BODY_CLEAR;
/** The side of a cell of the static bodies' grid, in meters. */
const BODY_CELL = 8;

/** The trunks, shrubs, poles and loungers of the island, by a coarse grid. */
const BODY_GRID = (() => {
	const grid = new Map<string, Body[]>();
	const add = (body: Body): void => {
		const reach = Math.ceil(body.r / BODY_CELL);
		const [ci, cj] = [Math.floor(body.x / BODY_CELL), Math.floor(body.z / BODY_CELL)];
		for (let i = ci - reach; i <= ci + reach; i++)
			for (let j = cj - reach; j <= cj + reach; j++) {
				const key = `${i},${j}`;
				const list = grid.get(key);
				if (list) list.push(body);
				else grid.set(key, [body]);
			}
	};
	for (const spot of [...TREE_SPOTS, ...FILL_SPOTS])
		add({ x: spot.x, z: spot.z, r: (TRUNK_RADIUS[spot.kind] ?? 0.5) * spot.scale });
	for (const spot of SHRUBS) add({ x: spot.x, z: spot.z, r: SHRUB_FOOT * spot.scale });
	const parasols = parasolSpots();
	for (const spot of parasols) add({ x: spot.x, z: spot.z, r: PARASOL_POLE });
	for (const spot of parasols)
		for (const offset of LOUNGER_OFFSETS) {
			const [c, s] = [Math.cos(spot.yaw), Math.sin(spot.yaw)];
			add({
				x: spot.x + offset.x * c + offset.z * s,
				z: spot.z - offset.x * s + offset.z * c,
				r: LOUNGER_FOOT,
			});
		}
	return grid;
})();

/** The walls and stairs of the island, by a coarse grid. */
const RUN_GRID = (() => {
	const grid = new Map<string, BodyRun[]>();
	const add = (run: BodyRun): void => {
		const steps = Math.ceil(hypot(run.bx - run.ax, run.bz - run.az) / BODY_CELL);
		for (let k = 0; k <= steps; k++) {
			const t = steps === 0 ? 0 : k / steps;
			const x = run.ax + (run.bx - run.ax) * t;
			const z = run.az + (run.bz - run.az) * t;
			for (let i = -1; i <= 1; i++)
				for (let j = -1; j <= 1; j++) {
					const key = `${Math.floor(x / BODY_CELL) + i},${Math.floor(z / BODY_CELL) + j}`;
					const list = grid.get(key);
					if (!list) grid.set(key, [run]);
					else if (!list.includes(run)) list.push(run);
				}
		}
	};
	for (const wall of TERRACES)
		add({ ax: wall.ax, az: wall.az, bx: wall.bx, bz: wall.bz, half: TERRACE_HALF });
	for (const stair of STAIRS)
		for (let k = 0; k + 1 < stair.length; k++) {
			const a = stair[k] as { x: number; z: number };
			const b = stair[k + 1] as { x: number; z: number };
			add({ ax: a.x, az: a.z, bx: b.x, bz: b.z, half: STAIR_HALF });
		}
	return grid;
})();

/** How far a place lies from a body run's own edge, in meters; below zero inside it. */
function runGap(run: BodyRun, x: number, z: number): number {
	const dx = run.bx - run.ax;
	const dz = run.bz - run.az;
	const length2 = dx * dx + dz * dz || 1;
	const t = Math.max(0, Math.min(1, ((x - run.ax) * dx + (z - run.az) * dz) / length2));
	return hypot(x - (run.ax + dx * t), z - (run.az + dz * t)) - run.half;
}

/**
 * The least gap from a place to the island's standing objects: a tree's trunk, a shrub's stems, a
 * terrace's wall, a stair, a parasol's pole or a lounger. Below zero means the place is inside one.
 */
export function staticGap(x: number, z: number): number {
	const key = `${Math.floor(x / BODY_CELL)},${Math.floor(z / BODY_CELL)}`;
	let least = Number.POSITIVE_INFINITY;
	for (const body of BODY_GRID.get(key) ?? []) {
		const gap = hypot(x - body.x, z - body.z) - body.r;
		if (gap < least) least = gap;
	}
	for (const run of RUN_GRID.get(key) ?? []) {
		const gap = runGap(run, x, z);
		if (gap < least) least = gap;
	}
	return least;
}

/** The least gap that two people's walk lines keep, so neither can meet the other. */
const LINE_CLEAR = PERSON_CLEAR + 0.05;
/** The side of a cell of the walk lines' grid, in meters. */
const LINE_CELL = 2;

/** The places of a walk, half a meter apart. */
function walkPlaces(path: Path): Point[] {
	const places: Point[] = [];
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	for (let at = 0; at <= path.length; at += 0.5) {
		pathAt(path, at, pose);
		places.push({ x: pose.x, y: pose.y, z: pose.z });
	}
	return places;
}

/** True when a walk comes within a body's width of a line already in the grid. */
function lineNear(grid: Map<string, Point[]>, path: Path): boolean {
	for (const place of walkPlaces(path)) {
		const ci = Math.floor(place.x / LINE_CELL);
		const cj = Math.floor(place.z / LINE_CELL);
		for (let i = ci - 1; i <= ci + 1; i++)
			for (let j = cj - 1; j <= cj + 1; j++)
				for (const other of grid.get(`${i},${j}`) ?? [])
					if (hypot(place.x - other.x, place.z - other.z) < LINE_CLEAR) return true;
	}
	return false;
}

/** Adds a walk's places to the grid. */
function addLine(grid: Map<string, Point[]>, path: Path): void {
	for (const place of walkPlaces(path)) {
		const key = `${Math.floor(place.x / LINE_CELL)},${Math.floor(place.z / LINE_CELL)}`;
		const list = grid.get(key);
		if (list) list.push(place);
		else grid.set(key, [place]);
	}
}

/** True when two walks run the same line: they start together and have one length. */
function sameWalk(a: Path, b: Path): boolean {
	if (Math.abs(a.length - b.length) > 0.05) return false;
	return (
		hypot(
			(a.xyz[0] as number) - (b.xyz[0] as number),
			(a.xyz[2] as number) - (b.xyz[2] as number),
		) < 0.05
	);
}

/**
 * Cuts a walk back to the longest stretch whose places the caller accepts, which leaves them clear
 * of the houses and of the motors' paths. With `keepStart`, the stretch runs from the walk's start,
 * which is a door threshold.
 */
function trimWalk(path: Path, clear: (x: number, z: number) => boolean, keepStart: boolean): Path {
	const step = 0.1;
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const count = Math.floor(path.length / step) + 1;
	const usable: boolean[] = [];
	for (let k = 0; k < count; k++) {
		pathAt(path, Math.min(path.length, k * step), pose);
		usable.push(clear(pose.x, pose.z));
	}
	let bestStart = 0;
	let bestEnd = 0;
	let start = -1;
	for (let k = 0; k <= count; k++) {
		if (k < count && usable[k]) {
			if (start < 0) start = k;
		} else if (start >= 0) {
			if (k - start > bestEnd - bestStart) {
				bestStart = start;
				bestEnd = k;
			}
			start = -1;
		}
	}
	if (keepStart && usable[0]) {
		let end = 0;
		while (end < count && usable[end]) end++;
		bestStart = 0;
		bestEnd = end;
	}
	const from = Math.min(path.length, bestStart * step);
	const to = Math.min(path.length, bestEnd * step);
	return slicePath(path, from, to);
}

/** The point of a path at a distance, as a plain point. */
function pointAtPath(path: Path, at: number): Point {
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	pathAt(path, at, pose);
	return { x: pose.x, y: pose.y, z: pose.z };
}

/** Keeps the stretch of a path between two distances, preserving the points between. */
function slicePath(path: Path, from: number, to: number): Path {
	const start = Math.max(0, Math.min(path.length - 0.01, from));
	const end = Math.max(start + 0.01, Math.min(path.length, to));
	const points: Point[] = [];
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	pathAt(path, start, pose);
	points.push({ x: pose.x, y: pose.y, z: pose.z });
	for (let k = 0; k < path.distance.length; k++) {
		const at = path.distance[k] as number;
		if (at <= start + 1e-6 || at >= end - 1e-6) continue;
		points.push({
			x: path.xyz[k * 3] as number,
			y: path.xyz[k * 3 + 1] as number,
			z: path.xyz[k * 3 + 2] as number,
		});
	}
	pathAt(path, end, pose);
	points.push({ x: pose.x, y: pose.y, z: pose.z });
	return makePath(points);
}

/** Moves a walk to one side of its own line, as a person stands across the pavement. */
function offsetPathWalk(path: Path, lateral: number): Path {
	if (lateral === 0) return path;
	const step = 0.1;
	const points: Point[] = [];
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	for (let at = 0; at <= path.length; at += step) {
		pathAt(path, at, pose);
		const nx = Math.cos(pose.yaw);
		const nz = -Math.sin(pose.yaw);
		points.push({ x: pose.x + nx * lateral, y: pose.y, z: pose.z + nz * lateral });
	}
	return makePath(points);
}

/** The window and step over which a plan keeps two people apart, in seconds. */
const SEPARATION_WINDOW = 600;
const SEPARATION_STEP = 0.5;

/** Samples a person's visible places over the separation window. */
function visibleTrack(actor: PersonActor): Float32Array {
	const count = Math.floor(SEPARATION_WINDOW / SEPARATION_STEP) + 1;
	const out = new Float32Array(count * 2);
	const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
	for (let k = 0; k < count; k++) {
		personAt(actor, k * SEPARATION_STEP, state);
		out[k * 2] = state.hidden ? Number.NaN : state.x;
		out[k * 2 + 1] = state.hidden ? Number.NaN : state.z;
	}
	return out;
}

/**
 * Turns a person's phase until no other visible person comes within a body's width of them over
 * the window. Two people on one walk still differ by their side, and a phase shift parts the rest.
 */
function separatePeople(people: PersonActor[]): void {
	const tracks = people.map(visibleTrack);
	let budget = 256;
	for (let pass = 0; pass < 12 && budget > 0; pass++) {
		let changed = false;
		for (let a = 0; a < people.length && budget > 0; a++) {
			for (let b = a + 1; b < people.length && budget > 0; b++) {
				const ta = tracks[a] as Float32Array;
				const tb = tracks[b] as Float32Array;
				let near = false;
				for (let k = 0; k < ta.length; k += 2) {
					const ax = ta[k] as number;
					const az = ta[k + 1] as number;
					const bx = tb[k] as number;
					const bz = tb[k + 1] as number;
					if (Number.isNaN(ax) || Number.isNaN(bx)) continue;
					if (hypot(ax - bx, az - bz) < PERSON_CLEAR) {
						near = true;
						break;
					}
				}
				if (!near) continue;
				const person = people[b] as PersonActor;
				const shift = person.cycle * (0.31 + pass * 0.09);
				people[b] = { ...person, phase: (person.phase + shift) % person.cycle };
				tracks[b] = visibleTrack(people[b] as PersonActor);
				changed = true;
				budget--;
			}
		}
		if (!changed) break;
	}
}

/** A house's walk to a road's destination, and the side of the road its door lies on. */
function houseRoute(road: Road, lot: Lot, destination: number): { path: Path; side: number } {
	const cumulative = arcsOf(road);
	const gate = projectOnRoad(road, lot.gate.x, lot.gate.z).at;
	const door = doorOf(lot);
	const side = sideToward(road, cumulative, gate, door.x, door.z);
	// A walk that runs back along the road turns the line's own normal, so the side turns with it.
	const facing = destination >= gate ? 1 : -1;
	const pavement = offsetLine(
		roadSlice(road, cumulative, gate, destination),
		road.half + PAVEMENT,
		side * facing,
	);
	// The person stands a step outside the door, on the threshold, before the walk begins.
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	const start = {
		x: door.x + s * DOOR_STEP,
		y: lot.y,
		z: door.z + c * DOOR_STEP,
	};
	return { path: makePath([start, ...pavement]), side };
}

/**
 * Lifts a road-derived walk to the height of the pavement that the town draws there. The path's
 * own distances stay as they were, so lifting a walk changes no length, no clearance and no phase;
 * a walk that starts at a door keeps its threshold on the lot's own ground.
 */
function liftWalk(walk: Path, fromDoor: boolean): Path {
	const xyz = walk.xyz.slice();
	for (let k = 0; k < xyz.length; k += 3) {
		if (fromDoor && k === 0) continue;
		xyz[k + 1] = (xyz[k + 1] as number) + PAVEMENT_LIFT;
	}
	return { xyz, distance: walk.distance, length: walk.length };
}

/** Builds a walk along one side of a road between two arc distances. */
function pavementWalk(road: Road, from: number, to: number, side: number): Path {
	const cumulative = arcsOf(road);
	const facing = to >= from ? 1 : -1;
	return makePath(
		offsetLine(roadSlice(road, cumulative, from, to), road.half + PAVEMENT, side * facing),
	);
}

/** A footpath that leaves a road and climbs to the bay's dry sand. */
function beachWalk(): Path {
	// The road's nearest point to the bay's dry sand, and the sand point itself.
	let access = {
		road: 0,
		at: 0,
		x: 0,
		y: 0,
		z: 0,
		sandX: 0,
		sandZ: 0,
		d: Number.POSITIVE_INFINITY,
	};
	/** Whether the strip that the walkers take to the sand lies clear of the standing objects. */
	const clear = (startX: number, startZ: number, endX: number, endZ: number): boolean => {
		const reach = Math.max(1, Math.ceil(hypot(endX - startX, endZ - startZ)));
		for (let k = 0; k <= reach; k++) {
			const t = k / reach;
			if (staticGap(startX + (endX - startX) * t, startZ + (endZ - startZ) * t) < BEACH_ROOM)
				return false;
		}
		return true;
	};
	for (let pass = 0; pass < 240; pass++) {
		const angle = BAY.from + BAY.sweep * (pass / 240);
		const radius = BAY.radius + 12;
		const sx = BAY.x + Math.cos(angle) * radius;
		const sz = BAY.z + Math.sin(angle) * radius;
		if (sandAt(sx, sz) < 0.4 || groundHeight(sx, sz) < SEA_LEVEL + 1) continue;
		for (let ri = 0; ri < ROADS.length; ri++) {
			const road = ROADS[ri] as Road;
			const found = projectOnRoad(road, sx, sz);
			if (found.d >= access.d) continue;
			// A club of parasols on the sand turns the walkers to the next clear way down.
			const inward = Math.min(road.half + PAVEMENT, found.d);
			const length = found.d || 1;
			const nx = (sx - found.x) / length;
			const nz = (sz - found.z) / length;
			if (!clear(found.x + nx * inward, found.z + nz * inward, sx, sz)) continue;
			access = {
				road: ri,
				at: found.at,
				x: found.x,
				y: found.y,
				z: found.z,
				sandX: sx,
				sandZ: sz,
				d: found.d,
			};
		}
	}
	// With no clear way down, the nearest one still serves the beach.
	if (!Number.isFinite(access.d)) {
		for (let pass = 0; pass < 240; pass++) {
			const angle = BAY.from + BAY.sweep * (pass / 240);
			const radius = BAY.radius + 12;
			const sx = BAY.x + Math.cos(angle) * radius;
			const sz = BAY.z + Math.sin(angle) * radius;
			if (sandAt(sx, sz) < 0.4 || groundHeight(sx, sz) < SEA_LEVEL + 1) continue;
			for (let ri = 0; ri < ROADS.length; ri++) {
				const found = projectOnRoad(ROADS[ri] as Road, sx, sz);
				if (found.d < access.d)
					access = {
						road: ri,
						at: found.at,
						x: found.x,
						y: found.y,
						z: found.z,
						sandX: sx,
						sandZ: sz,
						d: found.d,
					};
			}
		}
	}
	const road = ROADS[access.road] as Road;
	const cumulative = arcsOf(road);
	const start = pointAt(road, cumulative, access.at);
	const length = access.d || 1;
	const nx = (access.sandX - start.x) / length;
	const nz = (access.sandZ - start.z) / length;
	const points: Point[] = [];
	const steps = 6;
	const from = Math.min(road.half + PAVEMENT, access.d);
	for (let k = 0; k <= steps; k++) {
		const t = k / steps;
		const reach = from + (access.d - from) * t;
		const x = start.x + nx * reach;
		const z = start.z + nz * reach;
		points.push({ x, y: groundHeight(x, z), z });
	}
	return makePath(points);
}

/** The lots of one road whose gates lie between two arc distances, far end first. */
function lotsOn(road: Road, low: number, high: number): Lot[] {
	const min = Math.min(low, high);
	const max = Math.max(low, high);
	const entries: { lot: Lot; at: number }[] = [];
	for (const lot of LOTS) {
		if (lot.road !== road) continue;
		const at = projectOnRoad(road, lot.gate.x, lot.gate.z).at;
		if (at >= min && at <= max) entries.push({ lot, at });
	}
	entries.sort((a, b) => b.at - a.at);
	return entries.map((entry) => entry.lot);
}

/** A car that stands at a road's edge, beside a place on the road. */
function parkedBeside(road: Road, at: number, side: number): ParkedCar {
	const cumulative = arcsOf(road);
	const point = pointAt(road, cumulative, at);
	const [tx, tz] = tangentAt(road, cumulative, at);
	const offset = road.half + PARKED_KERB;
	return {
		x: point.x + tz * side * offset,
		y: point.y + ROAD_SURFACE,
		z: point.z - tx * side * offset,
		yaw: Math.atan2(tx, tz),
	};
}

/** How far a place stands from a parked car's body, in meters; below zero inside it. */
function parkedDistance(car: ParkedCar, x: number, z: number): number {
	const [c, s] = [Math.cos(car.yaw), Math.sin(car.yaw)];
	const dx = x - car.x;
	const dz = z - car.z;
	const along = dx * s + dz * c;
	const across = dx * c - dz * s;
	const du = Math.abs(along) - CAR_HALF_LENGTH;
	const dv = Math.abs(across) - CAR_HALF_WIDTH;
	if (du <= 0 && dv <= 0) return Math.max(du, dv);
	return hypot(Math.max(du, 0), Math.max(dv, 0));
}

/** Whether a parked car stands clear of every walk line, by a person's body. */
function parkedClearOfWalks(car: ParkedCar, walks: readonly Path[]): boolean {
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	for (const walk of walks)
		for (let at = 0; at <= walk.length; at += 0.25) {
			pathAt(walk, at, pose);
			if (parkedDistance(car, pose.x, pose.z) < PERSON_RADIUS + 0.2) return false;
		}
	return true;
}

/** Whether a parked car stands clear of every house, reading its whole outline. */
function parkedClearOfHouses(car: ParkedCar): boolean {
	const [c, s] = [Math.cos(car.yaw), Math.sin(car.yaw)];
	const step = 0.5;
	for (let along = -CAR_HALF_LENGTH; along <= CAR_HALF_LENGTH; along += step)
		for (const across of [-CAR_HALF_WIDTH, CAR_HALF_WIDTH]) {
			const x = car.x + s * along + c * across;
			const z = car.z + c * along - s * across;
			if (!housesClear(x, z, PARKED_HOUSE_CLEAR)) return false;
		}
	for (let across = -CAR_HALF_WIDTH; across <= CAR_HALF_WIDTH; across += step)
		for (const along of [-CAR_HALF_LENGTH, CAR_HALF_LENGTH]) {
			const x = car.x + s * along + c * across;
			const z = car.z + c * along - s * across;
			if (!housesClear(x, z, PARKED_HOUSE_CLEAR)) return false;
		}
	return true;
}

/** One person's walk, and how its ends behave. */
interface WalkDefinition {
	readonly path: Path;
	readonly startHidden: boolean;
	readonly startSeconds: number;
	/** The seconds that the walk's end stands out of sight, before the person moves on. */
	readonly endSeconds: number;
	/** True keeps the walk's start at its door when it is trimmed clear of the traffic. */
	readonly keepStart: boolean;
	/** The meters that the walk's start moves along its line, so that two starts never meet. */
	readonly startShift: number;
	/** The places across the pavement that the people on this walk take, in meters. */
	readonly sides: readonly number[];
	/** The place that the first person on this walk takes. */
	readonly sideSlot: number;
	/** The car that this person gets into at the far end, when the walk ends at one. */
	readonly car?: ParkedCar;
	/** The road and side that a rider's car stands beside, at the walk's far end. */
	readonly road?: Road;
	readonly roadSide?: number;
	/** True for a walk that runs on a drawn pavement, which stands above the stored road line. */
	readonly pavement?: boolean;
	/** True for a walk that starts at a house's door, whose threshold keeps the lot's ground. */
	readonly fromDoor?: boolean;
}

/** Builds the default plan of vehicles and people from the stored roads. */
export function planTraffic(options: TrafficOptions = {}): TrafficPlan {
	const seed = options.seed ?? TRAFFIC_SEED;
	const rand = random(seed);
	const network = buildRoadNetwork(ROADS);
	const cycles = network.cycles;
	const wantsBus = options.bus ?? true;
	const carCount = Math.max(0, Math.floor(options.cars ?? DEFAULT_CARS));
	const parkedCount = Math.max(0, Math.floor(options.parkedCars ?? DEFAULT_PARKED));
	const peopleCount = Math.max(0, Math.floor(options.people ?? DEFAULT_PEOPLE));

	const busCycle = (() => {
		if (!wantsBus) return undefined;
		const capped = cycles.filter(
			(cycle) =>
				cycle.minHalf >= 1.9 && cycle.length >= MIN_BUS_CYCLE && cycle.length <= MAX_BUS_CYCLE,
		);
		const near = capped.filter(
			(cycle) => loopNear(cycle, HARBOUR_FRONT.x, HARBOUR_FRONT.z) <= BUS_HARBOUR_REACH,
		);
		const long = cycles.filter((cycle) => cycle.minHalf >= 1.9 && cycle.length >= MIN_BUS_CYCLE);
		return near[0] ?? capped[0] ?? long[0] ?? cycles[0];
	})();

	const carCycles: Cycle[] = [];
	for (const cycle of cycles) {
		if (cycle === busCycle || cycle.minHalf < 1.75 || cycle.length < MIN_CAR_CYCLE) continue;
		if (overlap(cycle, carCycles) > 0.5) continue;
		carCycles.push(cycle);
		if (carCycles.length >= Math.max(carCount, 1)) break;
	}
	if (carCycles.length === 0) {
		const fallback =
			cycles.find((cycle) => cycle !== busCycle && cycle.minHalf >= 1.75) ?? cycles[0];
		if (fallback) carCycles.push(fallback);
	}

	const vehicles: VehicleActor[] = [];
	const assigned = new Map<Cycle, number>();
	const carsPerCycle = Math.max(1, Math.ceil(carCount / Math.max(1, carCycles.length)));
	/** A cycle of the car set other than the one given, so a run starts on another loop. */
	const otherCycle = (from: Path): Cycle => {
		const others = carCycles.filter((cycle) => cycle.path !== from);
		const pool = others.length > 0 ? others : carCycles;
		return pool[Math.floor(rand() * pool.length)] as Cycle;
	};
	for (let k = 0; k < carCount; k++) {
		const cycle = carCycles[k % carCycles.length] as Cycle;
		const onCycle = assigned.get(cycle) ?? 0;
		assigned.set(cycle, onCycle + 1);
		const lateral = Math.max(0.25, Math.min(0.6, cycle.minHalf * 0.3));
		const speed =
			(CAR_SPEED[0] as number) +
			((k + rand() * 0.6) / carCount) * ((CAR_SPEED[1] as number) - (CAR_SPEED[0] as number));
		const phase = ((onCycle + 0.1 + rand() * 0.6) / carsPerCycle) * cycle.length;
		// The car's cycle of runs: stretches of loops, each starting somewhere else, with a
		// hidden moment between two, so that no car is ever seen standing in the road.
		const runs: VehicleRun[] = [];
		let route = cycle.path;
		let at = phase;
		let lane = lateral;
		for (let run = 0; run < CAR_RUNS; run++) {
			if (run > 0) {
				const next = otherCycle(route);
				route = next.path;
				at = rand() * next.length;
				lane = Math.max(0.25, Math.min(0.6, next.minHalf * 0.3));
			}
			const seconds = RUN_SECONDS[0] + rand() * (RUN_SECONDS[1] - RUN_SECONDS[0]);
			// A run ends after a stretch of driving, not after a time: a car held in a queue keeps
			// its place and never fades while it stands.
			runs.push({ route, lateral: lane, from: at, distance: speed * seconds });
		}
		vehicles.push({
			kind: 'car',
			route: cycle.path,
			speed,
			phase,
			lateral,
			halfLength: CAR_HALF_LENGTH,
			halfWidth: CAR_HALF_WIDTH,
			script: undefined,
			runs,
		});
	}
	if (busCycle) {
		const stops: { at: number; seconds: number }[] = [];
		for (let k = 0; k < BUS_STOPS; k++)
			stops.push({
				at: ((k + 0.5) / BUS_STOPS) * busCycle.length,
				seconds:
					(BUS_WAIT[0] as number) + rand() * ((BUS_WAIT[1] as number) - (BUS_WAIT[0] as number)),
			});
		const speed =
			(BUS_SPEED[0] as number) + rand() * ((BUS_SPEED[1] as number) - (BUS_SPEED[0] as number));
		const script = buildLoopScript(busCycle.length, speed, stops);
		vehicles.push({
			kind: 'bus',
			route: busCycle.path,
			speed,
			phase: 0,
			lateral: Math.min(0.5, busCycle.minHalf * 0.25),
			halfLength: BUS_HALF_LENGTH,
			halfWidth: BUS_HALF_WIDTH,
			script,
		});
	}
	// The vehicles move together, holding a headway, so that no two ever pass through each other.
	createMotion(vehicles, seed + 977);

	// The lines that the vehicles' bodies run their middles along, and the roads' own middle lines.
	// A walk keeps clear of the first, and a parked car stands clear of the second.
	type Run = { ax: number; az: number; bx: number; bz: number };
	const routeKey = (x: number, z: number) =>
		`${Math.floor(x / BODY_CELL)},${Math.floor(z / BODY_CELL)}`;
	const gridOf = (offset: boolean): Map<string, Run[]> => {
		const grid = new Map<string, Run[]>();
		const routePose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
		const routeScratch: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
		for (const vehicle of vehicles) {
			const count = vehicle.route.distance.length;
			const lines: { x: number; z: number }[] = [];
			for (let k = 0; k < count; k++) {
				poseAlong(
					vehicle.route,
					vehicle.route.distance[k] as number,
					offset ? vehicle.lateral : 0,
					true,
					routePose,
					routeScratch,
				);
				lines.push({ x: routePose.x, z: routePose.z });
			}
			lines.push(lines[0] as { x: number; z: number });
			for (let k = 0; k + 1 < lines.length; k++) {
				const a = lines[k] as { x: number; z: number };
				const b = lines[k + 1] as { x: number; z: number };
				const run = { ax: a.x, az: a.z, bx: b.x, bz: b.z };
				const steps = Math.ceil(hypot(run.bx - run.ax, run.bz - run.az) / BODY_CELL);
				for (let s = 0; s <= steps; s++) {
					const t = steps === 0 ? 0 : s / steps;
					const px = run.ax + (run.bx - run.ax) * t;
					const pz = run.az + (run.bz - run.az) * t;
					for (let i = -1; i <= 1; i++)
						for (let j = -1; j <= 1; j++) {
							const key = `${Math.floor(px / BODY_CELL) + i},${Math.floor(pz / BODY_CELL) + j}`;
							const list = grid.get(key);
							if (!list) grid.set(key, [run]);
							else if (!list.includes(run)) list.push(run);
						}
				}
			}
		}
		return grid;
	};
	const distanceTo = (grid: Map<string, Run[]>, x: number, z: number): number => {
		let nearest = Number.POSITIVE_INFINITY;
		for (const run of grid.get(routeKey(x, z)) ?? []) {
			const dx = run.bx - run.ax;
			const dz = run.bz - run.az;
			const length2 = dx * dx + dz * dz || 1;
			const t = Math.max(0, Math.min(1, ((x - run.ax) * dx + (z - run.az) * dz) / length2));
			const d = hypot(x - (run.ax + dx * t), z - (run.az + dz * t));
			if (d < nearest) nearest = d;
		}
		return nearest;
	};
	const bodyGrid = gridOf(true);
	const laneGrid = gridOf(false);
	/** How far a place stands from the middle line that a vehicle's body runs on, in meters. */
	const trafficClearance = (x: number, z: number): number => distanceTo(bodyGrid, x, z);
	/** How far a place stands from the road's own middle line, in meters. */
	const laneClearance = (x: number, z: number): number => distanceTo(laneGrid, x, z);

	const eastStreet = roadNear(-52, 190);
	const westStreet = roadNear(-130, 200);
	const harbourStreet = roadNear(-7, 190);
	const quayRoad = roadNear(HARBOUR_FRONT.x, HARBOUR_FRONT.z, 2.7);
	const harbourEast = arcNear(eastStreet, HARBOUR_FRONT.x, HARBOUR_FRONT.z);
	const harbourHarbour = arcNear(harbourStreet, 4, 298);
	const squareWest = arcNear(westStreet, SQUARE.x - SQUARE.hx, SQUARE.z);
	const churchEast = arcNear(eastStreet, CHURCH_AT.x, CHURCH_AT.z);
	const squareEast = arcNear(eastStreet, SQUARE.x, SQUARE.z);
	const promenadeA = arcNear(quayRoad, -77, 276);
	const promenadeB = arcNear(quayRoad, 30, 298);
	const quayCumulative = arcsOf(quayRoad);
	// The water side of the quay street: the houses stand on the inland side, so the walk is clear
	// along the harbour's edge.
	const promenadeSide = sideToward(quayRoad, quayCumulative, promenadeA, -77, 350);
	const eastCumulative = arcsOf(eastStreet);
	const churchSide = sideToward(eastStreet, eastCumulative, churchEast, CHURCH_AT.x, CHURCH_AT.z);
	// The seconds that a walk's end stays out of sight, so the fade reads and the person is gone.
	const endWait = () => TRIP_GAP[0] + rand() * (TRIP_GAP[1] - TRIP_GAP[0]);
	const startWait = () => 4 + rand() * 7;
	const definitions: WalkDefinition[] = [];
	const carSpots: ParkedCar[] = [];
	const usedCars = new Set<ParkedCar>();

	const addHouses = (
		road: Road,
		low: number,
		high: number,
		count: number,
		destination: number,
		carEnds: number,
		sides: readonly number[],
	): void => {
		let kept = 0;
		for (const lot of lotsOn(road, low, high)) {
			if (kept >= count) break;
			const door = doorOf(lot);
			const gate = projectOnRoad(road, lot.gate.x, lot.gate.z).at;
			const side = sideToward(road, arcsOf(road), gate, door.x, door.z);
			// A car that waits for a rider stands clear of the traffic, short of the junction.
			let parking: { at: number; car: ParkedCar } | undefined;
			if (kept < carEnds) {
				const direction = gate >= destination ? 1 : -1;
				const length = arcsOf(road)[arcsOf(road).length - 1] as number;
				for (let run = 2; run <= 26; run += 2) {
					const at = destination + direction * run;
					if (at < 0 || at > length) break;
					if (direction > 0 ? at >= gate : at <= gate) break;
					const car = parkedBeside(road, at, side);
					if (laneClearance(car.x, car.z) < PARKED_CLEAR) continue;
					if (!parkedClearOfHouses(car)) continue;
					parking = { at, car };
					break;
				}
			}
			const route = houseRoute(road, lot, parking ? parking.at : destination);
			if (route.path.length < 1) continue;
			definitions.push({
				path: route.path,
				keepStart: true,
				startShift: 0,
				startHidden: true,
				startSeconds: startWait(),
				endSeconds: parking ? 8 + rand() * 6 : endWait(),
				sides,
				sideSlot: kept % sides.length,
				car: parking?.car,
				road,
				roadSide: parking ? side : undefined,
				pavement: true,
				fromDoor: true,
			});
			kept++;
		}
	};
	addHouses(eastStreet, harbourEast, harbourEast + 90, 3, harbourEast, 1, SIDES_FOUR);
	addHouses(harbourStreet, harbourHarbour, harbourHarbour + 90, 3, harbourHarbour, 1, SIDES_THREE);
	addHouses(westStreet, squareWest - 35, squareWest + 40, 4, squareWest, 1, SIDES_FOUR);

	// A person walks between the church and the square, hidden at the church's end.
	for (let k = 0; k < 1; k++) {
		const walk = pavementWalk(eastStreet, churchEast, squareEast, churchSide);
		if (walk.length < 1) continue;
		definitions.push({
			path: walk,
			keepStart: false,
			startShift: k * 1.5,
			startHidden: true,
			startSeconds: 6 + rand() * 6,
			endSeconds: 0.6 + rand() * 1.2,
			sides: SIDES_ONE,
			sideSlot: 0,
			pavement: true,
		});
	}
	// People walk the harbour's promenade.
	for (let k = 0; k < 4; k++) {
		const walk = pavementWalk(quayRoad, promenadeA, promenadeB, promenadeSide);
		if (walk.length < 1) continue;
		definitions.push({
			path: walk,
			keepStart: false,
			startShift: k * 1.5,
			startHidden: false,
			startSeconds: 0,
			endSeconds: 0.6 + rand() * 1.2,
			sides: SIDES_FOUR,
			sideSlot: k,
			pavement: true,
		});
	}
	// People walk down to the sand and back.
	const sand = beachWalk();
	for (let k = 0; k < 4; k++) {
		if (sand.length < 1) break;
		definitions.push({
			path: sand,
			keepStart: false,
			startShift: k * 1.5,
			startHidden: true,
			startSeconds: 5 + rand() * 8,
			endSeconds: 0.6 + rand() * 1.2,
			sides: SIDES_FOUR,
			sideSlot: k,
		});
	}

	// One person for each walk, and more where the count asks for them. Each walks a line of its
	// own across the pavement, pushed clear of the houses and cut clear of the traffic.
	interface Draft {
		walk: Path;
		speed: number;
		phase: number;
		script: Script;
		definition: WalkDefinition;
		trips: PersonTrip[];
		cycle: number;
		car?: ParkedCar;
	}
	const drafts: Draft[] = [];
	// A place that a walk may take: clear of the houses, of the standing objects and of the
	// motors' bodies.
	const usable = (x: number, z: number): boolean =>
		housesClear(x, z) &&
		staticGap(x, z) >= PERSON_RADIUS &&
		trafficClearance(x, z) >= BUS_HALF_WIDTH + PERSON_RADIUS + 0.2;
	const buildPerson = (definition: WalkDefinition, onRoute: number): Draft => {
		const sides = definition.sides;
		// A rider stands on the house side of the pavement, clear of the car at the kerb.
		const rider = definition.road !== undefined && definition.roadSide !== undefined;
		const lateral = rider
			? Math.max(...sides)
			: (sides[(definition.sideSlot + onRoute) % sides.length] as number);
		let walk = trimWalk(offsetPathWalk(definition.path, lateral), usable, definition.keepStart);
		if (definition.startShift > 0 && walk.length > definition.startShift + 1)
			walk = slicePath(walk, definition.startShift, walk.length);
		const speed =
			(WALK_SPEED[0] as number) +
			(0.1 + rand() * 0.8) * ((WALK_SPEED[1] as number) - (WALK_SPEED[0] as number));
		// A rider's car stands beside the walk's far end, wherever the clear stretch stops.
		let car: ParkedCar | undefined;
		if (definition.road && definition.roadSide !== undefined) {
			const end = pointAtPath(walk, walk.length);
			const at = projectOnRoad(definition.road, end.x, end.z).at;
			for (const shift of [0, -2, 2, -4, 4, -6, 6]) {
				const beside = parkedBeside(definition.road, at + shift, definition.roadSide);
				if (laneClearance(beside.x, beside.z) < PARKED_CLEAR) continue;
				if (!parkedClearOfHouses(beside)) continue;
				car = beside;
				break;
			}
		}
		return {
			walk,
			speed,
			phase: 0,
			script: EMPTY_SCRIPT,
			definition,
			trips: [],
			cycle: 0,
			car,
		};
	};
	for (const definition of definitions) drafts.push(buildPerson(definition, 0));
	// More walks than people are built, so that a walk too short to read can be dropped.
	for (let round = 1; drafts.length < peopleCount * 2; round++)
		for (const definition of definitions) {
			if (drafts.length >= peopleCount * 2) break;
			drafts.push(buildPerson(definition, round));
		}
	// A walk too short to read is dropped, so the people keep the longest routes.
	const longEnough = drafts.filter((draft) => draft.walk.length >= MIN_PERSON_WALK);
	const chosenDrafts = longEnough.length >= peopleCount ? longEnough : drafts;
	// Two people never walk one line, so the first of each line keeps it.
	const lines: Path[] = [];
	const uniqueDrafts = chosenDrafts.filter((draft) => {
		if (lines.some((path) => sameWalk(path, draft.walk))) return false;
		lines.push(draft.walk);
		return true;
	});
	const picks = uniqueDrafts.length >= peopleCount ? uniqueDrafts : chosenDrafts;
	picks.sort(
		(a, b) =>
			(b.car !== undefined ? 1 : 0) - (a.car !== undefined ? 1 : 0) ||
			b.walk.length - a.walk.length,
	);
	// A person takes the next longest walk that no other person's line comes near.
	const lineGrid = new Map<string, Point[]>();
	const apart: Draft[] = [];
	for (const draft of picks) {
		if (lineNear(lineGrid, draft.walk)) continue;
		addLine(lineGrid, draft.walk);
		apart.push(draft);
		if (apart.length >= peopleCount) break;
	}
	const finalDrafts = apart.length >= peopleCount ? apart : picks.slice(0, peopleCount);
	drafts.length = 0;
	drafts.push(...finalDrafts);
	// Every later walk starts at a random point of the line that the person already walks, so a
	// person never leaves the clear route that the plan cut for it, and no two people share one.
	const walkPaths = drafts.map((draft) => draft.walk);
	// Every parked car is checked against every walk line, and a rider's car is moved until it
	// stands beside the walk without touching it.
	for (const draft of drafts) {
		if (!draft.car || !draft.definition.road || draft.definition.roadSide === undefined) continue;
		const road = draft.definition.road;
		const end = pointAtPath(draft.walk, draft.walk.length);
		const base = projectOnRoad(road, end.x, end.z).at;
		let placed: ParkedCar | undefined;
		let parkedAt = base;
		for (const shift of [0, -2, 2, -4, 4, -6, 6]) {
			const beside = parkedBeside(road, base + shift, draft.definition.roadSide);
			if (laneClearance(beside.x, beside.z) < PARKED_CLEAR) continue;
			if (!parkedClearOfHouses(beside)) continue;
			if (!parkedClearOfWalks(beside, walkPaths)) continue;
			placed = beside;
			parkedAt = base + shift;
			break;
		}
		// The walk ends beside its car, so the rider gets in at the door of the place it leaves in.
		if (placed) {
			const target = pointAt(road, arcsOf(road), parkedAt);
			const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
			let nearest = Number.POSITIVE_INFINITY;
			let end = draft.walk.length;
			for (let at = 0; at <= draft.walk.length; at += 0.1) {
				pathAt(draft.walk, at, pose);
				const d = hypot(pose.x - target.x, pose.z - target.z);
				if (d < nearest) {
					nearest = d;
					end = at;
				}
			}
			if (end < draft.walk.length - 0.5) {
				const sliced = slicePath(draft.walk, 0, end);
				// A car that leaves too short a walk is no place for a rider to get in.
				if (sliced.length >= MIN_RIDER_WALK) draft.walk = sliced;
				else placed = undefined;
			}
		}
		draft.car = placed;
	}
	// Each person's itinerary: the walk it first takes, then walks from random places of the
	// island, each one faded out at its end and faded in at its start.
	const peoplePerRoute = Math.max(1, Math.ceil(peopleCount / Math.max(1, definitions.length)));
	const people: PersonActor[] = drafts.map((draft, index) => {
		const definition = draft.definition;
		const ride = draft.car !== undefined;
		const first = buildFirstTrip(
			draft.walk,
			draft.speed,
			definition.startHidden ? definition.startSeconds : 0,
			definition.endSeconds,
			ride,
		);
		// A pavement walk draws at the pavement's height; its lengths stay as the plan cut them.
		const baseWalk = definition.pavement
			? liftWalk(draft.walk, definition.fromDoor === true)
			: draft.walk;
		const trips: PersonTrip[] = [{ walk: baseWalk, script: first, start: 0 }];
		let cycle = first.cycle;
		for (let k = 1; k < TRIP_COUNT; k++) {
			const walk = draft.walk;
			const longest = walk.length * 0.65;
			if (longest < 1) break;
			const from = Math.max(0, rand() * longest);
			const tail = TRIP_GAP[0] + rand() * (TRIP_GAP[1] - TRIP_GAP[0]);
			const script = buildLaterTrip(walk, draft.speed, from, tail);
			trips.push({ walk: baseWalk, script, start: cycle });
			cycle += script.cycle;
		}
		const phase = ((index + 0.05 + rand() * 0.8) / peoplePerRoute) * cycle;
		if (draft.car && !usedCars.has(draft.car)) {
			usedCars.add(draft.car);
			carSpots.push(draft.car);
		}
		return {
			walk: baseWalk,
			speed: draft.speed,
			phase,
			lateral: 0,
			script: first,
			trips,
			cycle,
			ride,
		};
	});
	separatePeople(people);

	// Parked cars: those beside the people who end at a car, then those beside houses.
	const parked: ParkedCar[] = [...carSpots];
	for (const road of [eastStreet, harbourStreet, westStreet, quayRoad]) {
		let placed = 0;
		for (const lot of lotsOn(road, 0, Number.POSITIVE_INFINITY)) {
			if (placed >= 2) break;
			const at = projectOnRoad(road, lot.gate.x, lot.gate.z).at;
			const door = doorOf(lot);
			const car = parkedBeside(road, at, sideToward(road, arcsOf(road), at, door.x, door.z));
			if (laneClearance(car.x, car.z) < PARKED_CLEAR) continue;
			if (!parkedClearOfHouses(car)) continue;
			if (!parkedClearOfWalks(car, walkPaths)) continue;
			parked.push(car);
			placed++;
		}
	}
	const kept = parked.slice(0, Math.max(parkedCount, carSpots.length));
	const counts = {
		cars: vehicles.filter((vehicle) => vehicle.kind === 'car').length,
		buses: vehicles.filter((vehicle) => vehicle.kind === 'bus').length,
		parkedCars: kept.length,
		people: people.length,
	};
	return { vehicles, people, parked: kept, counts };
}

/** One part of a model, with its batch. */
interface BoundPart {
	readonly batch: InstanceBatch;
	readonly part: TrafficPart;
}

/** A mover, its batches and the row that it writes in each. */
interface BoundMover<T> {
	readonly actor: T;
	readonly parts: readonly BoundPart[];
	readonly row: number;
}

/** How far a wheel has rolled, and how far its front axle turns into the curve. */
interface Drive {
	distance: number;
	steer: number;
}

/** Scratch rotations that a row's composition builds, so a frame allocates nothing. */
const ROW_TURN = quat.create();
const ROW_LOCAL = quat.create();
const ROW_SPIN = quat.create();
const ROW_STEER = quat.create();
const ROW_WHEEL = quat.create();
const ROW_ROLL = quat.create();
const ROW_OFFSET = vec3.create();
/** The axis of a model's roll, which is its own forward axis. */
const FORWARD = [0, 0, 1] as const;

/**
 * Puts one mover's transform into every part of its model. A part keeps its own place in the file,
 * which a quantized mesh stores in its node, and `drive` spins a wheel and turns a front one. A
 * walk stride rolls the model about its heading, lifts it, and surges it along the heading.
 */
function writeRow(
	parts: readonly BoundPart[],
	row: number,
	pose: Pose,
	scale: number,
	drive?: Drive,
	stride?: PersonStride,
	fade = 1,
): void {
	// A stride moves the whole row, so its sway is read once for every part of it.
	const surgeX = (stride?.sway ?? 0) * Math.sin(pose.yaw);
	const surgeZ = (stride?.sway ?? 0) * Math.cos(pose.yaw);
	const rise = stride?.bob ?? 0;
	// Every part scales about one ground point, so the whole model keeps its shape as it shrinks.
	const groundX = pose.x;
	const groundY = pose.y;
	const groundZ = pose.z;
	for (let k = 0; k < parts.length; k++) {
		const part = (parts[k] as BoundPart).part;
		const batch = (parts[k] as BoundPart).batch;
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		const turn = quat.fromEuler(ROW_TURN, 0, pose.yaw + (part.yaw ?? 0), 0);
		if (stride) {
			quat.setAxisAngle(ROW_ROLL, FORWARD, stride.roll);
			quat.multiply(turn, turn, ROW_ROLL);
		}
		let x = pose.x + surgeX;
		let y = pose.y + (part.lift ?? 0) + rise;
		let z = pose.z + surgeZ;
		if (part.position) {
			vec3.transformQuat(ROW_OFFSET, part.position, turn);
			x += ROW_OFFSET[0] as number;
			y += ROW_OFFSET[1] as number;
			z += ROW_OFFSET[2] as number;
		}
		if (fade !== 1) {
			x = groundX + (x - groundX) * fade;
			y = groundY + (y - groundY) * fade;
			z = groundZ + (z - groundZ) * fade;
		}
		positions[row * 3] = x;
		positions[row * 3 + 1] = y;
		positions[row * 3 + 2] = z;
		const q = part.rotation ? quat.multiply(ROW_LOCAL, turn, part.rotation) : turn;
		if (part.wheel && drive) {
			quat.setAxisAngle(ROW_SPIN, AXLE, drive.distance / part.wheel.radius);
			if (part.wheel.front) {
				quat.setAxisAngle(ROW_STEER, UP, drive.steer);
				quat.multiply(ROW_WHEEL, ROW_STEER, ROW_SPIN);
				quat.multiply(q, q, ROW_WHEEL);
			} else {
				quat.multiply(q, q, ROW_SPIN);
			}
		}
		rotations[row * 4] = q[0] as number;
		rotations[row * 4 + 1] = q[1] as number;
		rotations[row * 4 + 2] = q[2] as number;
		rotations[row * 4 + 3] = q[3] as number;
		const size = scale * (part.scale ?? 1) * fade;
		scales[row * 3] = size * (part.nodeScale?.[0] ?? 1);
		scales[row * 3 + 1] = size * (part.nodeScale?.[1] ?? 1);
		scales[row * 3 + 2] = size * (part.nodeScale?.[2] ?? 1);
	}
}

/** Writes one row's colour into a batch that takes a colour per row. */
function writeColour(batch: InstanceBatch, row: number, colour: Rgba): void {
	const colours = batch.colors;
	if (!colours) return;
	colours[row * 4] = colour[0];
	colours[row * 4 + 1] = colour[1];
	colours[row * 4 + 2] = colour[2];
	colours[row * 4 + 3] = colour[3];
}

/** Writes one person's clothing colour into every part of its proxy that takes one. */
function writePersonColours(parts: readonly BoundPart[], row: number, index: number): void {
	const clothing = clothingOf(index);
	for (const { batch, part } of parts) {
		if (part.tint === 'cloth') writeColour(batch, row, linear(clothing.shirt));
		else if (part.tint === 'legs') writeColour(batch, row, linear(clothing.legs));
		else if (part.tint === 'feet') writeColour(batch, row, SHOE_RGBA);
	}
}

/** Writes a vehicle's paint, and its accent where it has one, into every part that takes one. */
function writeVehicleColours(
	parts: readonly BoundPart[],
	row: number,
	paint: Rgba,
	accent: Rgba,
): void {
	for (const { batch, part } of parts) {
		if (part.tint === 'paint') writeColour(batch, row, paint);
		else if (part.tint === 'accent') writeColour(batch, row, accent);
	}
}

/** Builds one instance batch per part of a model, over `count` rows. */
function bindParts(
	ctx: SketchContext,
	models: readonly TrafficPart[],
	count: number,
	dynamic: boolean,
): BoundPart[] {
	return models.map((part) => ({
		batch: ctx.scene.createInstances(part.mesh, count, {
			material: part.material,
			...(dynamic && { dynamic: true }),
			castShadows: true,
			receiveShadows: true,
			...(part.tint !== undefined && { colors: true }),
		}),
		part,
	}));
}

/** Builds the instance batches for one model class and binds the actors to their rows. */
function bindMovers<T>(
	ctx: SketchContext,
	models: readonly TrafficPart[],
	actors: readonly T[],
): BoundMover<T>[] {
	if (actors.length === 0) return [];
	const parts = bindParts(ctx, models, actors.length, true);
	return actors.map((actor, row) => ({ actor, parts, row }));
}

/** The nearest distance from a walk to any watched place, in meters. */
function distanceToWatch(
	walk: Path,
	watch: readonly (readonly [number, number, number])[],
): number {
	let best = Number.POSITIVE_INFINITY;
	const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	for (let at = 0; at <= walk.length; at += WATCH_STEP) {
		pathAt(walk, at, pose);
		for (let k = 0; k < watch.length; k++) {
			const place = watch[k] as readonly [number, number, number];
			const d = Math.hypot(pose.x - place[0], pose.y - place[1], pose.z - place[2]);
			if (d < best) best = d;
		}
	}
	return best;
}

/**
 * Picks the people who walk as models. Each model kind gets the person nearest a watched place,
 * then the remaining places go to the nearest people. A kind without a walker stays a proxy.
 */
function chooseWalkers(
	people: readonly PersonActor[],
	models: TrafficModels,
	options: TrafficOptions,
): number[] {
	const watch = options.watch;
	const kinds = models.people.length;
	const limit = Math.max(
		0,
		Math.min(people.length, Math.floor(options.walkers ?? DEFAULT_WALKERS)),
	);
	if (!watch || watch.length === 0 || kinds === 0 || limit === 0) return [];
	const reach = people.map((person) => distanceToWatch(person.walk, watch));
	const hasWalker = (index: number): boolean => models.people[index % kinds]?.walker !== undefined;
	// Each kind's people, nearest first, and the kinds take one in turn so every walker appears.
	const byKind: number[][] = [];
	for (let kind = 0; kind < kinds; kind++) {
		const list: number[] = [];
		for (let index = kind; index < people.length; index += kinds)
			if (hasWalker(index)) list.push(index);
		list.sort((a, b) => (reach[a] as number) - (reach[b] as number));
		byKind.push(list);
	}
	const chosen = new Set<number>();
	for (let round = 0; chosen.size < limit; round++) {
		let added = false;
		for (const list of byKind) {
			if (chosen.size >= limit) break;
			const next = list[round];
			if (next === undefined) continue;
			chosen.add(next);
			added = true;
		}
		if (!added) break;
	}
	return [...chosen];
}

/** Scratch poses for reading a route's curve. */
const STEER_POSE: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const STEER_SCRATCH: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

/** How far a vehicle's front wheel turns into the curve at a distance along its route. */
function steerAt(actor: VehicleActor, distance: number): number {
	const bound = MOTIONS.get(actor);
	const path = bound ? (bound.motion.paths[bound.index] ?? actor.route) : actor.route;
	const lateral = bound ? (bound.motion.laterals[bound.index] as number) : actor.lateral;
	poseAlong(path, distance - STEER_SPAN, lateral, true, STEER_POSE, STEER_SCRATCH);
	const before = STEER_POSE.yaw;
	poseAlong(path, distance + STEER_SPAN, lateral, true, STEER_POSE, STEER_SCRATCH);
	let turn = STEER_POSE.yaw - before;
	if (turn > Math.PI) turn -= Math.PI * 2;
	else if (turn < -Math.PI) turn += Math.PI * 2;
	return Math.max(-MAX_STEER, Math.min(MAX_STEER, turn));
}

/** A walker copy, and whether it last drew and last walked. */
interface WalkerCopy {
	readonly actor: PersonActor;
	readonly copy: PrefabInstance;
	/** The clip that the walker plays while it walks. */
	readonly clip: string;
	/** The rate at which the walker's clip plays, which keeps its steps with its speed. */
	readonly rate: number;
	visible: boolean;
	/** True while the walker's clip plays, which rests while the person waits out of sight. */
	walking: boolean;
}

/**
 * Builds the island's traffic. The caller passes the car, bus and person models; the motion never
 * depends on the placeholders. The people whose walks come nearest the watched places draw as
 * skinned walkers, and every other person stands as a far proxy. Call `update` once a frame with
 * the seconds since the scene started.
 */
export function createTraffic(
	ctx: SketchContext,
	models: TrafficModels,
	options: TrafficOptions = {},
): Traffic {
	const plan = planTraffic(options);
	const kinds = models.people.length;
	const chosen = chooseWalkers(plan.people, models, options);
	const chosenSet = new Set(chosen);
	const batches: InstanceBatch[] = [];
	const owned: Material[] = [];
	const collect = (parts: readonly BoundPart[]): void => {
		for (const bound of parts) batches.push(bound.batch);
	};

	const cars = plan.vehicles.filter((vehicle) => vehicle.kind === 'car');
	const buses = plan.vehicles.filter((vehicle) => vehicle.kind === 'bus');
	const carMovers = bindMovers(ctx, models.car, cars);
	const busMovers = bindMovers(ctx, models.bus, buses);
	if (carMovers.length > 0) collect((carMovers[0] as BoundMover<VehicleActor>).parts);
	if (busMovers.length > 0) collect((busMovers[0] as BoundMover<VehicleActor>).parts);
	carMovers.forEach((mover, k) => {
		const paint = MOVING_CAR_PAINT[k % MOVING_CAR_PAINT.length] as Rgba;
		writeVehicleColours(mover.parts, mover.row, paint, paint);
	});
	busMovers.forEach((mover) => {
		writeVehicleColours(mover.parts, mover.row, BUS_PAINT_RGBA, BUS_BAND_RGBA);
	});

	const parkedParts =
		plan.parked.length === 0 ? [] : bindParts(ctx, models.car, plan.parked.length, false);
	collect(parkedParts);
	const parkedPose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	plan.parked.forEach((car, row) => {
		parkedPose.x = car.x;
		parkedPose.y = car.y;
		parkedPose.z = car.z;
		parkedPose.yaw = car.yaw;
		writeRow(parkedParts, row, parkedPose, 1);
		const paint = PARKED_CAR_PAINT[row % PARKED_CAR_PAINT.length] as Rgba;
		writeVehicleColours(parkedParts, row, paint, paint);
	});
	for (const { batch } of parkedParts) batch.markDirty();

	// The far people: one group of batches for each model kind, over the people left as proxies.
	const proxies: BoundMover<PersonActor>[] = [];
	let proxyRows = 0;
	for (let kind = 0; kind < kinds; kind++) {
		const model = models.people[kind] as PersonModel;
		const actors: PersonActor[] = [];
		const indices: number[] = [];
		for (let index = kind; index < plan.people.length; index += kinds) {
			if (chosenSet.has(index)) continue;
			indices.push(index);
			actors.push(plan.people[index] as PersonActor);
		}
		if (actors.length === 0) continue;
		const movers = bindMovers(ctx, model.parts, actors);
		if (movers.length === 0) continue;
		collect((movers[0] as BoundMover<PersonActor>).parts);
		movers.forEach((mover, row) => {
			writePersonColours(mover.parts, mover.row, indices[row] as number);
		});
		proxyRows += actors.length * (movers[0]?.parts.length ?? 0);
		proxies.push(...movers);
	}

	// The near people: one skinned copy each, in the colour of its own clothing.
	const walkers: WalkerCopy[] = [];
	const clothing = new Map<string, Material>();
	for (const index of chosen) {
		const model = models.people[kinds > 0 ? index % kinds : 0]?.walker;
		if (!model) continue;
		const actor = plan.people[index] as PersonActor;
		const copy = ctx.scene.instantiate(model.prefab, {
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		});
		for (const name of model.hidden) copy.find(name)?.setVisible(false);
		const colours = clothingOf(index);
		for (const part of model.parts) {
			if (part.tint === undefined) continue;
			const hex =
				part.tint === 'cloth' ? colours.shirt : part.tint === 'legs' ? colours.legs : colours.feet;
			let material = clothing.get(hex);
			if (!material) {
				material = ctx.materials.standard({ color: hex, roughness: 0.85 });
				clothing.set(hex, material);
				owned.push(material);
			}
			(copy.find(part.name) as Mesh | undefined)?.setMaterial(material);
		}
		const rate = actor.speed / WALK_CLIP_SPEED;
		copy.animator().play(model.clip, { time: actor.phase, speed: rate });
		walkers.push({ actor, copy, clip: model.clip, rate, visible: true, walking: true });
	}

	const carSteers = models.car.some((part) => part.wheel?.front === true);
	const busSteers = models.bus.some((part) => part.wheel?.front === true);
	// The sound add-on reads the moving vehicles' places and speeds; these arrays never grow.
	const moving = plan.vehicles;
	const vehiclePlaces = new Float32Array(moving.length * 3);
	const vehicleSpeeds = new Float32Array(moving.length);
	const lastDistances = new Float64Array(moving.length);
	let lastSeconds = Number.NaN;
	const drive: Drive = { distance: 0, steer: 0 };
	const vehiclePose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const personState: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false, fade: 0 };
	const personWalk: PersonStride = { bob: 0, roll: 0, sway: 0 };

	const driveVehicle = (
		mover: BoundMover<VehicleActor>,
		seconds: number,
		steers: boolean,
		index: number,
	): void => {
		const fade = vehicleFadeAt(mover.actor, seconds);
		vehicleAt(mover.actor, seconds, vehiclePose);
		drive.distance = vehicleDistanceAt(mover.actor, seconds);
		drive.steer = steers ? steerAt(mover.actor, drive.distance) : 0;
		// A vehicle out of sight keeps the place it last held, and it is not heard.
		if (fade > 0) {
			const dt = seconds - lastSeconds;
			const moved = Math.abs(drive.distance - (lastDistances[index] as number));
			vehicleSpeeds[index] =
				dt > 1e-6 ? Math.min(mover.actor.speed, moved / dt) : mover.actor.speed;
			vehiclePlaces[index * 3] = vehiclePose.x;
			vehiclePlaces[index * 3 + 1] = vehiclePose.y;
			vehiclePlaces[index * 3 + 2] = vehiclePose.z;
		} else {
			vehicleSpeeds[index] = 0;
		}
		lastDistances[index] = drive.distance;
		writeRow(mover.parts, mover.row, vehiclePose, 1, drive, undefined, fade);
	};

	const update = (seconds: number): void => {
		// The plan's order is the cars first, then the bus, and the binders keep that order.
		let index = 0;
		for (const mover of carMovers) driveVehicle(mover, seconds, carSteers, index++);
		for (const mover of busMovers) driveVehicle(mover, seconds, busSteers, index++);
		lastSeconds = seconds;
		for (const mover of proxies) {
			const state = personAt(mover.actor, seconds, personState);
			const stride = state.hidden ? undefined : personStrideAt(mover.actor, seconds, personWalk);
			writeRow(mover.parts, mover.row, state, 1, undefined, stride, state.fade);
		}
		for (const walker of walkers) {
			const state = personAt(walker.actor, seconds, personState);
			const show = !state.hidden;
			if (show !== walker.visible) {
				walker.copy.setVisible(show);
				walker.visible = show;
			}
			// The clip plays only over a walking leg, and it starts again at each new walk, so a
			// person out of sight never walks on the spot.
			const walking = personStrideAt(walker.actor, seconds, personWalk) !== undefined;
			if (walking !== walker.walking) {
				if (walking) walker.copy.animator().play(walker.clip, { time: 0, speed: walker.rate });
				else walker.copy.animator().stop();
				walker.walking = walking;
			}
			if (show) {
				walker.copy.setPosition(state.x, state.y, state.z);
				walker.copy.setRotationEuler(0, state.yaw, 0);
			}
		}
	};
	update(0);

	const destroy = (): void => {
		for (const batch of batches) batch.destroy();
		for (const walker of walkers) walker.copy.destroy();
		for (const material of owned) material.destroy();
	};

	const carParts = carMovers[0]?.parts.length ?? 0;
	const busParts = busMovers[0]?.parts.length ?? 0;
	const rowCount =
		plan.parked.length * parkedParts.length +
		cars.length * carParts +
		buses.length * busParts +
		proxyRows;
	return {
		update,
		destroy,
		counts: plan.counts,
		rows: rowCount,
		batches: batches.length,
		vehicles: vehiclePlaces,
		speeds: vehicleSpeeds,
	};
}

/**
 * Simple geometry for a first run: a low car with a cabin, a tall bus, and a person as a capsule.
 * The caller replaces each part with the real model's mesh and material.
 */
export function createPlaceholderModels(ctx: SketchContext): TrafficModels {
	const paint = ctx.materials.standard({ color: '#c1443a', roughness: 0.45, metalness: 0.25 });
	const glass = ctx.materials.standard({ color: '#26343f', roughness: 0.15, metalness: 0.1 });
	const busPaint = ctx.materials.standard({ color: '#b8782c', roughness: 0.6, metalness: 0.1 });
	const cloth = ctx.materials.standard({ color: '#3c5a70', roughness: 0.9 });
	return {
		car: [
			{
				mesh: ctx.geometry.box({ width: 1.75, height: 0.65, depth: 4.1 }),
				material: paint,
				lift: 0.5,
			},
			{
				mesh: ctx.geometry.box({ width: 1.55, height: 0.55, depth: 2.1 }),
				material: glass,
				lift: 1.1,
			},
		],
		bus: [
			{
				mesh: ctx.geometry.box({ width: 2.4, height: 2.6, depth: 8.6 }),
				material: busPaint,
				lift: 1.5,
			},
		],
		people: [
			{
				parts: [
					{
						mesh: ctx.geometry.capsule({ radius: 0.26, height: 1.05 }),
						material: cloth,
						lift: PERSON_LIFT,
					},
				],
			},
		],
	};
}

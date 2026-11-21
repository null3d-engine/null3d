// The island's people and vehicles: what moves, how many, and what the caller supplies.
//
// Vehicles follow closed loops cut from the stored road network at its junctions. Cars take a
// spread of those loops at their own speeds and phases, and one bus runs a long loop that passes
// the harbour, waiting at stops. They move together with a headway: a vehicle holds when its body
// would reach another's, so no two pass through each other. A few cars stand parked at the kerbs.
//
// People walk pavements and footpaths between houses, the square, the church, the harbour and the
// beach. Each person takes a place of its own across the pavement, and each walk is cut to the
// stretches clear of the houses and of the moving traffic. A script of walking and waiting legs
// then runs: a hidden wait stands for time inside a building or a car, a visible wait for standing
// about, and the walk legs carry them between the two. The script repeats, so a person enters and
// leaves a building, waits by the water, and gets into and out of a car on a fixed cadence.
//
// The plan is deterministic from a seed. Speeds are stratified so that no two cars share one, and
// cars that share a loop are spread around it. A different seed gives a different island of traffic.
//
// The caller supplies the models. `createPlaceholderModels` gives simple geometry for a first run;
// the real car, bus and person models replace it without a change to the motion. Each model is a
// list of parts, and every part of a model takes the same transform, so a model with a body, glass
// and wheels draws as several instance batches that move in step.
//
// Counts at the default options: 9 cars, 1 bus, 8 parked cars and 18 people. A frame samples each
// mover's path and writes its transform into one vertex row per part: 28 movers and about 0.01 ms
// of work on this Mac.

import type { InstanceBatch, Material, MeshGeometry, SketchContext } from '@null3d/engine';
import { random } from '../../lib/procedural';
import { BAY, hypot, SEA_LEVEL, sandAt } from './island';
import { HOUSE_KINDS } from './kit';
import { CHURCH_AT, doorOf, groundHeight, LOTS, type Lot, ROADS, SQUARE } from './plan';
import type { Road, RoadPoint } from './routes';

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
}

/** A person who walks a path there and back on a repeating script. */
export interface PersonActor {
	/** The path walked, from a door or the road to the far end. */
	readonly walk: Path;
	/** The speed of the walking legs, in meters a second. */
	readonly speed: number;
	/** The seconds into the script at the start. */
	readonly phase: number;
	/** The offset from the walk's line to the person's side of the pavement, in meters. */
	readonly lateral: number;
	/** The walking and waiting legs. */
	readonly script: Script;
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
}

/** One drawable part of a car, a bus or a person. */
export interface TrafficPart {
	readonly mesh: MeshGeometry;
	readonly material: Material;
	/** The meters the part's middle stands above the path's surface. The default is 0. */
	readonly lift?: number;
	/** The radians added to the path's heading, so the model's front points forward. The default is 0. */
	readonly yaw?: number;
	/** The part's uniform scale. The default is 1. */
	readonly scale?: number;
}

/** The models that the motion draws. Every part of one model takes that model's transform. */
export interface TrafficModels {
	readonly car: readonly TrafficPart[];
	readonly bus: readonly TrafficPart[];
	readonly person: readonly TrafficPart[];
}

/** The moving scene, as the caller drives it. */
export interface Traffic {
	/** Places every mover at the given seconds since the scene started. */
	update(seconds: number): void;
	readonly counts: TrafficPlan['counts'];
	/** The number of instance rows that draw. */
	readonly rows: number;
	/** The number of instance batches, which is one draw call each. */
	readonly batches: number;
}

/** The seed of the default plan. */
export const TRAFFIC_SEED = 20261122;

/** The default numbers of cars, parked cars and people. */
const DEFAULT_CARS = 9;
const DEFAULT_PARKED = 8;
const DEFAULT_PEOPLE = 18;

/** How far past a road's edge a pavement runs, in meters. */
const PAVEMENT = 1;
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
const CAR_HALF_LENGTH = 2.1;
const CAR_HALF_WIDTH = 0.9;
const BUS_HALF_LENGTH = 4.3;
const BUS_HALF_WIDTH = 1.2;
/** The least gap that a follower keeps between its body and another vehicle's body, in meters. */
const VEHICLE_GAP = 0.5;
/** The radius of a person's body, in meters. */
const PERSON_RADIUS = 0.3;
/** The least gap between two visible people, in meters. */
const PERSON_CLEAR = 0.6;
/** The shortest walk that a rider keeps after the walk is cut back to its car, in meters. */
const MIN_RIDER_WALK = 5;
/** The places that people take across one pavement, a body's width apart, in meters. */
const SIDES_FOUR = [-1.05, -0.35, 0.35, 1.05] as const;
const SIDES_THREE = [-0.7, 0, 0.7] as const;
const SIDES_ONE = [1.05] as const;
/** The margin that a walk keeps from every house wall, in meters. */
const HOUSE_CLEAR = 0.45;
/** How far ahead of a door a person steps out before the walk counts, in meters. */
const DOOR_STEP = 0.5;

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
			const path = makePath(roadSlice(road, cum, a.at, b.at));
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

/** Builds a script from ordered stops, walking forward to the far end and back. */
function buildScript(
	length: number,
	speed: number,
	stops: readonly { at: number; seconds: number; hidden: boolean }[],
	start: { seconds: number; hidden: boolean },
	end: { seconds: number; hidden: boolean },
): Script {
	const legs: Leg[] = [];
	const add = (from: number, to: number, seconds: number, hidden: boolean): void => {
		if (seconds <= 1e-9) return;
		legs.push({ seconds, from, to, hidden });
	};
	const ordered = stops
		.filter((stop) => stop.at > 0.5 && stop.at < length - 0.5)
		.sort((a, b) => a.at - b.at);
	add(0, 0, start.seconds, start.hidden);
	let at = 0;
	for (const stop of ordered) {
		add(at, stop.at, Math.abs(stop.at - at) / speed, false);
		add(stop.at, stop.at, stop.seconds, stop.hidden);
		at = stop.at;
	}
	add(at, length, Math.abs(length - at) / speed, false);
	add(length, length, end.seconds, end.hidden);
	at = length;
	for (let k = ordered.length - 1; k >= 0; k--) {
		const stop = ordered[k] as { at: number; seconds: number; hidden: boolean };
		add(at, stop.at, Math.abs(at - stop.at) / speed, false);
		add(stop.at, stop.at, stop.seconds, stop.hidden);
		at = stop.at;
	}
	add(at, 0, Math.abs(at) / speed, false);
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
	const ends = script.ends;
	let lo = 0;
	let hi = ends.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((ends[mid] as number) <= local) lo = mid + 1;
		else hi = mid;
	}
	const leg = script.legs[lo] as Leg;
	const before = lo === 0 ? 0 : (ends[lo - 1] as number);
	const t = leg.seconds > 1e-9 ? (local - before) / leg.seconds : 0;
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
	actor: VehicleActor,
	at: number,
	x: Float64Array,
	z: Float64Array,
	fx: Float64Array,
	fz: Float64Array,
	index: number,
): void {
	poseAlong(actor.route, at, actor.lateral, true, MOTION_POSE, MOTION_SCRATCH);
	x[index] = MOTION_POSE.x;
	z[index] = MOTION_POSE.z;
	fx[index] = Math.sin(MOTION_POSE.yaw);
	fz[index] = Math.cos(MOTION_POSE.yaw);
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
	} = motion;
	const count = actors.length;
	const previous = (steps - 1) * count;
	const row = steps * count;
	const from = (steps - 1) * motion.step;
	const to = steps * motion.step;
	for (let i = 0; i < count; i++) {
		sim[i] = data[previous + i] as number;
		settled[i] = 0;
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
		bodyAt(actor, proposed, nextX, nextZ, nextFX, nextFZ, i);
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
			if (d < actor.halfWidth + other.halfWidth + VEHICLE_GAP) clear = false;
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
function createMotion(actors: readonly VehicleActor[]): VehicleMotion {
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
	};
	actors.forEach((actor, index) => {
		MOTIONS.set(actor, { motion, index });
		bodyAt(actor, actor.phase, motion.curX, motion.curZ, motion.curFX, motion.curFZ, index);
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

/**
 * Where a vehicle is at a time. Its plan's motion moves every vehicle with a minimum headway, and
 * a bus waits at its stops. The result is written to `out`, or to a shared pose when it is left out.
 */
export function vehicleAt(actor: VehicleActor, seconds: number, out: Pose = SHARED_POSE): Pose {
	const bound = MOTIONS.get(actor);
	let at: number;
	if (bound) {
		const { motion, index } = bound;
		advanceMotion(motion, seconds);
		const x = Math.max(0, seconds) / motion.step;
		const i0 = Math.min(motion.steps - 1, Math.floor(x));
		const i1 = Math.min(motion.steps - 1, i0 + 1);
		const f = Math.max(0, Math.min(1, x - i0));
		const count = motion.actors.length;
		const a = motion.data[i0 * count + index] as number;
		const b = motion.data[i1 * count + index] as number;
		at = a + (b - a) * f;
	} else if (actor.script) at = sampleScript(actor.script, seconds, SCRIPT_STATE).distance;
	else at = actor.phase + actor.speed * seconds;
	poseAlong(actor.route, at, actor.lateral, true, out, SHARED_SCRATCH);
	out.y += ROAD_SURFACE;
	return out;
}

/** Where a person is at a time, and whether they are out of sight. */
export interface PersonState extends Pose {
	hidden: boolean;
}

/** The shared person state. */
const SHARED_PERSON: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false };

/**
 * Where a person is at a time. The result is written to `out`, or to a shared state when it is
 * left out.
 */
export function personAt(
	actor: PersonActor,
	seconds: number,
	out: PersonState = SHARED_PERSON,
): PersonState {
	const state = sampleScript(actor.script, seconds + actor.phase, SCRIPT_STATE);
	poseAlong(actor.walk, state.distance, actor.lateral, false, out, SHARED_SCRATCH);
	if (!state.forward) out.yaw += Math.PI;
	out.hidden = state.hidden;
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

/** Whether a place lies within a house's rectangle, widened by a margin. */
function insideHouse(house: HouseRect, x: number, z: number, margin: number): boolean {
	const [c, s] = [Math.cos(house.yaw), Math.sin(house.yaw)];
	const dx = x - house.x;
	const dz = z - house.z;
	const u = dx * c + dz * s;
	const v = -dx * s + dz * c;
	return Math.abs(u) < house.hw + margin && Math.abs(v) < house.hd + margin;
}

/** Whether a place stands clear of every house beside it, by the walking margin. */
function housesClear(x: number, z: number): boolean {
	for (const house of HOUSE_GRID.get(
		`${Math.floor(x / HOUSE_CELL)},${Math.floor(z / HOUSE_CELL)}`,
	) ?? [])
		if (insideHouse(house, x, z, HOUSE_CLEAR)) return false;
	return true;
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
	const state: PersonState = { x: 0, y: 0, z: 0, yaw: 0, hidden: false };
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
				const shift = person.script.cycle * (0.31 + pass * 0.09);
				people[b] = { ...person, phase: (person.phase + shift) % person.script.cycle };
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

/** One person's walk, and how its ends behave. */
interface WalkDefinition {
	readonly path: Path;
	readonly startHidden: boolean;
	readonly startSeconds: number;
	readonly endHidden: boolean;
	readonly endSeconds: number;
	/** True adds a visible pause on the way. */
	readonly mid: boolean;
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
	for (let k = 0; k < carCount; k++) {
		const cycle = carCycles[k % carCycles.length] as Cycle;
		const onCycle = assigned.get(cycle) ?? 0;
		assigned.set(cycle, onCycle + 1);
		const lateral = Math.max(0.25, Math.min(0.6, cycle.minHalf * 0.3));
		const speed =
			(CAR_SPEED[0] as number) +
			((k + rand() * 0.6) / carCount) * ((CAR_SPEED[1] as number) - (CAR_SPEED[0] as number));
		const phase = ((onCycle + 0.1 + rand() * 0.6) / carsPerCycle) * cycle.length;
		vehicles.push({
			kind: 'car',
			route: cycle.path,
			speed,
			phase,
			lateral,
			halfLength: CAR_HALF_LENGTH,
			halfWidth: CAR_HALF_WIDTH,
			script: undefined,
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
	createMotion(vehicles);

	// The places that moving traffic passes, so that a parked car never stands in its lane.
	const routePose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const routeScratch: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const trafficPoints: number[] = [];
	for (let k = 0; k < vehicles.length; k++) {
		const vehicle = vehicles[k] as VehicleActor;
		for (let at = 0; at <= vehicle.route.length; at += 0.5) {
			poseAlong(vehicle.route, at, vehicle.lateral, true, routePose, routeScratch);
			trafficPoints.push(routePose.x, routePose.z);
		}
	}
	const trafficClearance = (x: number, z: number): number => {
		let nearest = Number.POSITIVE_INFINITY;
		for (let k = 0; k < trafficPoints.length; k += 2) {
			const d = hypot((trafficPoints[k] as number) - x, (trafficPoints[k + 1] as number) - z);
			if (d < nearest) nearest = d;
		}
		return nearest;
	};

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
	const promenadeSide = sideToward(quayRoad, quayCumulative, promenadeA, -77, 240);
	const eastCumulative = arcsOf(eastStreet);
	const churchSide = sideToward(eastStreet, eastCumulative, churchEast, CHURCH_AT.x, CHURCH_AT.z);
	const endWait = () => 6 + rand() * 18;
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
					if (trafficClearance(car.x, car.z) >= PARKED_CLEAR) {
						parking = { at, car };
						break;
					}
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
				endHidden: parking !== undefined,
				endSeconds: parking ? 8 + rand() * 6 : endWait(),
				mid: rand() < 0.55,
				sides,
				sideSlot: kept % sides.length,
				car: parking?.car,
				road,
				roadSide: parking ? side : undefined,
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
			endHidden: false,
			endSeconds: 8 + rand() * 12,
			mid: true,
			sides: SIDES_ONE,
			sideSlot: 0,
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
			startSeconds: 2 + rand() * 4,
			endHidden: false,
			endSeconds: 5 + rand() * 15,
			mid: k !== 1,
			sides: SIDES_FOUR,
			sideSlot: k,
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
			endHidden: false,
			endSeconds: 18 + rand() * 25,
			mid: false,
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
		stops: { at: number; seconds: number; hidden: boolean }[];
		car?: ParkedCar;
	}
	const drafts: Draft[] = [];
	const buildPerson = (definition: WalkDefinition, onRoute: number): Draft => {
		const sides = definition.sides;
		// A rider stands on the house side of the pavement, clear of the car at the kerb.
		const rider = definition.road !== undefined && definition.roadSide !== undefined;
		const lateral = rider
			? Math.max(...sides)
			: (sides[(definition.sideSlot + onRoute) % sides.length] as number);
		const usable = (x: number, z: number): boolean =>
			housesClear(x, z) && trafficClearance(x, z) >= BUS_HALF_WIDTH + PERSON_RADIUS + 0.2;
		let walk = trimWalk(offsetPathWalk(definition.path, lateral), usable, definition.keepStart);
		if (definition.startShift > 0 && walk.length > definition.startShift + 1)
			walk = slicePath(walk, definition.startShift, walk.length);
		const speed =
			(WALK_SPEED[0] as number) +
			(0.1 + rand() * 0.8) * ((WALK_SPEED[1] as number) - (WALK_SPEED[0] as number));
		const stops: { at: number; seconds: number; hidden: boolean }[] = [];
		if (definition.mid)
			stops.push({
				at: walk.length * (0.35 + rand() * 0.3),
				seconds: 2 + rand() * 5,
				hidden: false,
			});
		// A rider's car stands beside the walk's far end, wherever the clear stretch stops.
		let car: ParkedCar | undefined;
		if (definition.road && definition.roadSide !== undefined) {
			const end = pointAtPath(walk, walk.length);
			const at = projectOnRoad(definition.road, end.x, end.z).at;
			for (const shift of [0, -2, 2, -4, 4, -6, 6]) {
				const beside = parkedBeside(definition.road, at + shift, definition.roadSide);
				if (trafficClearance(beside.x, beside.z) < PARKED_CLEAR) continue;
				car = beside;
				break;
			}
		}
		const script = buildScript(
			walk.length,
			speed,
			stops,
			{ seconds: definition.startSeconds, hidden: definition.startHidden },
			{ seconds: definition.endSeconds, hidden: car !== undefined },
		);
		const peoplePerRoute = Math.max(1, Math.ceil(peopleCount / Math.max(1, definitions.length)));
		const phase = ((onRoute + 0.05 + rand() * 0.8) / peoplePerRoute) * script.cycle;
		return { walk, speed, phase, script, definition, stops, car };
	};
	for (const definition of definitions) drafts.push(buildPerson(definition, 0));
	for (let round = 1; drafts.length < peopleCount; round++)
		for (const definition of definitions) {
			if (drafts.length >= peopleCount) break;
			drafts.push(buildPerson(definition, round));
		}
	// A walk too short to read is dropped, so the people keep the longest routes.
	if (drafts.length > peopleCount) {
		drafts.sort(
			(a, b) =>
				(b.car !== undefined ? 1 : 0) - (a.car !== undefined ? 1 : 0) ||
				b.walk.length - a.walk.length,
		);
		drafts.length = peopleCount;
	}
	// Every parked car is checked against every walk line, and a rider's car is moved until it
	// stands beside the walk without touching it.
	const walkPaths = drafts.map((draft) => draft.walk);
	for (const draft of drafts) {
		if (!draft.car || !draft.definition.road || draft.definition.roadSide === undefined) continue;
		const road = draft.definition.road;
		const end = pointAtPath(draft.walk, draft.walk.length);
		const base = projectOnRoad(road, end.x, end.z).at;
		let placed: ParkedCar | undefined;
		let parkedAt = base;
		for (const shift of [0, -2, 2, -4, 4, -6, 6]) {
			const beside = parkedBeside(road, base + shift, draft.definition.roadSide);
			if (trafficClearance(beside.x, beside.z) < PARKED_CLEAR) continue;
			if (!parkedClearOfWalks(beside, walkPaths)) continue;
			placed = beside;
			parkedAt = base + shift;
			break;
		}
		// The walk ends beside its car, so the rider waits at the door of the place it leaves in.
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
				// A car that leaves too short a walk is no place for a rider to wait.
				if (sliced.length >= MIN_RIDER_WALK) draft.walk = sliced;
				else placed = undefined;
			}
		}
		draft.car = placed;
		draft.script = buildScript(
			draft.walk.length,
			draft.speed,
			draft.stops,
			{ seconds: draft.definition.startSeconds, hidden: draft.definition.startHidden },
			{ seconds: draft.definition.endSeconds, hidden: placed !== undefined },
		);
	}
	const people: PersonActor[] = drafts.map((draft) => {
		if (draft.car && !usedCars.has(draft.car)) {
			usedCars.add(draft.car);
			carSpots.push(draft.car);
		}
		return {
			walk: draft.walk,
			speed: draft.speed,
			phase: draft.phase,
			lateral: 0,
			script: draft.script,
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
			if (trafficClearance(car.x, car.z) < PARKED_CLEAR) continue;
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

/** Puts one mover's transform into every part of its model. */
function writeRow(parts: readonly BoundPart[], row: number, pose: Pose, scale: number): void {
	for (let k = 0; k < parts.length; k++) {
		const part = (parts[k] as BoundPart).part;
		const batch = (parts[k] as BoundPart).batch;
		const positions = batch.positions;
		const rotations = batch.rotations;
		const scales = batch.scales;
		positions[row * 3] = pose.x;
		positions[row * 3 + 1] = pose.y + (part.lift ?? 0);
		positions[row * 3 + 2] = pose.z;
		const half = (pose.yaw + (part.yaw ?? 0)) * 0.5;
		rotations[row * 4] = 0;
		rotations[row * 4 + 1] = Math.sin(half);
		rotations[row * 4 + 2] = 0;
		rotations[row * 4 + 3] = Math.cos(half);
		const size = scale * (part.scale ?? 1);
		scales[row * 3] = size;
		scales[row * 3 + 1] = size;
		scales[row * 3 + 2] = size;
	}
}

/** Builds the instance batches for one model class and binds the actors to their rows. */
function bindMovers<T>(
	ctx: SketchContext,
	models: readonly TrafficPart[],
	actors: readonly T[],
): BoundMover<T>[] {
	if (actors.length === 0) return [];
	const parts: BoundPart[] = models.map((part) => ({
		batch: ctx.scene.createInstances(part.mesh, actors.length, {
			material: part.material,
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		}),
		part,
	}));
	return actors.map((actor, row) => ({ actor, parts, row }));
}

/**
 * Builds the island's traffic. The caller passes the car, bus and person models; the motion never
 * depends on the placeholders. Call `update` once a frame with the seconds since the scene started.
 */
export function createTraffic(
	ctx: SketchContext,
	models: TrafficModels,
	options: TrafficOptions = {},
): Traffic {
	const plan = planTraffic(options);
	const cars = plan.vehicles.filter((vehicle) => vehicle.kind === 'car');
	const buses = plan.vehicles.filter((vehicle) => vehicle.kind === 'bus');
	const carMovers = bindMovers(ctx, models.car, cars);
	const busMovers = bindMovers(ctx, models.bus, buses);
	const personMovers = bindMovers(ctx, models.person, plan.people);
	const parkedParts: BoundPart[] =
		plan.parked.length === 0
			? []
			: models.car.map((part) => ({
					batch: ctx.scene.createInstances(part.mesh, plan.parked.length, {
						material: part.material,
						castShadows: true,
						receiveShadows: true,
					}),
					part,
				}));
	const parkedPose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	plan.parked.forEach((car, row) => {
		parkedPose.x = car.x;
		parkedPose.y = car.y;
		parkedPose.z = car.z;
		parkedPose.yaw = car.yaw;
		writeRow(parkedParts, row, parkedPose, 1);
	});
	for (const { batch } of parkedParts) batch.markDirty();

	const vehiclePose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const personPose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
	const personScratch: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

	const update = (seconds: number): void => {
		for (let k = 0; k < carMovers.length; k++) {
			const mover = carMovers[k] as BoundMover<VehicleActor>;
			vehicleAt(mover.actor, seconds, vehiclePose);
			writeRow(mover.parts, mover.row, vehiclePose, 1);
		}
		for (let k = 0; k < busMovers.length; k++) {
			const mover = busMovers[k] as BoundMover<VehicleActor>;
			vehicleAt(mover.actor, seconds, vehiclePose);
			writeRow(mover.parts, mover.row, vehiclePose, 1);
		}
		for (let k = 0; k < personMovers.length; k++) {
			const mover = personMovers[k] as BoundMover<PersonActor>;
			const state = sampleScript(mover.actor.script, seconds + mover.actor.phase, SCRIPT_STATE);
			poseAlong(
				mover.actor.walk,
				state.distance,
				mover.actor.lateral,
				false,
				personPose,
				personScratch,
			);
			if (!state.forward) personPose.yaw += Math.PI;
			writeRow(mover.parts, mover.row, personPose, state.hidden ? 0 : 1);
		}
	};
	update(0);

	const carParts = carMovers[0]?.parts.length ?? 0;
	const busParts = busMovers[0]?.parts.length ?? 0;
	const personParts = personMovers[0]?.parts.length ?? 0;
	const batchCount =
		parkedParts.length +
		(carMovers.length > 0 ? carParts : 0) +
		(busMovers.length > 0 ? busParts : 0) +
		(personMovers.length > 0 ? personParts : 0);
	const rowCount =
		plan.parked.length * parkedParts.length +
		carMovers.length * carParts +
		busMovers.length * busParts +
		personMovers.length * personParts;
	return { update, counts: plan.counts, rows: rowCount, batches: batchCount };
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
		person: [
			{
				mesh: ctx.geometry.capsule({ radius: 0.26, height: 1.05 }),
				material: cloth,
				lift: PERSON_LIFT,
			},
		],
	};
}

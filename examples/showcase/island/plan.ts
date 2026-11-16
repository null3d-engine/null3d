// The island's stored plan: the roads and house plots that write-layout.ts laid out, which every
// device loads the same. Around them this module bakes the final ground and places the worked terraces
// with their olives, the strands of cypress, the umbrella pines by the coast and the closed forest over
// the rest. Nothing stands on a road, in a plot or too close to its own kind.
import { random } from '../../lib/procedural';
import {
	bake,
	CELL,
	CHURCH_AT,
	cellAt,
	clumps,
	edgeGrid,
	fromCell,
	groundHeight,
	inCore,
	inWorld,
	LOOKUP,
	type Lot,
	lookupKey,
	natural,
	onHilltop,
	rasterAll,
	read,
	roadEdge,
	SIDE,
	SQUARE,
	slopeAt,
	TERRACE_RISE,
	type Tread,
	toCell,
	worked,
} from './ground';
import {
	BAY,
	beachShare,
	GOLF,
	GROUND,
	golfShare,
	harbourShare,
	hypot,
	inland,
	naturalHeight,
	northOfRidge,
	onOutcrop,
	townShare,
	VILLAGES,
} from './island';
import { HOUSE_KINDS } from './kit';
import LAYOUT from './layout.json';
import { PARKS, type Road, type RoadPoint } from './routes';

export {
	CHURCH_AT,
	circleRadius,
	FEWEST_ON_LANE,
	groundHeight,
	KEEPS,
	type Lot,
	MOST_OFF_FORM,
	MOST_OFF_GROUND,
	NEIGHBOUR,
	roadEdge,
	SQUARE,
	STEEPEST_DRIVE,
	slopeAt,
	stairTreads,
	WALL_EDGE,
} from './ground';

/** The tree kinds, as the scene's plant records number them. */
export const CYPRESS = 0;
export const UMBRELLA = 1;
export const OLIVE = 2;
export const OAK = 3;

/** One tree: its kind, its place, its turn and its size. */
export interface TreeSpot {
	kind: number;
	x: number;
	y: number;
	z: number;
	turn: number;
	scale: number;
}

/** One stretch of a terrace's dry stone wall, along the contour. */
export interface TerraceWall {
	ax: number;
	ay: number;
	az: number;
	bx: number;
	by: number;
	bz: number;
}

/** A shrub or a climbing flower: its place and size, and whether it is in flower. */
export interface ShrubSpot {
	x: number;
	y: number;
	z: number;
	scale: number;
	flower: boolean;
}

/**
 * Each golf hole: its stations in the course's own meters, each with its half width. The fairways wind
 * between belts of trees.
 */
export const HOLES: readonly (readonly (readonly [number, number, number])[])[] = [
	[
		[-125, 52, 9],
		[-85, 44, 14],
		[-40, 62, 17],
		[10, 56, 16],
		[52, 34, 11],
	],
	[
		[-128, -8, 9],
		[-90, -20, 13],
		[-48, -6, 15],
		[-12, 8, 13],
	],
	[
		[-92, -62, 9],
		[-48, -74, 13],
		[6, -66, 15],
		[50, -50, 12],
	],
	[
		[46, -6, 9],
		[84, -22, 13],
		[118, -14, 12],
		[136, 18, 9],
	],
];

/** The distance from a point to a chain of stations' edge, in meters, below 0 on it. */
export function holeEdge(x: number, z: number): number {
	const [u, v] = [x - GOLF.x, z - GOLF.z];
	let best = Number.POSITIVE_INFINITY;
	for (const stations of HOLES)
		for (let k = 0; k + 1 < stations.length; k++) {
			const [ax, az, aw] = stations[k] as readonly [number, number, number];
			const [bx, bz, bw] = stations[k + 1] as readonly [number, number, number];
			const [dx, dz] = [bx - ax, bz - az];
			const t = Math.min(1, Math.max(0, ((u - ax) * dx + (v - az) * dz) / (dx * dx + dz * dz)));
			best = Math.min(best, hypot(u - (ax + dx * t), v - (az + dz * t)) - (aw + (bw - aw) * t));
		}
	return best;
}

/** Decodes the stored plan. */
function decodeLayout(): {
	roads: Road[];
	lots: Lot[];
	stairs: Tread[][];
} {
	const toPoints = (flat: readonly number[]): RoadPoint[] => {
		const points: RoadPoint[] = [];
		for (let k = 0; k + 2 < flat.length; k += 3)
			points.push({
				x: (flat[k] as number) / 100,
				y: (flat[k + 1] as number) / 1000,
				z: (flat[k + 2] as number) / 100,
			});
		return points;
	};
	const roads = LAYOUT.roads.map(
		({ half, end, radius, points }): Road => ({
			half,
			end: end as Road['end'],
			radius,
			points: toPoints(points),
		}),
	);
	const stairs = LAYOUT.stairs.map(toPoints);
	// A house on a village's crown opens on its stair, which stands in for a road.
	const every = [
		...roads,
		...stairs.map((points): Road => ({ points, half: 0.8, end: 'path', radius: 0 })),
	];
	const lots = LAYOUT.lots.map((f): Lot => {
		const road = every[f[6] as number] as Road;
		return {
			x: (f[0] as number) / 100,
			y: (f[1] as number) / 100,
			z: (f[2] as number) / 100,
			yaw: (f[3] as number) / 10000,
			kind: f[4] as number,
			garden: f[5] as number,
			road,
			gate: road.points[f[7] as number] as RoadPoint,
			plot: [(f[8] as number) / 100, (f[9] as number) / 100, (f[10] as number) / 100],
			reach: (f[11] as number) / 100,
			tone: (f[12] as number) / 1000,
		};
	});
	for (const points of stairs) reachRoad(points, roads);
	return { roads, lots, stairs };
}

/** Lengthens a stair at its foot, in level steps of about this many meters, until it stands on its road. */
const STAIR_FOOT_STEP = 1.5;

/** Runs a stair's foot on to the edge of the nearest road, so no grass lies between them. */
function reachRoad(points: { x: number; y: number; z: number }[], roads: readonly Road[]): void {
	const foot = points[0] as { x: number; y: number; z: number };
	let [nearest, reach, half] = [foot as { x: number; y: number; z: number }, Infinity, 0];
	for (const road of roads)
		for (const p of road.points) {
			const d = hypot(p.x - foot.x, p.z - foot.z) - road.half;
			if (d < reach) [nearest, reach, half] = [p, d, road.half];
		}
	if (reach <= 0) return;
	const whole = reach + half;
	const steps = Math.ceil((reach + 0.3) / STAIR_FOOT_STEP);
	for (let k = 1; k <= steps; k++) {
		const t = (k / steps) * ((reach + 0.3) / whole);
		points.unshift({
			x: foot.x + (nearest.x - foot.x) * t,
			y: foot.y + (nearest.y - foot.y) * t,
			z: foot.z + (nearest.z - foot.z) * t,
		});
	}
}

/** The stored plan, decoded: a house names its road and gate. */
const decoded = decodeLayout();
/** The finished road network. */
export const ROADS: readonly Road[] = decoded.roads;
/** The house plots, in the order the roads reach them. */
export const LOTS: readonly Lot[] = decoded.lots;
/** The stone stair from each village up to its hill's tower's door: its points, with their heights. */
export const STAIRS: readonly (readonly Tread[])[] = decoded.stairs;

rasterAll(ROADS);
bake(LOTS, STAIRS);

/** The plots near each cell of the lookup, which the trees read. */
const taken = new Uint8Array(SIDE * SIDE);
for (const lot of LOTS) {
	const [w, back, front] = lot.plot;
	const reach = hypot(w, Math.max(back, front)) + 3;
	const span = Math.ceil(reach / CELL);
	const [ci, cj] = [toCell(lot.x), toCell(lot.z)];
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	for (let j = Math.max(0, cj - span); j <= Math.min(SIDE - 1, cj + span); j++)
		for (let i = Math.max(0, ci - span); i <= Math.min(SIDE - 1, ci + span); i++) {
			const [dx, dz] = [fromCell(i) - lot.x, fromCell(j) - lot.z];
			const u = Math.abs(dx * c - dz * s);
			const v = dx * s + dz * c;
			if (u < w + 1.5 && v < front + 1.5 && v > -back - 1.5) taken[cellAt(i, j)] = 1;
		}
	// The drive stays clear of trees too.
	for (let t = 0; t <= 1; t += 0.1) {
		const [x, z] = [lot.gate.x + (lot.x - lot.gate.x) * t, lot.gate.z + (lot.z - lot.gate.z) * t];
		for (const [ox, oz] of [
			[0, 0],
			[2, 0],
			[-2, 0],
			[0, 2],
			[0, -2],
		] as const) {
			const [i, j] = [toCell(x + ox), toCell(z + oz)];
			if (i >= 0 && j >= 0 && i < SIDE && j < SIDE) taken[cellAt(i, j)] = 1;
		}
	}
}

/** Whether a place's ground is taken by a plot or a drive. */
function inPlot(x: number, z: number): boolean {
	const [i, j] = [toCell(x), toCell(z)];
	return i >= 0 && j >= 0 && i < SIDE && j < SIDE && taken[cellAt(i, j)] === 1;
}

/** True where the ground keeps clear of every tree: water, fairways, the beach, the square and lawns. */
/** Whether a point lies on or beside a village's stone stair. */
function onStair(x: number, z: number): boolean {
	return STAIRS.some((stair) => stair.some((p) => Math.abs(p.x - x) + Math.abs(p.z - z) < 3));
}

/** Whether a point lies in the opening toward the bay that only the first park's low trees stand in. */
function inParkView(x: number, z: number): boolean {
	const [px, pz] = PARKS[0] as readonly [number, number, number];
	const [dx, dz] = [x - px, z - pz];
	const d = hypot(dx, dz);
	if (d > 170) return false;
	const toBay = Math.atan2(BAY.z - pz, BAY.x - px);
	const off = Math.atan2(dz, dx) - toBay;
	return Math.cos(off) > 0.8;
}

function open(x: number, z: number): boolean {
	const d = inland(x, z);
	return (
		d < 5 ||
		(harbourShare(x, z) > 0.6 && d < 26) ||
		(golfShare(x, z) > 0.02 && holeEdge(x, z) < 5) ||
		inCore(x, z) ||
		(beachShare(x, z) > 0.2 && d < 58) ||
		PARKS.some(([px, pz, r]) => hypot(x - px, z - pz) < r * 0.62) ||
		onStair(x, z)
	);
}

/** The dry stone walls of the terraces. */
export const TERRACES: TerraceWall[] = [];
/** The meters of terrace wall to each olive, and the least gap between them, in meters. */
const TERRACE_OLIVE_RUN = 4.5;
const TERRACE_OLIVE_GAP = 3.8;
/** The olive trees' places along the terraces. */
const TERRACE_OLIVES: [number, number][] = [];

/** The shortest joined run of terrace wall that stands, in meters. */
const SHORTEST_TERRACE = 12;

/** The stretches of the joined runs of terrace wall that reach the shortest length. */
function longTerraceChains(stretches: readonly TerraceWall[]): TerraceWall[] {
	const parent = stretches.map((_, k) => k);
	const root = (k: number): number => {
		let at = k;
		while (parent[at] !== at) {
			parent[at] = parent[parent[at] as number] as number;
			at = parent[at] as number;
		}
		return at;
	};
	// Two stretches join where their ends meet, at the same height.
	const ends = new Map<string, number>();
	stretches.forEach(({ ax, ay, az, bx, bz }, k) => {
		for (const [x, z] of [
			[ax, az],
			[bx, bz],
		] as const) {
			const key = `${Math.round(x * 2)},${Math.round(z * 2)},${Math.round(ay * 10)}`;
			const other = ends.get(key);
			if (other === undefined) ends.set(key, k);
			else parent[root(k)] = root(other);
		}
	});
	const lengths = new Map<number, number>();
	stretches.forEach(({ ax, az, bx, bz }, k) => {
		const r = root(k);
		lengths.set(r, (lengths.get(r) ?? 0) + hypot(bx - ax, bz - az));
	});
	return stretches.filter((_, k) => (lengths.get(root(k)) as number) >= SHORTEST_TERRACE);
}

// Each cell of a grid adds the contour lines that cross it on a worked slope. A stretch keeps clear of
// roads and plots, and of ground too steep to hold a level step.
(() => {
	const step = 4;
	const count = Math.floor(GROUND / step);
	let spare = 0;
	for (let j = 0; j < count; j++)
		for (let i = 0; i < count; i++) {
			const [x, z] = [i * step - GROUND / 2, j * step - GROUND / 2];
			const [h0, h1, h2, h3] = [
				read(natural, x, z),
				read(natural, x + step, z),
				read(natural, x + step, z + step),
				read(natural, x, z + step),
			];
			const [lo, hi] = [Math.min(h0, h1, h2, h3), Math.max(h0, h1, h2, h3)];
			if (lo < 6 || hi - lo < 0.25 || !worked(x + step / 2, z + step / 2)) continue;
			for (
				let level = Math.ceil(lo / TERRACE_RISE) * TERRACE_RISE;
				level < hi;
				level += TERRACE_RISE
			) {
				const crossings: [number, number][] = [];
				const edge = (a: number, b: number, ax: number, az: number, bx: number, bz: number) => {
					if (a < level === b < level) return;
					const t = (level - a) / (b - a);
					crossings.push([ax + (bx - ax) * t, az + (bz - az) * t]);
				};
				edge(h0, h1, x, z, x + step, z);
				edge(h1, h2, x + step, z, x + step, z + step);
				edge(h2, h3, x + step, z + step, x, z + step);
				edge(h3, h0, x, z + step, x, z);
				const [p, q] = crossings as [[number, number] | undefined, [number, number] | undefined];
				if (!p || !q) continue;
				const [mx, mz] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
				if (read(edgeGrid, mx, mz) < 5 || inPlot(mx, mz) || slopeAt(mx, mz) > 1.3) continue;
				// Where a road's or a plot's bank has moved the ground, no terrace wall stands.
				if (Math.abs(groundHeight(mx, mz) - level) > TERRACE_RISE) continue;
				TERRACES.push({
					ax: p[0],
					ay: level - TERRACE_RISE * 0.4,
					az: p[1],
					bx: q[0],
					by: level - TERRACE_RISE * 0.4,
					bz: q[1],
				});
			}
		}
	// A short piece of wall reads as a stray stub, so only the joined runs of some length stand.
	const kept = longTerraceChains(TERRACES);
	TERRACES.length = 0;
	TERRACES.push(...kept);
	// An olive stands every few stretches, a little behind the wall.
	for (const { ax, az, bx, bz } of TERRACES) {
		spare += hypot(bx - ax, bz - az);
		if (spare > TERRACE_OLIVE_RUN) {
			spare = 0;
			TERRACE_OLIVES.push([(ax + bx) / 2, (az + bz) / 2]);
		}
	}
})();

/** The share of a village's ground that holds an olive in place of the forest. */
const VILLAGE_OLIVES = 0.5;
/** Around each tower, the knob planted close with trees, in meters from the tower and as a share of the village's radius, and the cypress among them. */
const KNOB_FROM = 11;
const KNOB_REACH = 0.8;
const KNOB_CYPRESS = 0.22;
const KNOB_GAP = 2.8;
/** The steepest ground north of the ridge that holds forest, as a rise over a run. */
const NORTH_FOREST_SLOPE = 4.5;

/** The height of a fold of the land that counts in full as a gully or a ridge, in meters. */
const FOLD_DEPTH = 5;
/** How far a fold is read across, in meters. */
const FOLD_RUN = 30;
/** How much the land around a place stands above it. */
const around = (x: number, z: number) =>
	(read(natural, x + FOLD_RUN, z) +
		read(natural, x - FOLD_RUN, z) +
		read(natural, x, z + FOLD_RUN) +
		read(natural, x, z - FOLD_RUN)) /
	4;

/** The steepest ground south of the ridge that holds forest, as a rise over a run. */
const FOREST_SLOPE = 2.6;
/** How far down the slope from a hillside house tall trees keep off, in meters, so it shows from the sea. */
const VIEW_RUN = 20;
/** The height from which a house stands on the hillside, and keeps its view, in meters. */
const VIEW_FROM = 25;

/** The cells that hold a terrace's wall or stand within a few meters of one. */
const terraced = new Uint8Array(SIDE * SIDE);
for (const { ax, az } of TERRACES) {
	const [ci, cj] = [toCell(ax), toCell(az)];
	for (let j = cj - 3; j <= cj + 3; j++)
		for (let i = ci - 3; i <= ci + 3; i++) terraced[cellAt(i, j)] = 1;
}
const terracedAt = (x: number, z: number) => terraced[cellAt(toCell(x), toCell(z))] === 1;

/** The cells on the downhill side of each hillside house, where tall trees would hide it. */
const viewed = new Uint8Array(SIDE * SIDE);
for (const lot of LOTS) {
	if (lot.y < VIEW_FROM) continue;
	const e = 6;
	const [gx, gz] = [
		read(natural, lot.x + e, lot.z) - read(natural, lot.x - e, lot.z),
		read(natural, lot.x, lot.z + e) - read(natural, lot.x, lot.z - e),
	];
	const length = hypot(gx, gz) || 1;
	const [dx, dz] = [-gx / length, -gz / length];
	const wide = lot.plot[0] + 4;
	for (let run = 0; run <= VIEW_RUN + lot.plot[2]; run += CELL)
		for (let w = -wide; w <= wide; w += CELL) {
			const [i, j] = [toCell(lot.x + dx * run - dz * w), toCell(lot.z + dz * run + dx * w)];
			if (i >= 0 && j >= 0 && i < SIDE && j < SIDE) viewed[cellAt(i, j)] = 1;
		}
}
const inView = (x: number, z: number) =>
	viewed[cellAt(toCell(x), toCell(z))] === 1 || inParkView(x, z);

/** The most trees that the plan places, for the highest preset. */
export const MOST_TREES = 60000;
/** How far a tree's trunk stands from a terrace wall, and the side of the grid of those walls, in meters. */
const TRUNK_CLEAR = 0.8;
const WALL_GRID = 8;
/** The slope past which the golf course's ground grows scrub, as rise over run. */
const BANK_SCRUB = 0.26;
/** How far a tree's trunk stands from a bunker's edge, in meters. */
const BUNKER_CLEAR = 4;

/** The places that a hole may hold a bunker: x, z, radius and turn. */
export function bunkerSpots(
	stations: readonly (readonly [number, number, number])[],
): readonly (readonly [number, number, number, number])[] {
	const end = stations[stations.length - 1] as readonly [number, number, number];
	const first = stations[0] as readonly [number, number, number];
	const mid = stations[Math.floor(stations.length / 2)] as readonly [number, number, number];
	const [gx, gz] = [GOLF.x + end[0], GOLF.z + end[1]];
	const [dx, dz] = [end[0] - first[0], end[1] - first[1]];
	const length = hypot(dx, dz);
	const [nx, nz] = [-dz / length, dx / length];
	return [
		[gx + nx * 21, gz + nz * 21, 7.5, 0.4],
		[gx - nx * 20 - (dx / length) * 6, gz - nz * 20 - (dz / length) * 6, 8.5, 1.1],
		[GOLF.x + mid[0] + nx * (mid[2] + 6), GOLF.z + mid[1] + nz * (mid[2] + 6), 9, 2],
		[GOLF.x + mid[0] - nx * (mid[2] + 6) + 16, GOLF.z + mid[1] - nz * (mid[2] + 6), 7.5, 0.7],
	];
}

/** Whether a place lies in or beside a bunker, where no tree stands. */
function inBunker(x: number, z: number): boolean {
	return HOLES.some((stations) =>
		bunkerSpots(stations).some(([bx, bz, r]) => hypot(x - bx, z - bz) < r * 1.4 + BUNKER_CLEAR),
	);
}

/** The terrace walls by a coarse grid, for the search of the nearest. */
const wallsByCell = (() => {
	const cells = new Map<number, TerraceWall[]>();
	for (const wall of TERRACES) {
		const steps = Math.ceil(hypot(wall.bx - wall.ax, wall.bz - wall.az) / WALL_GRID);
		for (let t = 0; t <= steps; t++) {
			const key = lookupKey(
				wall.ax + ((wall.bx - wall.ax) * t) / steps,
				wall.az + ((wall.bz - wall.az) * t) / steps,
			);
			const list = cells.get(key);
			if (!list) cells.set(key, [wall]);
			else if (!list.includes(wall)) list.push(wall);
		}
	}
	return cells;
})();

/** The terrace wall nearest a place, within a cell of the search's grid: how far it lies, and which way. */
function nearestTerraceWall(x: number, z: number): { d: number; nx: number; nz: number } {
	let best = { d: Number.POSITIVE_INFINITY, nx: 0, nz: 0 };
	for (let i = -1; i <= 1; i++)
		for (let j = -1; j <= 1; j++)
			for (const w of wallsByCell.get(lookupKey(x + i * LOOKUP, z + j * LOOKUP)) ?? []) {
				const [dx, dz] = [w.bx - w.ax, w.bz - w.az];
				const t = Math.max(
					0,
					Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz || 1)),
				);
				const [ox, oz] = [x - w.ax - dx * t, z - w.az - dz * t];
				const d = hypot(ox, oz);
				if (d < best.d) best = { d, nx: d ? ox / d : 0, nz: d ? oz / d : 0 };
			}
	return best;
}

/** A place moved just clear of the terrace wall it stands on, so a tree's trunk does not rise through it. */
function offTerraceWall(x: number, z: number): readonly [number, number] {
	const { d, nx, nz } = nearestTerraceWall(x, z);
	if (d >= TRUNK_CLEAR) return [x, z];
	// A place on the wall's own line goes to the side that lies lower, the terrace in front of the wall.
	const [ax, az] = nx === 0 && nz === 0 ? [1, 0] : [nx, nz];
	const push = TRUNK_CLEAR * 1.5 - d;
	return [x + ax * push, z + az * push];
}

/**
 * The view from above the hill park: over its gazebo and down the slope to the town and the bay, framed
 * by the trees on each side. The eye, the way it looks in x and z, and how far and how wide the clearing
 * runs, in meters.
 */
export const PARK_VIEW = {
	x: -57,
	z: -260,
	dx: 0.48,
	dz: 0.877,
	reach: 170,
	near: 6,
	spread: 0.2,
} as const;

/** Whether a place lies on the sight line from above the hill park, where no tree stands. */
function inParkSightLine(x: number, z: number): boolean {
	const { x: ex, z: ez, dx, dz, reach, near, spread } = PARK_VIEW;
	const along = (x - ex) * dx + (z - ez) * dz;
	if (along < -6 || along > reach) return false;
	return Math.abs((x - ex) * dz - (z - ez) * dx) < near + Math.max(0, along) * spread;
}

/** The trees. A preset draws a share of each. */
export const TREE_SPOTS: readonly TreeSpot[] = (() => {
	// Each group of trees draws from a seed of its own place, so a change to a house moves the trees
	// beside it and no others.
	let next = random(631);
	const seedAt = (a: number, b: number) => {
		next = random(Math.imul(Math.round(a), 73856093) ^ Math.imul(Math.round(b), 19349663));
	};
	const spots: TreeSpot[] = [];
	const near = new Map<number, TreeSpot[]>();
	const SIZE = [
		[0.85, 1.35],
		[0.85, 1.3],
		[0.8, 1.2],
		[1.15, 1.85],
	] as const;
	const add = (kind: number, x: number, z: number, gap: number): boolean => {
		if (spots.length >= MOST_TREES || open(x, z)) return false;
		if (kind !== OLIVE && inView(x, z)) return false;
		if (inParkSightLine(x, z)) return false;
		if (read(edgeGrid, x, z) < 1.1 || inPlot(x, z) || inBunker(x, z)) return false;
		if (nearestTerraceWall(x, z).d < TRUNK_CLEAR) return false;
		const y = groundHeight(x, z);
		if (y < 2 || slopeAt(x, z) > 5) return false;
		for (let i = -1; i <= 1; i++)
			for (let j = -1; j <= 1; j++)
				for (const s of near.get(lookupKey(x + i * LOOKUP, z + j * LOOKUP)) ?? [])
					if (hypot(x - s.x, z - s.z) < gap) return false;
		const size = SIZE[kind as 0];
		const own = random(
			Math.imul(Math.round(x * 10), 83492791) ^ Math.imul(Math.round(z * 10), 2654435),
		);
		const spot = {
			kind,
			x,
			y: y - 0.15,
			z,
			turn: own() * Math.PI * 2,
			scale: size[0] + (size[1] - size[0]) * own(),
		};
		spots.push(spot);
		const key = lookupKey(x, z);
		const list = near.get(key);
		if (list) list.push(spot);
		else near.set(key, [spot]);
		return true;
	};
	// Big shade trees stand in the square's beds, and cypresses at the church's sides.
	for (const [ox, oz, scale] of [
		[-13, -5, 1.45],
		[13, -6, 1.5],
		[-14, 11, 1.35],
		[14, 11, 1.4],
	] as const)
		spots.push({
			kind: OAK,
			x: SQUARE.x + ox,
			y: groundHeight(SQUARE.x + ox, SQUARE.z + oz) - 0.1,
			z: SQUARE.z + oz,
			turn: next() * 6.3,
			scale,
		});
	for (const side of [-1, 1])
		for (const k of [0, 1, 2]) {
			const [x, z] = [CHURCH_AT.x + side * 16.5, CHURCH_AT.z + 8 - k * 7];
			spots.push({
				kind: CYPRESS,
				x,
				y: groundHeight(x, z) - 0.1,
				z,
				turn: next() * 6.3,
				scale: 1.1,
			});
		}
	// The houses have their own trees just outside their walls, the tall ones at the back corners.
	for (const lot of LOTS) {
		if (lot.garden < 0) continue;
		seedAt(lot.x * 100, lot.z * 100);
		const [w, back] = lot.plot;
		const pick = next();
		if (pick < 0.55) {
			const side = next() < 0.5 ? 1 : -1;
			for (const v of [-back - 3, -back + 1, lot.plot[2] - 3]) {
				const [x, z] = inWorld(lot, side * (w + 3.2), v);
				add(CYPRESS, x, z, 3.2);
			}
		} else {
			const [x, z] = inWorld(lot, (next() - 0.5) * w * 2, -back - 5);
			add(next() < 0.5 ? OLIVE : OAK, x, z, 6);
		}
	}
	for (const [x, z] of TERRACE_OLIVES) {
		seedAt(x * 100, z * 100);
		const [ox, oz] = offTerraceWall(x + (next() - 0.5) * 1.2, z + (next() - 0.5) * 1.2);
		add(OLIVE, ox, oz, TERRACE_OLIVE_GAP);
	}
	// Strands of dark cypress stand across the settled slopes.
	for (let group = 0; group < 90 && spots.length < MOST_TREES; group++) {
		seedAt(group, 1);
		const x = (next() * 2 - 1) * 680;
		const z = -60 - next() * 360;
		if (inland(x, z) < 30) continue;
		const a = next() * Math.PI * 2;
		const size = 10 + Math.floor(next() * 20);
		for (let k = 0; k < size; k++) {
			const line = (k % 7) * 4.2;
			const row = Math.floor(k / 7) * 4.5;
			add(
				CYPRESS,
				x + Math.cos(a) * line - Math.sin(a) * row,
				z + Math.sin(a) * line + Math.cos(a) * row,
				3,
			);
		}
	}
	// Cypresses line stretches of the lanes.
	for (const road of ROADS) {
		if (townShare((road.points[0] as RoadPoint).x, (road.points[0] as RoadPoint).z) > 0.5) continue;
		for (let k = 2; k + 2 < road.points.length; k += 2) {
			const p = road.points[k] as RoadPoint;
			const q = road.points[k + 2] as RoadPoint;
			if (clumps.fbm2(p.x * 0.014 + 40, p.z * 0.014, 2) < 0.14) continue;
			const along = Math.atan2(q.z - p.z, q.x - p.x);
			const off = road.half + 3.2;
			add(CYPRESS, p.x + Math.sin(along) * off, p.z - Math.cos(along) * off, 5);
		}
	}
	// Umbrella pines stand along the coast and around the bay, in loose groups, with belts on the golf.
	for (let i = -130; i <= 130; i++)
		for (let j = -90; j <= 90; j++) {
			seedAt(i + 1000, j);
			const x = i * 8 + (next() - 0.5) * 6;
			const z = j * 8 + (next() - 0.5) * 6;
			const d = inland(x, z);
			if (d < 8) continue;
			const golf = golfShare(x, z) > 0.02;
			if (golf) {
				if (next() < 0.45) add(next() < 0.35 ? UMBRELLA : next() < 0.6 ? CYPRESS : OAK, x, z, 10);
				continue;
			}
			const bay =
				Math.abs(hypot(x - BAY.x, z - BAY.z) - BAY.radius - 90) < 28 && beachShare(x, z) > 0.1;
			if (bay || (d < 70 && clumps.fbm2(x * 0.014 + 60, z * 0.014, 2) > 0.12 && next() < 0.6))
				add(UMBRELLA, x, z, 15);
		}
	// The town's yards hold a tree among the houses.
	for (let i = -40; i <= 22; i++)
		for (let j = 6; j <= 34; j++) {
			seedAt(i + 2000, j);
			const [x, z] = [i * 10 + (next() - 0.5) * 7, j * 10 + (next() - 0.5) * 7];
			if (townShare(x, z) > 0.2 && next() < 0.8)
				add(next() < 0.25 ? CYPRESS : next() < 0.5 ? OLIVE : OAK, x, z, 5);
		}
	// A closed forest of dark oak and cypress fills all the rest of the land above the town, with a
	// small clearing here and there. It reaches every place once, by a jittered grid.
	const across = 4.2;
	for (let i = -190; i <= 190; i++)
		for (let j = -143; j <= 126; j++) {
			seedAt(i + 3000, j);
			const x = i * across + (next() - 0.5) * 3.4;
			const z = j * across + (next() - 0.5) * 3.4;
			if (inland(x, z) < 9 || townShare(x, z) > 0.12 || golfShare(x, z) > 0.02) continue;
			if (onOutcrop(x, z) && next() < 0.85) continue;
			// A village stands in the open, with only a tree here and there among its houses. The knob under
			// its tower is wooded, so it reads as a green crown and not as bare earth.
			if (onHilltop(x, z)) {
				const pick = next();
				const onKnob = VILLAGES.some(([vx, vz, , radius]) => {
					const r = hypot(x - vx, z - vz);
					return r > KNOB_FROM && r < radius * KNOB_REACH;
				});
				if (onKnob) add(pick < KNOB_CYPRESS ? CYPRESS : OLIVE, x, z, KNOB_GAP);
				else if (pick < VILLAGE_OLIVES) add(OLIVE, x, z, 4.5);
				continue;
			}
			if (terracedAt(x, z) && next() < 0.97) continue;
			// The forest stands on all but the steepest rock, with a clearing only here and there.
			const north = northOfRidge(x, z);
			if (slopeAt(x, z) > (north ? NORTH_FOREST_SLOPE : FOREST_SLOPE)) continue;
			if (!north && clumps.fbm2(x * 0.03 + 9, z * 0.03, 2) > 0.48) continue;
			const dark = clumps.fbm2(x * 0.018, z * 0.018 + 70, 2);
			const pick = next();
			const high = naturalHeight(x, z);
			// Dark cypress fills the gullies, and paler olive covers the ridges.
			const fold = (around(x, z) - read(natural, x, z)) / FOLD_DEPTH;
			const cypressShare = Math.max(
				0.05,
				Math.min(0.85, (dark > 0.08 ? 0.45 : high > 90 ? 0.22 : 0.1) + fold),
			);
			const oliveShare = Math.max(0, Math.min(0.5, -fold * 0.8));
			if (pick < cypressShare) add(CYPRESS, x, z, 2.6);
			else if (pick < cypressShare + oliveShare) add(OLIVE, x, z, 4.5);
			else add(OAK, x, z, 3.4);
		}
	return spots;
})();

/** The side of a cell of the far canopy's grid, in meters, and how far from a house's plot it stays. */
const FILL_CELL = 5;

/**
 * The far canopy: trees that show only from afar, as cards, so the slopes read as closed forest from
 * above for little cost. Close up, the plan's full trees stand on their own. Below a house on a hillside
 * only low ones stand, so its roof still shows from the sea.
 */
export const FILL_SPOTS: readonly TreeSpot[] = (() => {
	const next = random(733);
	const spots: TreeSpot[] = [];
	const across = Math.ceil(GROUND / 2 / FILL_CELL);
	for (let i = -across; i <= across; i++)
		for (let j = -across; j <= across; j++) {
			const x = i * FILL_CELL + (next() - 0.5) * 5;
			const z = j * FILL_CELL + (next() - 0.5) * 5;
			const pick = next();
			const turn = next() * Math.PI * 2;
			const size = next();
			if (inland(x, z) < 10 || townShare(x, z) > 0.12 || golfShare(x, z) > 0.02) continue;
			if (open(x, z) || inPlot(x, z) || terracedAt(x, z) || read(edgeGrid, x, z) < 2.5) continue;
			const y = groundHeight(x, z);
			if (y < 2 || slopeAt(x, z) > 4.5 || onHilltop(x, z)) continue;
			const fold = (around(x, z) - read(natural, x, z)) / FOLD_DEPTH;
			const kind = pick < 0.2 + fold * 0.6 ? CYPRESS : pick > 0.85 + fold ? OLIVE : OAK;
			if (inParkSightLine(x, z)) continue;
			const low = inView(x, z);
			spots.push({
				kind: low ? OLIVE : kind,
				x,
				y: y - 0.15,
				z,
				turn,
				scale: low ? 0.8 : 1 + size * 0.5,
			});
		}
	return spots;
})();

/**
 * The spots that stand at a share of the plan, each by a hash of its place in the list, so a larger
 * share keeps every spot of a smaller one and quality levels only ever add trees.
 */
export function standing<T>(spots: readonly T[], share: number): T[] {
	return spots.filter((_, k) => {
		let h = Math.imul(k + 1, 2654435761);
		h = Math.imul(h ^ (h >>> 15), 1540483477);
		return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32 < share;
	});
}

/** How far a house's door may stand from a road's edge with no strip drawn between them, in meters. */
export const HOUSE_ON_ROAD = 3;

/** A house's door: the middle of the front of its house. */
export function doorOf(lot: Lot): { x: number; z: number } {
	const depth = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
	return { x: lot.x + Math.sin(lot.yaw) * depth, z: lot.z + Math.cos(lot.yaw) * depth };
}

/**
 * The drawn strip from a house's road to its door, as points from the road's edge, or undefined for an
 * attached house whose door opens on the road. Every house of the country has one, and so has an
 * attached house set back from its road.
 */
export function wayOf(lot: Lot): { x: number; y: number; z: number }[] | undefined {
	const door = doorOf(lot);
	if (lot.garden < 0 && roadEdge(door.x, door.z) <= HOUSE_ON_ROAD) return undefined;
	const run = hypot(door.x - lot.gate.x, door.z - lot.gate.z) || 1;
	const t = Math.min(0.9, (lot.road.half + 0.5) / run);
	return [
		{
			x: lot.gate.x + (door.x - lot.gate.x) * t,
			y: lot.gate.y + (lot.y - lot.gate.y) * t,
			z: lot.gate.z + (door.z - lot.gate.z) * t,
		},
		{ x: (door.x + lot.gate.x) / 2, y: (lot.y + lot.gate.y) / 2, z: (door.z + lot.gate.z) / 2 },
		{ x: door.x, y: lot.y, z: door.z },
	];
}

/** The cells of the ground's canopy grid, in meters, and how many trees close a cell. */
const CANOPY_CELL = 8;
const CANOPY_FULL = 1.2;
/** How much an olive counts toward closing a cell of the canopy, since its crown is small. */
const OLIVE_SHADE = 0.7;
const CANOPY_SIDE = Math.ceil(GROUND / CANOPY_CELL) + 1;

/** How much of the ground at each cell lies under trees, from 0 to 1, spread a little. */
const canopy = (() => {
	const count = new Float32Array(CANOPY_SIDE * CANOPY_SIDE);
	const cell = (v: number) => Math.round((v + GROUND / 2) / CANOPY_CELL);
	for (const list of [TREE_SPOTS, FILL_SPOTS])
		for (const { x, z, kind } of list) {
			const at = cell(z) * CANOPY_SIDE + cell(x);
			count[at] = (count[at] ?? 0) + (kind === OLIVE ? OLIVE_SHADE : 1);
		}
	const out = new Float32Array(count.length);
	for (let j = 1; j + 1 < CANOPY_SIDE; j++)
		for (let i = 1; i + 1 < CANOPY_SIDE; i++) {
			let sum = 0;
			for (let b = -1; b <= 1; b++)
				for (let a = -1; a <= 1; a++) sum += count[(j + b) * CANOPY_SIDE + i + a] as number;
			out[j * CANOPY_SIDE + i] = Math.min(1, sum / 9 / CANOPY_FULL);
		}
	return out;
})();

/** How much of the ground at a point lies under trees, from 0 to 1. */
export function canopyAt(x: number, z: number): number {
	const u = Math.min(CANOPY_SIDE - 1.001, Math.max(0, (x + GROUND / 2) / CANOPY_CELL));
	const v = Math.min(CANOPY_SIDE - 1.001, Math.max(0, (z + GROUND / 2) / CANOPY_CELL));
	const [i, j] = [Math.floor(u), Math.floor(v)];
	const [s, t] = [u - i, v - j];
	const at = j * CANOPY_SIDE + i;
	const top = (canopy[at] as number) * (1 - s) + (canopy[at + 1] as number) * s;
	const bottom =
		(canopy[at + CANOPY_SIDE] as number) * (1 - s) + (canopy[at + CANOPY_SIDE + 1] as number) * s;
	return top * (1 - t) + bottom * t;
}

/** The shrubs and climbing flowers of the plots and the roadsides. */
export const SHRUBS: readonly ShrubSpot[] = (() => {
	const next = random(211);
	const spots: ShrubSpot[] = [];
	const add = (x: number, z: number, scale: number, flower: boolean) => {
		if (read(edgeGrid, x, z) < 0.8 || inland(x, z) < 5) return;
		spots.push({ x, y: groundHeight(x, z) - 0.1, z, scale, flower });
	};
	for (const lot of LOTS) {
		const [w, back, front] = lot.plot;
		if (lot.garden < 0) continue;
		const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
		// Bushes run along the plot's walls and gather by the house.
		const count = 5 + Math.floor(next() * 7);
		for (let k = 0; k < count; k++) {
			const onSide = next() < 0.5;
			const u = onSide ? (next() < 0.5 ? -1 : 1) * (w - 1) : (next() * 2 - 1) * (w - 1);
			const v = onSide ? -back + next() * (back + front) : next() < 0.6 ? -back + 1 : front - 1;
			if (Math.abs(u) < hw + 0.8 && Math.abs(v) < hd + 0.8) continue;
			const [x, z] = inWorld(lot, u, v);
			add(x, z, 0.6 + next() * 0.9, false);
		}
	}
	// Scrub holds the golf course's bank, where no turf lies.
	for (let i = 0; i <= 80; i++)
		for (let j = 0; j <= 80; j++) {
			const [x, z] = [
				GOLF.x - 200 + i * 5 + (next() - 0.5) * 4,
				GOLF.z - 200 + j * 5 + (next() - 0.5) * 4,
			];
			const scale = 0.9 + next() * 1.1;
			if (golfShare(x, z) > 0.02 && slopeAt(x, z) > BANK_SCRUB) add(x, z, scale, false);
		}
	// The town's yards fill with shrubs between the houses.
	for (let i = -70; i <= 40; i++)
		for (let j = 12; j <= 56; j++) {
			const [x, z] = [i * 5 + (next() - 0.5) * 4, j * 5 + (next() - 0.5) * 4];
			if (townShare(x, z) < 0.15 || inPlot(x, z) || inCore(x, z) || read(edgeGrid, x, z) < 1.5)
				continue;
			if (next() < 0.55) add(x, z, 0.8 + next() * 1.1, false);
		}
	// Scrub grows along the lanes and thick under the forest's edge, the coast's rocks and open ground.
	for (const road of ROADS)
		for (let k = 3; k + 1 < road.points.length; k += 2) {
			const p = road.points[k] as RoadPoint;
			const q = road.points[k + 1] as RoadPoint;
			if (townShare(p.x, p.z) > 0.4 || next() < 0.4) continue;
			const along = Math.atan2(q.z - p.z, q.x - p.x);
			const side = next() < 0.5 ? 1 : -1;
			const off = road.half + 2.4 + next() * 3;
			add(
				p.x - Math.sin(along) * side * off,
				p.z + Math.cos(along) * side * off,
				0.7 + next() * 1,
				false,
			);
		}
	for (let i = -130; i <= 130; i++)
		for (let j = -90; j <= 90; j++) {
			const x = i * 6 + (next() - 0.5) * 5;
			const z = j * 6 + (next() - 0.5) * 5;
			const d = inland(x, z);
			if (d < 6 || townShare(x, z) > 0.3 || golfShare(x, z) > 0.02 || open(x, z) || inPlot(x, z))
				continue;
			// Scrub gathers in drifts, with open ground between them.
			const drift = onHilltop(x, z)
				? 0.95
				: clumps.fbm2(x * 0.022 + 13, z * 0.022 + 5, 2) > 0.02
					? 0.75
					: 0.1;
			if (next() < drift) add(x, z, 0.8 + next() * 1.4, false);
		}
	return spots;
})();

/** The fingerprint of the stored plan, which the plan tests and the browser test both hold it to. */
export const PLAN_FINGERPRINT = 563270395;

/**
 * A number that changes with any road, house, tree, wall or sample of the ground, to the millimeter. A
 * test holds it, in Bun and in a browser, so the plan that the tests pass is the plan that the viewer sees.
 */
export function planFingerprint(): number {
	let hash = 2166136261;
	const add = (value: number) => {
		hash = Math.imul(hash ^ (Math.round(value * 1000) | 0), 16777619) >>> 0;
	};
	for (const { points, half } of ROADS) {
		add(half);
		for (const { x, y, z } of points) {
			add(x);
			add(y);
			add(z);
		}
	}
	for (const { x, y, z, yaw, kind, garden } of LOTS)
		for (const v of [x, y, z, yaw, kind, garden]) add(v);
	for (const { kind, x, y, z } of [...TREE_SPOTS, ...FILL_SPOTS])
		for (const v of [kind, x, y, z]) add(v);
	for (const { x, y, z } of SHRUBS) for (const v of [x, y, z]) add(v);
	for (const { ax, ay, az } of TERRACES) for (const v of [ax, ay, az]) add(v);
	for (let x = -880; x <= 880; x += 40)
		for (let z = -880; z <= 880; z += 40) add(groundHeight(x, z));
	return hash;
}

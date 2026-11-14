// The island's final ground, baked on a grid from the land, the roads, the plots and the stairs. The
// stored plan and the tool that writes it both bake with this module, so the ground that the tool
// judges plots on is the ground that the viewer sees.
import { math } from '@null3d/engine';
import { Noise } from '../../lib/procedural';
import {
	beachShare,
	GROUND,
	golfShare,
	harbourShare,
	hypot,
	inland,
	naturalHeight,
	SUMMITS,
	townShare,
	VILLAGES,
} from './island';
import { HOUSE_KINDS } from './kit';
import { PARKS, type Road, type RoadPoint } from './routes';

/** A house plot: its middle, the way its front faces, its size and how many floors it has. */
export interface Lot {
	x: number;
	y: number;
	z: number;
	/** The turn about +y, in radians, that points the front at the road. */
	yaw: number;
	/** The house's kind, as `HOUSE_KINDS` numbers them. */
	kind: number;
	/** The garden's kind, as `GARDEN_KINDS` numbers them, or -1 for a house with no garden. */
	garden: number;
	/** The road that the house's drive reaches, and the point on it. */
	road: Road;
	gate: RoadPoint;
	/** The half width of the plot, how far it runs behind the middle, and how far in front of it. */
	plot: readonly [number, number, number];
	/** The radius that the house takes on the ground, in meters. */
	reach: number;
	/** A number from 0 to 1 that picks the house's colors. */
	tone: number;
}
/** One point of a stone stair. */
export type Tread = { x: number; y: number; z: number };

/** The church and the small square in front of it: the middle of each, and the square's half sizes. */
export const CHURCH_AT = { x: -92, z: 186 } as const;
export const SQUARE = { x: -92, z: 226, hx: 22, hz: 18 } as const;

/** The steepest bank that roads and plots may leave, as rise over run. */
export const STEEPEST_BANK = 0.42;
/** The radius of the turning circle at the end of a road of a half width. */
export const circleRadius = (half: number) => half + 4.5;

/** Half the width of a house's strip from its road to its door, in meters. */
export const WAY_HALF = 1.25;

/** The rise of one step of a stair, in meters. */
const STAIR_RISE = 0.18;
/** How far each side of a stair's line its bed of ground lies flat, the width of its bank, and how far under its treads the bed lies, in meters. */
const STAIR_BED = 2.4;
const STAIR_BANK = 6.5;
const STAIR_BURY = 0.2;

/** Each hill's tower, on its summit: its place and height. */
export const KEEPS: readonly (readonly [number, number, number])[] = SUMMITS.map(
	([sx, sz, top, radius]) => [sx, sz, top - radius * 0.02],
);

/** How near a road's edge a stair's bed may lie, in meters. */
const STAIR_EDGE = 1.5;

/** The treads of a stair, in order: each one's middle and height, a rise of a step above the one before. */
export function stairTreads(
	stair: readonly { x: number; y: number; z: number }[],
): { x: number; y: number; z: number; heading: number; run: number }[] {
	const first = stair[0] as { y: number };
	const last = stair[stair.length - 1] as { x: number; y: number; z: number };
	const steps = Math.max(2, Math.ceil((last.y - first.y) / STAIR_RISE));
	const treads: { x: number; y: number; z: number; heading: number; run: number }[] = [];
	let k = 0;
	for (let n = 0; n < steps; n++) {
		const y = first.y + ((last.y - first.y) * n) / steps;
		while (k + 2 < stair.length && (stair[k + 1] as { y: number }).y <= y) k++;
		const a = stair[k] as { x: number; y: number; z: number };
		const b = stair[k + 1] as { x: number; y: number; z: number };
		const t = (y - a.y) / (b.y - a.y);
		treads.push({
			x: a.x + (b.x - a.x) * t,
			y,
			z: a.z + (b.z - a.z) * t,
			heading: Math.atan2(b.z - a.z, b.x - a.x),
			run: 0,
		});
	}
	// A tread reaches to the one above it.
	treads.forEach((tread, n) => {
		const above = treads[n + 1] ?? last;
		const [x, z] = [above.x, above.z];
		tread.run = hypot(x - tread.x, z - tread.z);
	});
	return treads;
}

/** How far a pad reaches past its plot, in meters. */
export const PAD_MARGIN = 2.5;
/** The most that a house's floor may stand off the land's own form, in meters. */
export const MOST_OFF_FORM = 12;
/** How near a country house's nearest neighbour stands, in meters. */
export const NEIGHBOUR = 40;
/** The houses that a local road must serve for it to stay. */
export const FEWEST_ON_LANE = 3;
export const SHOULDER = 4;
/** The most that a road's bank may take on each side, in meters. */
const MOST_BANK = 20;
/** The side of a cell of the baked ground, its cells along a side, and the lookup's cell, in meters. */
export const CELL = 2;
export const SIDE = Math.ceil(GROUND / CELL) + 1;
export const LOOKUP = 40;
/** The most that a house's floor may stand off the ground under its corners, in meters. */
export const MOST_OFF_GROUND = 1;
/** The steepest grade of a drive, from the road to the door. */
export const STEEPEST_DRIVE = 0.13;

/** The least and most that a retaining wall holds, in meters, and how far past a road's edge it stands. */
export const WALL_LEAST = 1.5;
export const MOST_WALL = 4;
export const WALL_EDGE = 3.2;
/** The run over which a ground face is read, and the most height that a plot's pad may stand in one, in meters. */
const FACE_RUN = 4;
const MOST_FACE = 13;

const { smoothstep } = math;
export const clumps = new Noise(83);
const fine = new Noise(97);

export const cellAt = (i: number, j: number) => j * SIDE + i;
export const toCell = (v: number) => Math.round((v + GROUND / 2) / CELL);
export const fromCell = (i: number) => i * CELL - GROUND / 2;

/** How far each cell lies from the nearest road's edge, in meters, and that road's height. */
export const edgeGrid = new Float32Array(SIDE * SIDE);
export const roadHeight = new Float32Array(SIDE * SIDE);

/** Writes a road's distance and height into the cells around it, and its turning circle's. */
function rasterRoad({ points, half, end }: Road): void {
	const reach = half + MOST_BANK + 6;
	const span = Math.ceil(reach / CELL);
	for (let k = 0; k + 1 < points.length; k++) {
		const a = points[k] as RoadPoint;
		const b = points[k + 1] as RoadPoint;
		const [abx, abz] = [b.x - a.x, b.z - a.z];
		const length2 = abx * abx + abz * abz || 1;
		const [ci, cj] = [toCell(a.x), toCell(a.z)];
		for (let j = Math.max(0, cj - span); j <= Math.min(SIDE - 1, cj + span); j++)
			for (let i = Math.max(0, ci - span); i <= Math.min(SIDE - 1, ci + span); i++) {
				const [x, z] = [fromCell(i), fromCell(j)];
				const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / length2));
				const edge = hypot(x - (a.x + abx * t), z - (a.z + abz * t)) - half;
				const at = cellAt(i, j);
				const y = a.y + (b.y - a.y) * t;
				// Where two roads overlap at a junction, the ground stays under the lower of them.
				if (edge < 3 && (edgeGrid[at] as number) < 3)
					roadHeight[at] = Math.min(roadHeight[at] as number, y);
				else if (edge < (edgeGrid[at] as number)) roadHeight[at] = y;
				if (edge < (edgeGrid[at] as number)) edgeGrid[at] = edge;
			}
	}
	if (end === 'circle') {
		const last = points[points.length - 1] as RoadPoint;
		const radius = circleRadius(half);
		const [ci, cj] = [toCell(last.x), toCell(last.z)];
		const around = Math.ceil((radius + MOST_BANK + 6) / CELL);
		for (let j = Math.max(0, cj - around); j <= Math.min(SIDE - 1, cj + around); j++)
			for (let i = Math.max(0, ci - around); i <= Math.min(SIDE - 1, ci + around); i++) {
				const edge = hypot(fromCell(i) - last.x, fromCell(j) - last.z) - radius;
				const at = cellAt(i, j);
				if (edge < (edgeGrid[at] as number)) {
					edgeGrid[at] = edge;
					roadHeight[at] = last.y;
				}
			}
	}
}

/** A grid's value at a point, between its nearest cells. */
export function read(grid: Float32Array, x: number, z: number): number {
	const u = Math.min(SIDE - 1.001, Math.max(0, (x + GROUND / 2) / CELL));
	const v = Math.min(SIDE - 1.001, Math.max(0, (z + GROUND / 2) / CELL));
	const [i, j] = [Math.floor(u), Math.floor(v)];
	const [s, t] = [u - i, v - j];
	const at = cellAt(i, j);
	const top = (grid[at] as number) * (1 - s) + (grid[at + 1] as number) * s;
	const bottom = (grid[at + SIDE] as number) * (1 - s) + (grid[at + SIDE + 1] as number) * s;
	return top * (1 - t) + bottom * t;
}

/** How far a point lies from the nearest road's edge, in meters, past the lookup's reach if far. */
export function roadEdge(x: number, z: number): number {
	return read(edgeGrid, x, z);
}

/** Whether a point lies in the town's middle: on the square or under the church. */
export function inCore(x: number, z: number): boolean {
	if (KEEPS.some(([kx, kz]) => Math.abs(x - kx) < 13 && Math.abs(z - kz) < 13)) return true;
	const square = Math.abs(x - SQUARE.x) < SQUARE.hx + 1 && Math.abs(z - SQUARE.z) < SQUARE.hz + 1;
	const church = Math.abs(x - CHURCH_AT.x) < 19 && z > CHURCH_AT.z - 24 && z < SQUARE.z;
	return square || church;
}

/** Whether a place lies on a hilltop, whose houses stand close together. */
export function onHilltop(x: number, z: number): boolean {
	return VILLAGES.some(([vx, vz, , radius]) => hypot(x - vx, z - vz) < radius * 1.35);
}

export const lookupKey = (x: number, z: number) =>
	(Math.floor(x / LOOKUP) + 512) * 1024 + (Math.floor(z / LOOKUP) + 512);

/** A place in a plot's own frame, turned into the world. */
export const inWorld = (lot: Lot, u: number, v: number): readonly [number, number] => {
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	return [lot.x + u * c + v * s, lot.z - u * s + v * c];
};

/** Rasters the given roads into the road grids. */
export function rasterAll(roads: readonly Road[]): void {
	edgeGrid.fill(99);
	roadHeight.fill(0);
	for (const road of roads) rasterRoad(road);
}

/** The half width of the ground that a drive holds to its grade, in meters. */
const DRIVE_HOLD = 2.2;

/** Holds the ground under a house's drive to the drive's own ramp, from the road's gate to its front door. */
function holdDrive(out: Float32Array, pinned: Uint8Array, lot: Lot): void {
	const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
	const [fx, fz] = [lot.x + Math.sin(lot.yaw) * hd, lot.z + Math.cos(lot.yaw) * hd];
	const [ax, ay, az] = [lot.gate.x, lot.gate.y, lot.gate.z];
	const [dx, dz] = [fx - ax, fz - az];
	const length2 = dx * dx + dz * dz || 1;
	const reach = DRIVE_HOLD + 2;
	const span = Math.ceil((Math.sqrt(length2) + reach) / CELL);
	const [ci, cj] = [toCell(ax), toCell(az)];
	for (let j = Math.max(0, cj - span); j <= Math.min(SIDE - 1, cj + span); j++)
		for (let i = Math.max(0, ci - span); i <= Math.min(SIDE - 1, ci + span); i++) {
			const [x, z] = [fromCell(i), fromCell(j)];
			const at = cellAt(i, j);
			if ((edgeGrid[at] as number) < 0.5) continue;
			const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / length2));
			const near = 1 - smoothstep(hypot(x - (ax + dx * t), z - (az + dz * t)), DRIVE_HOLD, reach);
			if (near <= 0) continue;
			out[at] = (out[at] as number) + (ay + (lot.y - ay) * t - (out[at] as number)) * near;
			if (near >= 1) pinned[at] = 1;
		}
}

/** The ground's natural height at each cell, with the worked terraces stepped into it. */
export const natural = new Float32Array(SIDE * SIDE);
function readNatural(): void {
	for (let j = 0; j < SIDE; j++)
		for (let i = 0; i < SIDE; i++) natural[cellAt(i, j)] = naturalHeight(fromCell(i), fromCell(j));
}
readNatural();

/** Blends one level pad into the running sums of the cells around it. */
function rasterPad(
	sum: Float32Array,
	weight: Float32Array,
	share: Float32Array,
	x: number,
	z: number,
	y: number,
	yaw: number,
	w: number,
	back: number,
	front: number,
): void {
	const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
	const reach = hypot(w, Math.max(back, front)) + MOST_BANK;
	const span = Math.ceil(reach / CELL);
	const [ci, cj] = [toCell(x), toCell(z)];
	for (let j = Math.max(0, cj - span); j <= Math.min(SIDE - 1, cj + span); j++)
		for (let i = Math.max(0, ci - span); i <= Math.min(SIDE - 1, ci + span); i++) {
			const [dx, dz] = [fromCell(i) - x, fromCell(j) - z];
			const u = Math.abs(dx * c - dz * s) - w;
			const v = dx * s + dz * c;
			const out = v > front ? v - front : v < -back ? -back - v : 0;
			const d = hypot(Math.max(u, 0), out);
			const at = cellAt(i, j);
			// The bank's width follows the height it must take up, so it never stands too steep.
			const bank = Math.min(MOST_BANK, Math.max(3, Math.abs((natural[at] as number) - y) * 1.1));
			const near = 1 - smoothstep(d, 0, bank);
			if (near <= 0) continue;
			const blend = near * near * near + 1e-3;
			sum[at] = (sum[at] as number) + y * blend;
			weight[at] = (weight[at] as number) + blend;
			share[at] = Math.max(share[at] as number, near);
		}
}

/** The height of the bed under which no bank reaches, in meters. */
const UNDER_WATER = -1;
/** The noise above which a slope is worked, which sets how much of the mid band holds terraces. */
const TERRACE_NOISE = -0.1;
/** How much of a village's radius holds its stepped gardens. */
const CROWN_WORKED = 0.85;

/** Where a slope is worked in terraces. */
export function worked(x: number, z: number): boolean {
	// A village's crown is worked in stepped gardens right up to its tower.
	if (VILLAGES.some(([vx, vz, , r]) => hypot(x - vx, z - vz) < r * CROWN_WORKED)) return true;
	return (
		naturalHeight(x, z) < 115 &&
		hypot(
			naturalHeight(x + 6, z) - naturalHeight(x, z),
			naturalHeight(x, z + 6) - naturalHeight(x, z),
		) < 4.6 &&
		townShare(x, z) < 0.3 &&
		golfShare(x, z) < 0.01 &&
		inland(x, z) > 40 &&
		beachShare(x, z) < 0.1 &&
		clumps.fbm2(x * 0.017 + 17, z * 0.017 + 2, 2) > TERRACE_NOISE
	);
}

/** The passes in which a slope too steep for a bank spreads across the ground around it. */
const SPREAD_PASSES = 60;

/** The height between two terraces of a worked slope, in meters. */
export const TERRACE_RISE = 1.7;

/** Which cells are worked in terraces, and the small bumps of the open ground, read once for every bake. */
const workedCells = new Uint8Array(SIDE * SIDE);
const openBumps = new Float32Array(SIDE * SIDE);
for (let j = 0; j < SIDE; j++)
	for (let i = 0; i < SIDE; i++) {
		const at = cellAt(i, j);
		if ((natural[at] as number) <= 1.5) continue;
		const [x, z] = [fromCell(i), fromCell(j)];
		if (worked(x, z)) workedCells[at] = 1;
		else
			openBumps[at] =
				(1 - beachShare(x, z)) *
				(1 - townShare(x, z)) *
				smoothstep(inland(x, z), 30, 50) *
				0.5 *
				fine.fbm2(x * 0.09, z * 0.09, 2);
	}

/** The final height of the ground at each cell of the grid. */
let ground = new Float32Array(SIDE * SIDE);

/** The grid of the ground as it was last baked. */
export const currentGround = (): Float32Array => ground;

/** Bakes the ground from the natural land, the terraces, the plots and the roads. */
export function bake(lots: readonly Lot[], stairs: readonly (readonly Tread[])[]): void {
	const sum = new Float32Array(SIDE * SIDE);
	const weight = new Float32Array(SIDE * SIDE);
	const share = new Float32Array(SIDE * SIDE);
	for (const lot of lots) {
		// A pad reaches a little past its walls, so the bank starts clear of the house's corners.
		const [w, back, front] = lot.plot;
		rasterPad(
			sum,
			weight,
			share,
			lot.x,
			lot.z,
			lot.y,
			lot.yaw,
			w + PAD_MARGIN,
			back + PAD_MARGIN,
			front,
		);
	}
	// The square lies level on a stone terrace, and each park on a lawn of its own.
	const squareY = naturalHeight(SQUARE.x, SQUARE.z) + 0.3;
	rasterPad(
		sum,
		weight,
		share,
		SQUARE.x,
		SQUARE.z,
		squareY,
		0,
		SQUARE.hx + 2,
		SQUARE.hz + 2,
		SQUARE.hz + 2,
	);
	rasterPad(sum, weight, share, CHURCH_AT.x, CHURCH_AT.z, squareY, 0, 18, 24, 18);
	for (const [x, z, radius] of PARKS)
		rasterPad(
			sum,
			weight,
			share,
			x,
			z,
			naturalHeight(x, z),
			0,
			radius * 0.72,
			radius * 0.72,
			radius * 0.72,
		);
	for (const [kx, kz, ky] of KEEPS) rasterPad(sum, weight, share, kx, kz, ky, 0, 11, 11, 11);
	const out = new Float32Array(SIDE * SIDE);
	const pinned = new Uint8Array(SIDE * SIDE);
	for (let j = 0; j < SIDE; j++)
		for (let i = 0; i < SIDE; i++) {
			const at = cellAt(i, j);
			let h = natural[at] as number;
			const near = share[at] as number;
			const edge = edgeGrid[at] as number;
			if (h > 1.5) {
				// Worked slopes step in terraces. Open ground keeps its small bumps, apart from the sand.
				const open = (1 - near) * smoothstep(edge, 2, 10);
				if (open > 0 && workedCells[at] === 1) {
					const step = Math.floor(h / TERRACE_RISE) * TERRACE_RISE;
					const riser = smoothstep(h - step, TERRACE_RISE * 0.45, TERRACE_RISE);
					h += (step + riser * TERRACE_RISE - h) * open;
				} else h += open * (openBumps[at] as number);
			}
			if (near > 0) h += ((sum[at] as number) / (weight[at] as number) - h) * near;
			if (near >= 1) pinned[at] = 1;
			if (
				edge < MOST_BANK &&
				!((natural[at] as number) < UNDER_WATER && harbourShare(fromCell(i), fromCell(j)) > 0.5)
			) {
				// A road holds the ground flat out past its pale edge, then its bank takes up the height.
				const road = (roadHeight[at] as number) - 0.34;
				// Where a road lies in a cut, a stone wall takes the first of it, and the ground behind stands level with the wall's top.
				const cut = h - road;
				const wall = near < 0.5 && cut >= WALL_LEAST ? Math.min(cut, MOST_WALL) : 0;
				const y = road + wall * smoothstep(edge, WALL_EDGE, WALL_EDGE + 0.6);
				const verge = Math.min(MOST_BANK, Math.max(2.5, Math.abs(h - y)));
				// A plot keeps its own level past the road's shoulder.
				const w =
					(1 - smoothstep(edge, SHOULDER, SHOULDER + verge)) * (edge <= SHOULDER ? 1 : 1 - near);
				h += (y - h) * w;
				if (edge <= SHOULDER) pinned[at] = 2;
			}
			out[at] = h;
		}
	// The last pass keeps the banks that roads and plots leave under the steepest slope, and lets the
	// land's own cliffs stand. Roads win over plots and plots over open ground.
	// Each tower's ground stands at its own height, and the land's banks fall from it.
	for (const [kx, kz] of KEEPS)
		for (let j = toCell(kz - 8); j <= toCell(kz + 8); j++)
			for (let i = toCell(kx - 8); i <= toCell(kx + 8); i++) pinned[cellAt(i, j)] = 2;
	// No road's bank reaches out under the water, so the bed stays clear for boats.
	for (let j = 0; j < SIDE; j++)
		for (let i = 0; i < SIDE; i++) {
			const at = cellAt(i, j);
			if ((natural[at] as number) < UNDER_WATER && harbourShare(fromCell(i), fromCell(j)) > 0.5)
				pinned[at] = 1;
		}
	for (const lot of lots) if (lot.garden >= 0) holdDrive(out, pinned, lot);
	const limit = STEEPEST_BANK * CELL;
	// What roads and plots add to the land fades with distance, whatever the land's own slope. So a bank
	// lies on the land, meets it at nothing, and never ends in a cliff of its own.
	const offset = new Float32Array(SIDE * SIDE);
	for (let k = 0; k < offset.length; k++) offset[k] = (out[k] as number) - (natural[k] as number);
	const pull = (at: number, from: number) => {
		if (pinned[at] !== 0) return;
		const f = offset[from] as number;
		offset[at] = Math.min(f + limit, Math.max(f - limit, offset[at] as number));
	};
	for (let pass = 0; pass < 2; pass++) {
		for (let j = 1; j < SIDE; j++)
			for (let i = 1; i < SIDE; i++) {
				pull(cellAt(i, j), cellAt(i - 1, j));
				pull(cellAt(i, j), cellAt(i, j - 1));
			}
		for (let j = SIDE - 2; j >= 0; j--)
			for (let i = SIDE - 2; i >= 0; i--) {
				pull(cellAt(i, j), cellAt(i + 1, j));
				pull(cellAt(i, j), cellAt(i, j + 1));
			}
	}
	// Where two held places stand too close for their height, the slope that no bank can hold spreads
	// across the ground between them, and does not stand as a wall at the edge of one.
	let tight = new Set<number>();
	const steps = [1, -1, SIDE, -SIDE];
	const tooSteep = (at: number, near: number) =>
		Math.abs((offset[at] as number) - (offset[near] as number)) > limit * 1.05;
	for (let j = 1; j < SIDE - 1; j++)
		for (let i = 1; i < SIDE - 1; i++) {
			const at = cellAt(i, j);
			if (pinned[at] === 0 && steps.some((step) => tooSteep(at, at + step))) tight.add(at);
		}
	for (let pass = 0; pass < SPREAD_PASSES && tight.size > 0; pass++) {
		const next = new Set<number>();
		for (const at of tight) {
			offset[at] =
				steps.reduce((sum, step) => sum + (offset[at + step] as number), 0) / steps.length;
			for (const step of steps) {
				const near = at + step;
				if (!tooSteep(at, near)) continue;
				next.add(at);
				const [i, j] = [near % SIDE, Math.floor(near / SIDE)];
				if (pinned[near] === 0 && i > 0 && j > 0 && i < SIDE - 1 && j < SIDE - 1) next.add(near);
			}
		}
		tight = next;
	}
	for (let k = 0; k < offset.length; k++) out[k] = (natural[k] as number) + (offset[k] as number);
	// Each stair's ground, cut or filled, lies just under its steps, and a short bank blends it into the
	// slope on each side. The first steps leave a street, whose ground stays as it is.
	for (const stair of stairs) {
		const nearest = new Map<number, [number, number]>();
		for (let k = 0; k + 1 < stair.length; k++) {
			const [a, b] = [stair[k] as (typeof stair)[number], stair[k + 1] as (typeof stair)[number]];
			const [dx, dz] = [b.x - a.x, b.z - a.z];
			const length2 = dx * dx + dz * dz || 1;
			const span = Math.ceil((STAIR_BED + STAIR_BANK) / CELL) + 1;
			const [ci, cj] = [toCell(a.x), toCell(a.z)];
			for (let j = cj - span; j <= cj + span; j++)
				for (let i = ci - span; i <= ci + span; i++) {
					const [x, z] = [fromCell(i), fromCell(j)];
					const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
					const d = hypot(x - (a.x + dx * t), z - (a.z + dz * t));
					const at = cellAt(i, j);
					const seen = nearest.get(at);
					if (!seen || d < seen[0]) nearest.set(at, [d, a.y + (b.y - a.y) * t - STAIR_BURY]);
				}
		}
		for (const [at, [d, y]] of nearest) {
			const edge = edgeGrid[at] as number;
			if (edge < STAIR_EDGE || (d > STAIR_BED && (edge < SHOULDER || pinned[at] === 1))) continue;
			// The bank's width follows the height that it must take up.
			const bank = Math.min(STAIR_BANK, Math.max(1.5, Math.abs((out[at] as number) - y) * 0.9));
			const share = 1 - smoothstep(d, STAIR_BED, STAIR_BED + bank);
			out[at] = (out[at] as number) + (y - (out[at] as number)) * share;
		}
	}
	ground = out;
}

/** The walled plots whose ground stands in a face taller than a limit against the ground beside them. */
export function padFaces(lots: readonly Lot[], attached = false): Set<Lot> {
	const found = new Set<Lot>();
	const reach = Math.ceil(FACE_RUN / CELL);
	for (const lot of lots) {
		if (lot.garden < 0 && !attached) continue;
		const [w, back, front] = lot.plot;
		const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
		const span = Math.ceil((hypot(w, Math.max(back, front)) + FACE_RUN) / CELL);
		const [ci, cj] = [toCell(lot.x), toCell(lot.z)];
		for (let j = cj - span; j <= cj + span && !found.has(lot); j++)
			for (let i = ci - span; i <= ci + span; i++) {
				const [dx, dz] = [fromCell(i) - lot.x, fromCell(j) - lot.z];
				const v = dx * s + dz * c;
				if (Math.abs(dx * c - dz * s) > w + PAD_MARGIN || v > front || v < -back - PAD_MARGIN)
					continue;
				const at = cellAt(i, j);
				const here = ground[at] as number;
				if (
					Math.abs(here - (ground[at + reach] as number)) > MOST_FACE ||
					Math.abs(here - (ground[at - reach] as number)) > MOST_FACE ||
					Math.abs(here - (ground[at + reach * SIDE] as number)) > MOST_FACE ||
					Math.abs(here - (ground[at - reach * SIDE] as number)) > MOST_FACE
				) {
					found.add(lot);
					break;
				}
			}
	}
	return found;
}

/** The height of the ground at a point, in meters, with its roads and house plots cut in. */
export function groundHeight(x: number, z: number): number {
	return read(ground, x, z);
}

/** The ground's steepness at a point, as the rise over the run. */
export function slopeAt(x: number, z: number): number {
	const step = 2;
	const dx = read(ground, x + step, z) - read(ground, x - step, z);
	const dz = read(ground, x, z + step) - read(ground, x, z - step);
	return hypot(dx, dz) / (step * 2);
}

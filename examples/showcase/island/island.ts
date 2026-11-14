// The island's natural shape, as functions of a place: its shoreline, its hills, its seabed, and the
// places that the town, the beach and the golf course take. The town plan builds on these, so its
// roads and houses follow the land. The island stands alone in the sea: a steep main hill to the north
// with a lesser hill to its east and a low one to its west, each crowned by a small level top. An apron
// of gentler ground, with a dry valley up its middle, falls from them to a compact town around a small
// harbour. The long crescent of the beach lies to the south-east, the golf course on the eastern
// headland, and everywhere else cliffs stand over the water. Strata step the upper slopes in ledges,
// which carry the lanes. The shore is a drawn outline with a rocky edge, and a distance field over the
// ground answers how far inland a place is.
import { math } from '@null3d/engine';
import { Noise } from '../../lib/procedural';

/**
 * The length of a vector, by a plain square root: engines round `Math.hypot` differently in its last
 * digit, and the plan must come out the same on each of them.
 */
export const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

/** The width and depth of the ground that holds the island and its seabed, in meters. */
export const GROUND = 1800;
/** The sea's level, in meters. */
export const SEA_LEVEL = 0;
/** The town's middle, x and z, and the radius of its core, in meters. */
export const TOWN = { x: -85, z: 190, radius: 110, height: 9 } as const;
/** The golf course's middle, x and z, and the radius of its gentle ground, in meters. */
export const GOLF = { x: 590, z: -112, radius: 125, height: 30 } as const;
/** The bay behind the beach: a circle of sand, and the bearings about its middle that the sand spans. */
export const BAY = { x: 372, z: 228, radius: 206, from: -1.31, sweep: -2.36 } as const;
/** The harbour's basin: its middle and its half width and half depth, in meters. */
export const HARBOUR = { x: -100, z: 345, rx: 125, rz: 70 } as const;
/**
 * The ridge that runs the length of the island and joins its hills into one mass. Each point: x and z,
 * the height of the crest there, and how far the land reaches from the crest to the south and north.
 */
const RIDGE: readonly (readonly [number, number, number, number, number])[] = [
	[-620, -380, 30, 330, 90],
	[-515, -395, 105, 450, 110],
	[-420, -395, 92, 520, 150],
	[-300, -390, 132, 520, 170],
	[-118, -375, 190, 500, 200],
	[70, -365, 100, 430, 175],
	[255, -350, 155, 330, 125],
	[370, -300, 55, 240, 105],
	[470, -230, 18, 190, 100],
	[560, -165, 26, 150, 150],
];
/** The hilltops, each crowned by a tower: place, x and z, the height of the top, and the crown's radius. */
export const SUMMITS: readonly (readonly [number, number, number, number])[] = [
	[-118, -375, 190, 70],
	[255, -350, 155, 70],
	[-515, -395, 105, 62],
];
/**
 * The villages, each clamped to its hill's crest around the tower: place, x and z, the height that the
 * road reaches at the village's edge, and the village's radius.
 */
export const VILLAGES: readonly (readonly [number, number, number, number])[] = [
	[-118, -375, 162, 60],
	[255, -350, 132, 58],
	[-515, -395, 89, 55],
];
/** The shore's outline, clockwise from the eastern tip, with the bay's arc in its place. */
const OUTLINE_EAST: readonly (readonly [number, number])[] = [
	[752, -105],
	[718, -10],
	[610, 28],
	[505, 36],
];
const OUTLINE_WEST: readonly (readonly [number, number])[] = [
	[258, 348],
	[305, 385],
	[292, 432],
	[205, 455],
	[125, 432],
	[78, 392],
	[62, 345],
	[20, 318],
	[-22, 293],
	[-85, 280],
	[-150, 284],
	[-205, 312],
	[-232, 352],
	[-262, 396],
	[-330, 400],
	[-440, 372],
	[-500, 312],
	[-600, 226],
	[-668, 74],
	[-652, -40],
	[-640, -150],
	[-655, -270],
	[-655, -410],
	[-590, -505],
	[-440, -555],
	[-255, -570],
	[-120, -590],
	[20, -565],
	[140, -525],
	[255, -505],
	[375, -440],
	[480, -335],
	[628, -248],
	[738, -180],
];

const noise = new Noise(41);
const { smoothstep } = math;

/** The cell of the distance field, in meters, and its cells along a side. */
const CELL = 3;
const SIDE = Math.ceil(GROUND / CELL) + 1;

/** How much a place on the bay's circle lies on the sand, by its bearing about the bay's middle. */
function onSand(x: number, z: number): number {
	const a = Math.atan2(z - BAY.z, x - BAY.x);
	let t = (a - BAY.from) / BAY.sweep;
	if (t < 0) t += (Math.PI * 2) / -BAY.sweep;
	if (t > 1.5) t -= (Math.PI * 2) / -BAY.sweep;
	return smoothstep(t, -0.06, 0.04) * (1 - smoothstep(t, 0.96, 1.06));
}

/** How far along the crescent's bearings a place lies, 0 at its northern end and 1 at its southern. */
function bayArc(x: number, z: number): number {
	const a = Math.atan2(z - BAY.z, x - BAY.x);
	const t = (a - BAY.from) / BAY.sweep;
	return t < -0.8 ? t + (Math.PI * 2) / -BAY.sweep : t;
}

/** The share of the crescent from its northern end at 0 to its southern end at 1. */
function alongSand(x: number, z: number): number {
	const a = Math.atan2(z - BAY.z, x - BAY.x);
	let t = (a - BAY.from) / BAY.sweep;
	if (t < 0) t += (Math.PI * 2) / -BAY.sweep;
	return Math.min(1, Math.max(0, t));
}

/** The width of the sand at a place, in meters: narrow to the north and wide to the south. */
export function sandWidth(x: number, z: number): number {
	return 25 + 45 * alongSand(x, z);
}

/** The shoreline as a closed line of points, with the rocky stretches made uneven. */
function shoreLine(): number[] {
	const knots: (readonly [number, number])[] = [...OUTLINE_EAST];
	for (let k = 0; k <= 16; k++) {
		const a = BAY.from + (BAY.sweep * k) / 16;
		knots.push([BAY.x + Math.cos(a) * BAY.radius, BAY.z + Math.sin(a) * BAY.radius]);
	}
	knots.push(...OUTLINE_WEST);
	const line: number[] = [];
	const count = knots.length;
	for (let k = 0; k < count; k++) {
		const [ax, az] = knots[(k + count - 1) % count] as readonly [number, number];
		const [bx, bz] = knots[k] as readonly [number, number];
		const [cx, cz] = knots[(k + 1) % count] as readonly [number, number];
		const [dx, dz] = knots[(k + 2) % count] as readonly [number, number];
		const steps = Math.max(2, Math.ceil(hypot(cx - bx, cz - bz) / 3));
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			const [t2, t3] = [t * t, t * t * t];
			line.push(
				0.5 *
					(2 * bx +
						(cx - ax) * t +
						(2 * ax - 5 * bx + 4 * cx - dx) * t2 +
						(3 * bx - ax - 3 * cx + dx) * t3),
				0.5 *
					(2 * bz +
						(cz - az) * t +
						(2 * az - 5 * bz + 4 * cz - dz) * t2 +
						(3 * bz - az - 3 * cz + dz) * t3),
			);
		}
	}
	// The rock's edge wanders along the line's normal in coves and points. Sand and quay stay clean.
	const out = new Array<number>(line.length);
	const points = line.length / 2;
	for (let k = 0; k < points; k++) {
		const [x, z] = [line[k * 2] as number, line[k * 2 + 1] as number];
		const n = (k + 1) % points;
		const p = (k + points - 1) % points;
		const nx = -((line[n * 2 + 1] as number) - (line[p * 2 + 1] as number));
		const nz = (line[n * 2] as number) - (line[p * 2] as number);
		const length = hypot(nx, nz) || 1;
		const sand = hypot(x - BAY.x, z - BAY.z) < BAY.radius + 30 ? onSand(x, z) : 0;
		const quay =
			1 -
			smoothstep(
				hypot((x - HARBOUR.x) / (HARBOUR.rx + 40), (z - HARBOUR.z) / (HARBOUR.rz + 30)),
				0.95,
				1.3,
			);
		const wander =
			(70 * noise.fbm2(x * 0.011 + 3, z * 0.011, 2) +
				30 * noise.fbm2(x * 0.04, z * 0.04 + 9, 2) +
				9 * noise.fbm2(x * 0.15, z * 0.15 + 2, 2)) *
			(1 - sand) *
			(1 - quay);
		out[k * 2] = x + (nx / length) * wander;
		out[k * 2 + 1] = z + (nz / length) * wander;
	}
	return out;
}

/** One pass of the squared distance transform along a line of a grid. */
function distanceLine(
	f: Float64Array,
	d: Float64Array,
	v: Int32Array,
	z: Float64Array,
	n: number,
): void {
	let k = 0;
	v[0] = 0;
	z[0] = -1e20;
	z[1] = 1e20;
	for (let q = 1; q < n; q++) {
		let s = 0;
		for (;;) {
			const p = v[k] as number;
			s = ((f[q] as number) + q * q - (f[p] as number) - p * p) / (2 * q - 2 * p);
			if (s > (z[k] as number)) break;
			k--;
		}
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = 1e20;
	}
	k = 0;
	for (let q = 0; q < n; q++) {
		while ((z[k + 1] as number) < q) k++;
		const p = v[k] as number;
		d[q] = (q - p) * (q - p) + (f[p] as number);
	}
}

/** The distance from each cell to the nearest cell that the mask marks, in cells. */
function distanceTo(mask: Uint8Array, want: number): Float32Array {
	const out = new Float64Array(SIDE * SIDE);
	for (let k = 0; k < out.length; k++) out[k] = mask[k] === want ? 0 : 1e20;
	const f = new Float64Array(SIDE);
	const d = new Float64Array(SIDE);
	const v = new Int32Array(SIDE);
	const z = new Float64Array(SIDE + 1);
	for (let j = 0; j < SIDE; j++) {
		for (let i = 0; i < SIDE; i++) f[i] = out[j * SIDE + i] as number;
		distanceLine(f, d, v, z, SIDE);
		for (let i = 0; i < SIDE; i++) out[j * SIDE + i] = d[i] as number;
	}
	for (let i = 0; i < SIDE; i++) {
		for (let j = 0; j < SIDE; j++) f[j] = out[j * SIDE + i] as number;
		distanceLine(f, d, v, z, SIDE);
		for (let j = 0; j < SIDE; j++) out[j * SIDE + i] = d[j] as number;
	}
	const result = new Float32Array(SIDE * SIDE);
	for (let k = 0; k < out.length; k++) result[k] = Math.sqrt(out[k] as number);
	return result;
}

/** How far each cell lies inside the shore, in meters, and below 0 out at sea. */
const field = (() => {
	const line = shoreLine();
	const points = line.length / 2;
	const mask = new Uint8Array(SIDE * SIDE);
	// Each row of the grid fills between the places where the shoreline crosses it.
	const crossings: number[][] = Array.from({ length: SIDE }, () => []);
	for (let k = 0; k < points; k++) {
		const n = (k + 1) % points;
		const [ax, az] = [line[k * 2] as number, line[k * 2 + 1] as number];
		const [bx, bz] = [line[n * 2] as number, line[n * 2 + 1] as number];
		const j0 = Math.ceil((Math.min(az, bz) + GROUND / 2) / CELL);
		const j1 = Math.floor((Math.max(az, bz) + GROUND / 2) / CELL);
		for (let j = Math.max(0, j0); j <= Math.min(SIDE - 1, j1); j++) {
			const z = j * CELL - GROUND / 2;
			if (az <= z === bz <= z) continue;
			(crossings[j] as number[]).push(ax + ((z - az) / (bz - az)) * (bx - ax));
		}
	}
	for (let j = 0; j < SIDE; j++) {
		const row = (crossings[j] as number[]).sort((a, b) => a - b);
		for (let c = 0; c + 1 < row.length; c += 2) {
			const i0 = Math.ceil(((row[c] as number) + GROUND / 2) / CELL);
			const i1 = Math.floor(((row[c + 1] as number) + GROUND / 2) / CELL);
			for (let i = Math.max(0, i0); i <= Math.min(SIDE - 1, i1); i++) mask[j * SIDE + i] = 1;
		}
	}
	const toSea = distanceTo(mask, 0);
	const toLand = distanceTo(mask, 1);
	const raw = new Float32Array(SIDE * SIDE);
	for (let k = 0; k < raw.length; k++) {
		const inside = mask[k] === 1;
		raw[k] = (inside ? (toSea[k] as number) - 0.5 : 0.5 - (toLand[k] as number)) * CELL;
	}
	// A small blur takes the grid's steps out of the edge.
	return blur(raw, SIDE, 1, 2);
})();

/** A box blur of a square grid, over a radius in cells, in passes along each axis. */
function blur(grid: Float32Array, side: number, radius: number, passes: number): Float32Array {
	let from = grid;
	const span = radius * 2 + 1;
	for (let pass = 0; pass < passes; pass++) {
		const across = new Float32Array(side * side);
		for (let j = 0; j < side; j++) {
			let sum = 0;
			const row = j * side;
			for (let i = -radius; i <= radius; i++) sum += from[row + Math.max(0, i)] as number;
			for (let i = 0; i < side; i++) {
				across[row + i] = sum / span;
				sum +=
					(from[row + Math.min(side - 1, i + radius + 1)] as number) -
					(from[row + Math.max(0, i - radius)] as number);
			}
		}
		const down = new Float32Array(side * side);
		for (let i = 0; i < side; i++) {
			let sum = 0;
			for (let j = -radius; j <= radius; j++) sum += across[Math.max(0, j) * side + i] as number;
			for (let j = 0; j < side; j++) {
				down[j * side + i] = sum / span;
				sum +=
					(across[Math.min(side - 1, j + radius + 1) * side + i] as number) -
					(across[Math.max(0, j - radius) * side + i] as number);
			}
		}
		from = down;
	}
	return from;
}

/** The distance field with its ridges rounded off, so that the hills rise from a smooth outline. */
const smoothField = blur(field, SIDE, 13, 3);

/** A value of a grid of the field's size at a point, between its nearest cells. */
function read(grid: Float32Array, x: number, z: number): number {
	const u = Math.min(SIDE - 1.001, Math.max(0, (x + GROUND / 2) / CELL));
	const v = Math.min(SIDE - 1.001, Math.max(0, (z + GROUND / 2) / CELL));
	const [i, j] = [Math.floor(u), Math.floor(v)];
	const [s, t] = [u - i, v - j];
	const at = j * SIDE + i;
	const top = (grid[at] as number) * (1 - s) + (grid[at + 1] as number) * s;
	const bottom = (grid[at + SIDE] as number) * (1 - s) + (grid[at + SIDE + 1] as number) * s;
	return top * (1 - t) + bottom * t;
}

/** How far a point lies inside the shore, in meters, and below 0 out at sea. */
export function inland(x: number, z: number): number {
	return read(field, x, z);
}

/** How much of the point's stretch of shore is beach: 1 on the beach and 0 on the rocky coast. */
export function beachShare(x: number, z: number): number {
	const d = hypot(x - BAY.x, z - BAY.z);
	if (d > BAY.radius + 130) return 0;
	return onSand(x, z) * (1 - smoothstep(d, BAY.radius + 70, BAY.radius + 130));
}

/** How much of a point is the beach's dry and wet sand, from 0 to 1. */
export function sandAt(x: number, z: number): number {
	const width = sandWidth(x, z);
	return beachShare(x, z) * (1 - smoothstep(inland(x, z), width - 2, width + 5));
}

/** How much of the point's stretch of shore is the harbour's bay: 1 in the bay and 0 outside it. */
export function harbourShare(x: number, z: number): number {
	const d = hypot((x - HARBOUR.x) / HARBOUR.rx, (z - HARBOUR.z) / HARBOUR.rz);
	return 1 - smoothstep(d, 1, 1.45);
}

/** The half width of the town at a place along its length, narrowing uphill from the quay. */
const townWidth = (z: number) => 70 + (Math.min(290, Math.max(70, z)) - 70) * 0.74;
/** The middle of the town at a place along its length. */
const townMiddle = (z: number) => -72 - (Math.min(290, Math.max(70, z)) - 70) * 0.09;

/** How much of the ground at a point is the town's gentle ground, from 0 to 1. */
export function townShare(x: number, z: number): number {
	const edge = 1 + 0.14 * noise.fbm2(x * 0.012 + 7, z * 0.012, 2);
	const across = Math.abs(x - townMiddle(z)) / townWidth(z);
	// The town's upper edge wanders across the top road, so the road does not divide town from country.
	const top = 60 + 24 * Math.sin(0.0262 * (x + 130)) + 40 * noise.fbm2(x * 0.02 + 3, 7, 2);
	return (1 - smoothstep(across, edge * 0.9, edge * 1.3)) * smoothstep(z, top - 20, top + 20);
}

/** How much of the ground at a point is the golf course's gentle ground, from 0 to 1. */
export function golfShare(x: number, z: number): number {
	const [u, v] = [(x - GOLF.x) / (GOLF.radius * 1.2), (z - GOLF.z) / (GOLF.radius * 0.8)];
	return 1 - smoothstep(hypot(u, v), 0.9, 1.05);
}

/** The height of the town's ground at a place, which rises slowly from the quay. */
function townLevel(z: number): number {
	return 2.2 + Math.max(0, 285 - z) * 0.052;
}

/** The hills' spurs: each one's middle, its rise over the land, and the radii across which it fades out. */
const SPURS: readonly (readonly [number, number, number, number, number])[] = [
	[375, -214, 36, 40, 110],
	[270, -160, 15, 30, 85],
	[335, -120, 10, 20, 60],
	[110, -395, 11, 15, 45],
	[330, -290, 6, 20, 50],
	[105, -340, 16, 30, 85],
	[-442, -50, 9, 15, 50],
];

/**
 * The hills' profile: each pair is a share of the way from the crest to the foot, and the share of the
 * crest's height that stands there. A small crown falls through a steep belt of rock and forest to a
 * long gentle apron, which holds the lanes and houses.
 */
const PROFILE: readonly (readonly [number, number])[] = [
	[0, 1],
	[0.08, 0.96],
	[0.16, 0.87],
	[0.44, 0.52],
	[0.7, 0.27],
	[1, 0],
];

/** The profile's height share at a share of the way to the foot. */
function profile(t: number): number {
	for (let k = 0; k + 1 < PROFILE.length; k++) {
		const [a, ha] = PROFILE[k] as readonly [number, number];
		const [b, hb] = PROFILE[k + 1] as readonly [number, number];
		if (t > b) continue;
		// Each stretch's ends meet the next one's with a short blend of their slopes.
		const u = (t - a) / (b - a);
		return ha + (hb - ha) * (u + (u * (1 - u) * (1 - 2 * u)) / 2.5);
	}
	return 0;
}

/** The meters over which a nearer stretch of crest gives way to a further one. */
const CREST_BLEND = 14;

/** The ridge's land at a point, before the coast shapes it: a fall from the nearest place on the crest. */
function ridgeHeight(x: number, z: number): number {
	// Bending the point before it is measured grows spurs and gullies down the sides.
	const bentX = x + 42 * noise.fbm2(x * 0.0048 + 11, z * 0.0048 + 23, 2);
	const bentZ = z + 42 * noise.fbm2(x * 0.0048 + 37, z * 0.0048 + 5, 2);
	// Each stretch of crest gives its own fall, and nearer stretches count for more, so the falls of
	// neighbouring stretches blend with no crease where one takes over from the other.
	let [sum, weight] = [0, 0];
	for (let k = 0; k + 1 < RIDGE.length; k++) {
		const [ax, az, ah, as, an] = RIDGE[k] as readonly [number, number, number, number, number];
		const [bx, bz, bh, bs, bn] = RIDGE[k + 1] as readonly [number, number, number, number, number];
		const [dx, dz] = [bx - ax, bz - az];
		const t = Math.max(
			0,
			Math.min(1, ((bentX - ax) * dx + (bentZ - az) * dz) / (dx * dx + dz * dz)),
		);
		const [px, pz] = [ax + dx * t, az + dz * t];
		const d = hypot(bentX - px, bentZ - pz);
		const south = bentZ > pz;
		const reach = south ? as + (bs - as) * t : an + (bn - an) * t;
		const share = Math.min(1, d / reach);
		// The south falls by the hills' long profile, and the north evenly to the shore.
		const h = (ah + (bh - ah) * t) * (south ? profile(share) : 1 - share);
		const w = Math.exp(-d / CREST_BLEND);
		sum += h * w;
		weight += w;
	}
	return sum / weight;
}

/** The cell of the grid that holds the ridge's land, in meters, and its cells along a side. */
const FORM_CELL = 6;
const FORM_SIDE = Math.ceil(GROUND / FORM_CELL) + 1;
const ridgeGrid = (() => {
	const grid = new Float32Array(FORM_SIDE * FORM_SIDE);
	for (let j = 0; j < FORM_SIDE; j++)
		for (let i = 0; i < FORM_SIDE; i++)
			grid[j * FORM_SIDE + i] = ridgeHeight(i * FORM_CELL - GROUND / 2, j * FORM_CELL - GROUND / 2);
	return grid;
})();

/** The ridge's land at a point, between the grid's nearest cells. */
function ridgeAt(x: number, z: number): number {
	const u = Math.min(FORM_SIDE - 1.001, Math.max(0, (x + GROUND / 2) / FORM_CELL));
	const v = Math.min(FORM_SIDE - 1.001, Math.max(0, (z + GROUND / 2) / FORM_CELL));
	const [i, j] = [Math.floor(u), Math.floor(v)];
	const [s, t] = [u - i, v - j];
	const at = j * FORM_SIDE + i;
	const top = (ridgeGrid[at] as number) * (1 - s) + (ridgeGrid[at + 1] as number) * s;
	const bottom =
		(ridgeGrid[at + FORM_SIDE] as number) * (1 - s) + (ridgeGrid[at + FORM_SIDE + 1] as number) * s;
	return top * (1 - t) + bottom * t;
}

/** How far out from the rocks the shallow reef shelf runs, at its narrowest and by how much more, in meters. */
const REEF_LEAST = 30;
const REEF_RANGE = 50;

/** The long street's middle line along the harbour's head, x and z, west to east. */
const QUAY_STREET: readonly (readonly [number, number])[] = [
	[-229, 310],
	[-208, 301],
	[-186, 291],
	[-164, 282],
	[-140, 277],
	[-116, 274],
	[-92, 274],
	[-69, 276],
	[-45, 281],
	[-22, 287],
	[0, 296],
	[20, 307],
	[43, 316],
];
/** How far past the street's middle line the quay's wall stands, in meters. */
const QUAY_OFF = 8;
/** The part of the harbour's head that the quay's wall runs along, by x. */
export const QUAY_FROM = -212;
export const QUAY_TO = 34;

/** Where the quay's wall stands at a place along the harbour's head, by z. */
export function quayWallZ(x: number): number {
	for (let k = 0; k + 1 < QUAY_STREET.length; k++) {
		const [ax, az] = QUAY_STREET[k] as readonly [number, number];
		const [bx, bz] = QUAY_STREET[k + 1] as readonly [number, number];
		if (x <= bx) return az + ((bz - az) * (x - ax)) / (bx - ax) + QUAY_OFF;
	}
	return (QUAY_STREET[QUAY_STREET.length - 1] as readonly [number, number])[1] + QUAY_OFF;
}

/** The harbour's bed drops straight down at the quay's wall, so boats float right up to it. */
function quayBed(x: number, z: number, height: number): number {
	if (x < QUAY_FROM - 8 || x > QUAY_TO + 8) return height;
	const past = z - quayWallZ(x);
	if (past <= 0) return height;
	const share =
		smoothstep(past, 0, 1) *
		smoothstep(x, QUAY_FROM - 8, QUAY_FROM) *
		(1 - smoothstep(x, QUAY_TO, QUAY_TO + 8));
	const bed = -Math.min(11, QUAY_BED + past * 0.12);
	return height + (Math.min(height, bed) - height) * share;
}

/** How deep the water stands right at the quay's wall, in meters. */
const QUAY_BED = 4;

/**
 * How much a point of the sea is the bay's shallow sandy shoal, from 0 to 1. Its sides fade slowly and
 * wander, so its edge against the deep follows no straight bearing.
 */
export function bayShoal(x: number, z: number): number {
	const wander = 0.3 * noise.fbm2(x * 0.009 + 3, z * 0.009 + 11, 3);
	const along = bayArc(x, z);
	return (
		(1 -
			smoothstep(
				hypot(x - BAY.x, z - BAY.z) * (1 + wander * 0.5),
				BAY.radius * 0.35,
				BAY.radius + 50,
			)) *
		smoothstep(along + wander, -0.75, 0.2) *
		(1 - smoothstep(along - wander, 0.8, 1.75))
	);
}

/** How much the seabed at a point is pale sand, from 0 to 1: the floor of the bay and of the harbour. */
export function sandyBed(x: number, z: number): number {
	return Math.max(smoothstep(bayShoal(x, z), 0.1, 0.6), harbourShare(x, z));
}

/** The land's form at a point, in meters: its hills, coast and flats, before the shelves are cut. */
export function formHeight(x: number, z: number): number {
	const d = inland(x, z);
	const sand = beachShare(x, z);
	if (d <= 0) {
		// A shallow reef shelf runs out from the rocks, broken by dark patches, before the sea falls away. The
		// bay's innermost water stays shallow over sand, and the harbour keeps a steady depth up to its quay.
		const off = -d;
		const bay = bayShoal(x, z);
		const reef = noise.fbm2(x * 0.05 + 21, z * 0.05 + 4, 3);
		const width =
			REEF_LEAST + REEF_RANGE * smoothstep(noise.fbm2(x * 0.008 + 31, z * 0.008, 2), -0.3, 0.3);
		const shelf = 3 + off * 0.09 + Math.max(0, off - width) * 0.3;
		// The reef's patches stop where the sand starts: a lump under the bay's clear water hides the bed behind it
		// from a low view, and the water's color would jump along its outline.
		const patches =
			smoothstep(off, 4, 20) * (1 - smoothstep(off, 60, 130)) * (1 - smoothstep(bay, 0, 0.3));
		const rock = shelf + 7 * reef * patches;
		const shoal = off * 0.035 + Math.max(0, off - 70) * 0.28;
		const depth = rock + (shoal - rock) * bay;
		const harbour = harbourShare(x, z);
		return quayBed(
			x,
			z,
			-Math.min(46, depth + (Math.max(11, depth * 0.3) - depth) * harbour) - 0.15 * (1 - bay),
		);
	}
	// Cliffs stand over the water wherever the coast is not sand or quay, with broken strata in them.
	const crag = 1 + 0.45 * noise.fbm2(x * 0.02 + 5, z * 0.02, 2);
	const strata = 1.4 * Math.sin((d + 4 * noise.fbm2(x * 0.03, z * 0.03, 2)) * 0.55);
	const cliff =
		34 * crag * (1 - Math.exp(-d / 11)) +
		strata * smoothstep(d, 2, 10) * (1 - smoothstep(d, 26, 40));
	const width = sandWidth(x, z);
	const dune = d < width ? d * 0.045 : width * 0.045 + (d - width) * 0.06;
	const low = cliff + (dune - cliff) * sand;
	const shelter = harbourShare(x, z);
	const coast = low + (2.2 + Math.min(d, 60) * 0.03 - low) * shelter;
	const inner = smoothstep(read(smoothField, x, z), 8, 80) * smoothstep(d, 4, 60);
	let height = Math.max(coast, coast * (1 - 0.93 * smoothstep(d, 40, 130)) + inner * ridgeAt(x, z));
	// Broad spurs run off the hills and carry the main road's swing above the gullies beside them.
	for (const [sx, sz, rise, inner, outer] of SPURS)
		height += rise * (1 - smoothstep(hypot(x - sx, z - sz), inner, outer)) * smoothstep(d, 30, 90);
	// Each crown falls evenly from its tower to the village's edge, and blends into the hill's sides.
	VILLAGES.forEach(([vx, vz, level, radius], k) => {
		const r = hypot(x - vx, z - vz);
		const s = 1 - smoothstep(r, radius, radius * 1.45);
		const top = (SUMMITS[k] as readonly [number, number, number, number])[2];
		// A gentle terrace holds the village, and a short steep knob the tower.
		if (s > 0) height += (level + (top - level) * Math.max(0, 1 - r / radius) ** 2.2 - height) * s;
	});
	const [u, v] = [(x - GOLF.x) / (GOLF.radius * 1.2), (z - GOLF.z) / (GOLF.radius * 0.8)];
	const golf = 1 - smoothstep(hypot(u, v), 0.95, 1.5);
	height +=
		(GOLF.height + 0.8 * noise.fbm2(x * 0.012, z * 0.012, 1) - height) *
		golf *
		smoothstep(d, 4, 30);
	// Behind the sand, the plain stays low and rises slowly to the town and the hills.
	const plain =
		onSand(x, z) * (1 - smoothstep(hypot(x - BAY.x, z - BAY.z), BAY.radius + 40, BAY.radius + 150));
	height += (dune - height) * plain;
	const across = Math.abs(x - townMiddle(z)) / townWidth(z);
	const town = (1 - smoothstep(across, 1, 2.6)) * smoothstep(z, 10, 80);
	const level = Math.min(townLevel(z), 2.2 + d * 0.45);
	return quayBed(x, z, height + (level - height) * town);
}

/** The land's own height at a point, in meters, before roads and plots cut it. */
export const naturalHeight = formHeight;

/**
 * The named outcrops: the steep rock belts around each hill's crown. Each one's name, middle, and the
 * radii between which it stands. Rock shows where the land is steep inside them, in broken patches.
 */
export const OUTCROPS: readonly {
	readonly name: string;
	readonly x: number;
	readonly z: number;
	readonly inner: number;
	readonly outer: number;
}[] = [
	{ name: 'the main crown', x: -118, z: -375, inner: 84, outer: 118 },
	{ name: 'the eastern crown', x: 255, z: -350, inner: 80, outer: 104 },
	{ name: 'the western crown', x: -515, z: -395, inner: 76, outer: 96 },
];

/** The steepest slope of the land's form that is not rock, as a rise over a run. */
const ROCK_SLOPE = 0.8;

/** Whether a point lies on a named outcrop: inside one's radii, steep, and on a patch of its rock. */
export function onOutcrop(x: number, z: number): boolean {
	const named = OUTCROPS.some(({ x: ox, z: oz, inner, outer }) => {
		const r = hypot(x - ox, z - oz);
		return r > inner && r < outer;
	});
	if (!named || noise.fbm2(x * 0.03 + 73, z * 0.03 + 11, 2) < 0.24) return false;
	const e = 5;
	const fall =
		hypot(
			formHeight(x + e, z) - formHeight(x - e, z),
			formHeight(x, z + e) - formHeight(x, z - e),
		) /
		(2 * e);
	return fall > ROCK_SLOPE;
}

/** The crest's place by z at a given x, between the ridge's points. */
function crestZ(x: number): number {
	for (let k = 0; k + 1 < RIDGE.length; k++) {
		const [ax, az] = RIDGE[k] as readonly [number, number, number, number, number];
		const [bx, bz] = RIDGE[k + 1] as readonly [number, number, number, number, number];
		if (x >= ax && x <= bx) return az + ((bz - az) * (x - ax)) / (bx - ax);
	}
	return x < 0 ? -380 : -165;
}

/** Whether a point lies north of the ridge, on the side of the island that stays forest. */
export function northOfRidge(x: number, z: number): boolean {
	return z < crestZ(x);
}

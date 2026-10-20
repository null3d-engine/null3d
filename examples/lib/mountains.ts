// A ring of mountains made in code around a showcase scene's square of land, so the view never
// reaches the plain background past the land's edge. The ring starts just inside the land's edge,
// sunk under the land, rises from the land's own height there into foothills and climbs to a crest
// line of peaks, which stays high behind it. Every bearing's crest stands at least as high as the
// lowest crest the scene asks for, so a camera kept below it sees only land, mountain and sky.
//
// A gorge can cut through the ring along a bearing, as a stream's valley runs on out of a scene:
// there the ring takes the valley's own floor, its walls rise to the mountains either side, and it
// runs on to the gorge's end, which a scene hides in haze. The heights and the colors come from
// seeded noise, so the ring is the same on every run.
import type { MeshArrays } from '@null3d/engine';
import { Noise } from './procedural';

type Rgb = readonly [number, number, number];

/** A gorge that cuts through the ring along a bearing, as a stream's valley runs on out of a scene. */
export interface MountainGorge {
	/** The bearing, in radians from +x toward +z. */
	bearing: number;
	/** The height of the gorge's floor at a point: the valley's own ground, carried on. */
	floor: (x: number, z: number) => number;
	/** How far either side of the gorge's line its floor reaches, in meters. */
	width: number;
	/** How far past the floor's side its walls climb to the mountains, in meters. */
	walls: number;
	/** How far from the middle the gorge runs, in meters, where the ring ends along it. */
	end: number;
}

/** The colors of the slopes, linear, and where each lies. */
export interface MountainPalette {
	/** The forest on the lower slopes. */
	forest: Rgb;
	/** Bare rock on the steep slopes and above the forest. */
	rock: Rgb;
	/** Snow on the gentle slopes above the snow line. */
	snow: Rgb;
	/** How high the forest climbs above the ring's foot, in meters. */
	treeLine: number;
	/** The height above which snow lies, in meters above y = 0. */
	snowLine: number;
	/** The share of the forest that snow dusts, from 0 to 1. */
	frost: number;
}

/** The settings of a ring of mountains. */
export interface MountainRingOptions {
	/** Half the width of the square of land that the ring stands around, in meters. */
	half: number;
	/** The land's height at a point. The ring starts under the land's edge, at this height. */
	land: (x: number, z: number) => number;
	/** The nearest and farthest that the crest line stands from the middle, in meters. */
	crest: readonly [number, number];
	/** The lowest crest and the highest peak, in meters above y = 0. */
	heights: readonly [number, number];
	/** Gorges that cut through the ring. */
	gorges?: readonly MountainGorge[];
	/** The bearings around the ring, which set its detail. */
	segments: number;
	/** The rows from the land's edge outward, which set its detail. */
	rows: number;
	seed: number;
	palette: MountainPalette;
}

/** A ring of mountains: its mesh, and its height and crest anywhere around it. */
export interface MountainRing {
	arrays: MeshArrays & { positions: Float32Array; colors: Float32Array; indices: Uint32Array };
	/** The ring's height at a point, or minus infinity inside the land, where the ring lies under it. */
	heightAt(x: number, z: number): number;
	/** The crest's height along a bearing, in meters above y = 0, where no gorge cuts it. */
	crestAt(bearing: number): number;
	/** How much a gorge cuts the ring at a point, from 0 (the mountains) to 1 (the gorge's floor). */
	cutAt(x: number, z: number): number;
}

/** How far inside the land's edge the ring starts, and how far under the land, in meters. */
const INSET = 0.5;
const SINK = 0.35;
/** How far past the land's edge the ring's foot stands, and how high above the edge, in meters. */
const FOOT = 2;
const FOOT_RISE = 0.3;
/** How far the high ground behind the crest runs, in meters. */
const BACK = 60;
/** The share of the rows that climb from the foot to the crest; the rest run on behind it. */
const CLIMB_SHARE = 0.85;
/** How many times more bearings a gorge's direction takes than the rest of the ring. */
const GORGE_DETAIL = 6;
/** How far either side of a gorge's bearing its extra detail spreads, in radians. */
const GORGE_SPREAD = 0.35;

const smoothstep = (x: number, a: number, b: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/** The angle from `a` to `b`, from -π to π. */
const turn = (a: number, b: number) => {
	const d = (b - a) % (2 * Math.PI);
	return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
};

/** Makes a ring of mountains around a square of land. */
export function mountainRing(options: MountainRingOptions): MountainRing {
	const { half, land, crest, heights, gorges = [], segments, rows, seed, palette } = options;
	const noise = new Noise(seed);

	/** Noise around the ring: points on a circle, so it joins up with itself. */
	const around = (bearing: number, scale: number, shift: number) => [
		Math.cos(bearing) * scale + shift,
		Math.sin(bearing) * scale - shift,
	];
	const crestRadius = (bearing: number) => {
		const [x, y] = around(bearing, 1.8, 3.1);
		const t = Math.min(1, Math.max(0, 0.5 + 1.4 * noise.fbm2(x as number, y as number, 3)));
		return crest[0] + (crest[1] - crest[0]) * t;
	};
	const crestAt = (bearing: number) => {
		const [bx, by] = around(bearing, 1.6, 7.3);
		const [px, py] = around(bearing, 6.5, 1.7);
		const [tx, ty] = around(bearing, 15, 4.9);
		// Broad massifs, sharp peaks between them, and smaller teeth along the ridges.
		const massif = 0.5 + 1.2 * noise.fbm2(bx as number, by as number, 3);
		const peaks = (1 - Math.abs(noise.value2(px as number, py as number))) ** 3;
		const teeth = (1 - Math.abs(noise.value2(tx as number, ty as number))) ** 2;
		const t = Math.min(1, Math.max(0, 0.45 * massif + 0.45 * peaks + 0.1 * teeth));
		return heights[0] + (heights[1] - heights[0]) * t;
	};
	const edgeRadius = (bearing: number) =>
		half / Math.max(Math.abs(Math.cos(bearing)), Math.abs(Math.sin(bearing)));
	/** The gorge that cuts a point most, and how much, from 0 to 1. */
	const cut = (x: number, z: number): { gorge: MountainGorge | null; weight: number } => {
		let best: MountainGorge | null = null;
		let weight = 0;
		for (const g of gorges) {
			const along = x * Math.cos(g.bearing) + z * Math.sin(g.bearing);
			if (along <= 0) continue;
			const across = Math.abs(-x * Math.sin(g.bearing) + z * Math.cos(g.bearing));
			const w = 1 - smoothstep(across, g.width, g.width + g.walls);
			if (w > weight) {
				weight = w;
				best = g;
			}
		}
		return { gorge: best, weight };
	};
	/** How far out the ring runs along a bearing: past its crest, or to a gorge's end. */
	const outerRadius = (bearing: number) => {
		let outer = crestRadius(bearing) + BACK;
		for (const g of gorges) {
			const off = Math.abs(Math.sin(turn(g.bearing, bearing)));
			if (Math.cos(turn(g.bearing, bearing)) <= 0) continue;
			const leaves = off > 1e-6 ? (g.width + g.walls) / off : Number.POSITIVE_INFINITY;
			outer = Math.max(outer, Math.min(g.end, leaves));
		}
		return outer;
	};

	/** The mountains' height at radius `r` along a bearing, before any gorge cuts them. */
	const mountain = (
		x: number,
		z: number,
		r: number,
		edge: number,
		base: number,
		radius: number,
		top: number,
	): number => {
		const foot = edge + FOOT;
		if (r <= foot) {
			const t = (r - (edge - INSET)) / (FOOT + INSET);
			return base - SINK + (SINK + FOOT_RISE) * t;
		}
		if (r >= radius) return top;
		const u = (r - foot) / (radius - foot);
		const low = base + FOOT_RISE;
		// Foothills give way to cliffs; spurs and gullies are strongest halfway up and gone at the
		// foot and the crest.
		const ridged = 1 - Math.abs(2 * noise.fbm2(x * 0.016 + 5, z * 0.016 - 2, 4));
		const relief = 0.2 * (top - low) * (ridged - 0.5) * 4 * u * (1 - u);
		return low + (top - low) * u ** 1.7 + relief;
	};
	/** The ring's height at a point at radius `r` along a bearing, gorges included. */
	const heightAlong = (
		x: number,
		z: number,
		r: number,
		edge: number,
		base: number,
		radius: number,
		top: number,
	): number => {
		const high = mountain(x, z, r, edge, base, radius, top);
		const { gorge, weight } = cut(x, z);
		if (!gorge || weight <= 0 || r <= edge + FOOT) return high;
		return high + (gorge.floor(x, z) - high) * weight;
	};

	// The bearings: evenly spread, but packed toward each gorge, where the floor and its stream need
	// the detail. The weight of each bearing is summed, and the columns spread evenly over the sum.
	const density = (bearing: number) => {
		let d = 1;
		for (const g of gorges)
			d += GORGE_DETAIL * Math.exp(-((turn(g.bearing, bearing) / GORGE_SPREAD) ** 2));
		return d;
	};
	const STEPS = segments * 64;
	const cumulative = new Float64Array(STEPS + 1);
	for (let s = 0; s < STEPS; s++)
		cumulative[s + 1] = (cumulative[s] as number) + density(((s + 0.5) / STEPS) * 2 * Math.PI);
	const total = cumulative[STEPS] as number;
	const bearings = new Float64Array(segments);
	for (let c = 0, s = 0; c < segments; c++) {
		const want = (c / segments) * total;
		while ((cumulative[s + 1] as number) < want) s++;
		const span = (cumulative[s + 1] as number) - (cumulative[s] as number);
		bearings[c] = ((s + (want - (cumulative[s] as number)) / span) / STEPS) * 2 * Math.PI;
	}

	// The mesh: rows outward from the land's edge, columns around the ring, joined round at the end.
	const columns = segments;
	const vertexCount = columns * (rows + 1);
	const positions = new Float32Array(vertexCount * 3);
	const colors = new Float32Array(vertexCount * 3);
	const bases = new Float32Array(columns);
	const climbRows = Math.round(rows * CLIMB_SHARE);
	for (let c = 0; c < columns; c++) {
		const bearing = bearings[c] as number;
		const cos = Math.cos(bearing);
		const sin = Math.sin(bearing);
		const edge = edgeRadius(bearing);
		const base = land(edge * cos, edge * sin);
		bases[c] = base;
		const radius = crestRadius(bearing);
		const top = crestAt(bearing);
		const foot = edge + FOOT;
		const outer = outerRadius(bearing);
		// The climbing rows end exactly at the crest, unless the ring runs on far past it along a
		// gorge, where every row spreads out to the end.
		const crestRow = outer <= radius + BACK ? climbRows : rows;
		const climbTo = crestRow === rows ? outer : radius;
		for (let k = 0; k <= rows; k++) {
			let r: number;
			if (k === 0) r = edge - INSET;
			else if (k <= crestRow) {
				// Rows pack toward the foot, where the camera sees the slope from closest.
				const t = (k - 1) / (crestRow - 1);
				r = foot + (climbTo - foot) * t ** 1.3;
			} else r = radius + ((outer - radius) * (k - crestRow)) / (rows - crestRow);
			const x = r * cos;
			const z = r * sin;
			const y = k === 0 ? land(x, z) - SINK : heightAlong(x, z, r, edge, base, radius, top);
			positions.set([x, y, z], (k * columns + c) * 3);
		}
	}

	// The colors: forest low down, rock where the slope is steep or high, snow where it is gentle
	// and high, each darkened in the hollows, where less of the sky reaches. A gorge's floor takes
	// the forest's color, as the valley's woods run on into it.
	const at = (k: number, c: number) => (k * columns + ((c + columns) % columns)) * 3;
	const { forest, rock, snow, treeLine, snowLine, frost } = palette;
	for (let k = 0; k <= rows; k++) {
		const below = Math.max(0, k - 1);
		const above = Math.min(rows, k + 1);
		for (let c = 0; c < columns; c++) {
			const i = at(k, c);
			const x = positions[i] as number;
			const y = positions[i + 1] as number;
			const z = positions[i + 2] as number;
			const across = Math.hypot(
				(positions[at(k, c + 1)] as number) - (positions[at(k, c - 1)] as number),
				(positions[at(k, c + 1) + 2] as number) - (positions[at(k, c - 1) + 2] as number),
			);
			const out = Math.hypot(
				(positions[at(above, c)] as number) - (positions[at(below, c)] as number),
				(positions[at(above, c) + 2] as number) - (positions[at(below, c) + 2] as number),
			);
			const slope = Math.max(
				Math.abs(
					(positions[at(above, c) + 1] as number) - (positions[at(below, c) + 1] as number),
				) / Math.max(out, 1e-3),
				Math.abs(
					(positions[at(k, c + 1) + 1] as number) - (positions[at(k, c - 1) + 1] as number),
				) / Math.max(across, 1e-3),
			);
			const neighbours =
				((positions[at(above, c) + 1] as number) +
					(positions[at(below, c) + 1] as number) +
					(positions[at(k, c + 1) + 1] as number) +
					(positions[at(k, c - 1) + 1] as number)) /
				4;
			const hollow = Math.min(1.08, Math.max(0.55, 1 + 0.06 * (y - neighbours)));
			const rise = y - (bases[c] as number);
			const grain = noise.fbm2(x * 0.08, z * 0.08, 3);
			const wooded =
				(1 - smoothstep(rise + 18 * grain, treeLine * 0.7, treeLine)) *
				(1 - smoothstep(slope, 0.9, 1.3));
			const bare = Math.max(smoothstep(slope, 0.75, 1.15), 1 - wooded);
			const snowy =
				smoothstep(y + 25 * grain, snowLine, snowLine + 15) * (1 - smoothstep(slope, 0.85, 1.25));
			const dusted = frost * smoothstep(grain, -0.1, 0.25);
			const shade = (0.88 + 0.24 * noise.value2(x * 0.05, z * 0.05)) * hollow;
			for (let ch = 0; ch < 3; ch++) {
				// Snow covers the open ground and only dusts the trees.
				const ground = (rock[ch] as number) + ((snow[ch] as number) - (rock[ch] as number)) * snowy;
				const trees =
					(forest[ch] as number) + ((snow[ch] as number) - (forest[ch] as number)) * dusted;
				colors[i + ch] = Math.min(1, (trees + (ground - trees) * bare) * shade);
			}
		}
	}

	const indices = new Uint32Array(columns * rows * 6);
	for (let k = 0; k < rows; k++)
		for (let c = 0; c < columns; c++) {
			const a = k * columns + c;
			const b = k * columns + ((c + 1) % columns);
			// Counter-clockwise seen from above, so the faces turn up and in toward the land.
			indices.set([a, b, a + columns, b, b + columns, a + columns], (k * columns + c) * 6);
		}

	return {
		arrays: { positions, colors, indices, computeNormals: true },
		heightAt(x, z) {
			const bearing = Math.atan2(z, x);
			const edge = edgeRadius(bearing);
			const r = Math.hypot(x, z);
			if (r < edge) return Number.NEGATIVE_INFINITY;
			const base = land(edge * Math.cos(bearing), edge * Math.sin(bearing));
			return heightAlong(x, z, r, edge, base, crestRadius(bearing), crestAt(bearing));
		},
		crestAt,
		cutAt: (x, z) => cut(x, z).weight,
	};
}

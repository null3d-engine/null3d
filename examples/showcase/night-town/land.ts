// The night town's land: a crossroads square in a snowy clearing, with lanes that leave it to the
// four sides and gentle drifts that rise to the dark pines around. Cobbles show through the snow on
// the square and the lanes, and snow covers everything else. Every object that stands on the ground
// asks this module for its height, and for whether a point is on a road, so the houses, the lamps
// and the props meet the ground where it is.
import { math, type SketchContext } from '@null3d/engine';
import { type MountainRing, type MountainRingOptions, mountainRing } from '../../lib/mountains';
import { Noise, type TexelSample, terrain, textureSet } from '../../lib/procedural';

/** The width and depth of the land, in meters, centered on the origin. */
export const LAND = 140;
/** The half width and half depth of the square, in meters. */
export const SQUARE = { x: 8, z: 10 } as const;
/** The half width of each lane, in meters. */
export const LANE = 2.6;
/** How far each lane runs from the middle, in meters. */
const LANE_REACH = 52;

const noise = new Noise(17);
const { smoothstep } = math;

/** The height of the ground at a point. Flat in the town, then drifts that roll away to the pines. */
export function groundHeight(x: number, z: number): number {
	const r = Math.hypot(x, z);
	const far = smoothstep(r, 24, 64);
	const drifts =
		0.5 * noise.fbm2(x * 0.05 + 4, z * 0.05, 4) + 3.5 * noise.fbm2(x * 0.013, z * 0.013 + 9, 3);
	// A low bank of plowed snow rings the roads, where the carts push it aside.
	const road = stoneMask(x, z);
	const bank = 0.22 * (1 - road) * smoothstep(road, -0.35, -0.05) * smoothstep(r, 6, 20);
	return drifts * far + bank;
}

/** How much of the ground at a point is cobbled: 1 on the square and the lanes, 0 on the snow. */
export function stoneMask(x: number, z: number): number {
	const ax = Math.abs(x);
	const az = Math.abs(z);
	const square =
		(1 - smoothstep(ax, SQUARE.x - 0.8, SQUARE.x + 0.6)) *
		(1 - smoothstep(az, SQUARE.z - 0.8, SQUARE.z + 0.6));
	const alongX =
		(1 - smoothstep(az, LANE - 0.5, LANE + 0.5)) * (1 - smoothstep(ax, LANE_REACH - 3, LANE_REACH));
	const alongZ =
		(1 - smoothstep(ax, LANE - 0.5, LANE + 0.5)) * (1 - smoothstep(az, LANE_REACH - 3, LANE_REACH));
	return Math.min(1, square + alongX + alongZ);
}

/** True where an object may stand on a road: the lanes and the square, a little inside their edge. */
export function onRoad(x: number, z: number, margin = 0.6): boolean {
	return stoneMask(x, z) > 0.5 && nearRoad(x, z, margin);
}

/** True where a point lies within `margin` of a road's edge, on either side. */
function nearRoad(x: number, z: number, margin: number): boolean {
	const ax = Math.abs(x);
	const az = Math.abs(z);
	const inSquare = ax < SQUARE.x - margin && az < SQUARE.z - margin;
	const inLane = Math.min(ax, az) < LANE - margin && Math.max(ax, az) < LANE_REACH;
	return inSquare || inLane;
}

/** True where a point is clear of every road: the houses and the trees stand there. */
export function offRoad(x: number, z: number, margin = 1.2): boolean {
	return !nearRoad(x, z, -margin);
}

/** Linear colors of the ground: snow, packed snow, wet cobbles and the dark ruts between them. */
const SNOW: readonly [number, number, number] = [0.7, 0.75, 0.86];
const PACKED: readonly [number, number, number] = [0.5, 0.53, 0.6];
const COBBLE: readonly [number, number, number] = [0.24, 0.235, 0.23];
const RUT: readonly [number, number, number] = [0.12, 0.125, 0.14];

/** The ground's color at a point, from its slope and its distance from the roads and the well. */
function groundColor(x: number, z: number, _y: number, _slope: number, out: number[]): void {
	const road = stoneMask(x, z);
	const trodden = (1 - smoothstep(Math.hypot(x, z), 2, 9)) * road;
	const ruts = smoothstep(Math.abs(noise.fbm2(x * 0.5, z * 0.5, 3)), 0.15, 0.5) * road;
	const dirty = smoothstep(noise.fbm2(x * 0.09 + 3, z * 0.09, 3), 0.1, 0.6) * (1 - road);
	const shade = 0.85 + 0.3 * noise.value2(x * 1.7, z * 1.7);
	for (let c = 0; c < 3; c++) {
		// Snow, a little packed and grey where feet and carts pass.
		let ground =
			(SNOW[c] as number) +
			((PACKED[c] as number) - (SNOW[c] as number)) * Math.max(trodden, dirty * 0.35);
		// Cobbles, dark, with darker ruts between them, showing where the snow is swept away.
		const stone = (COBBLE[c] as number) + ((RUT[c] as number) - (COBBLE[c] as number)) * ruts;
		ground = ground + (stone - ground) * road;
		out[c] = ground * shade;
	}
}

/**
 * The texel of the ground's detail: rounded cobbles set in snow. The cobble cells show through the
 * snow where the vertex color is the stone's, and read as fine snow lumps elsewhere.
 */
function groundTexel(u: number, v: number, out: TexelSample): void {
	const cells = 7;
	const px = u * cells;
	const py = v * cells;
	const ix = Math.floor(px);
	const iy = Math.floor(py);
	let nearest = 9;
	let second = 9;
	for (let dy = -1; dy <= 1; dy++)
		for (let dx = -1; dx <= 1; dx++) {
			const cx = ix + dx;
			const cy = iy + dy;
			const jx = cx + 0.22 + 0.56 * cellHash(cx, cy);
			const jy = cy + 0.22 + 0.56 * cellHash(cx + 57, cy + 13);
			const d = Math.hypot(px - jx, py - jy);
			if (d < nearest) {
				second = nearest;
				nearest = d;
			} else if (d < second) second = d;
		}
	// The cobble's top is raised; the gap to its neighbour is a dark seam of snow.
	const seam = smoothstep(second - nearest, 0.02, 0.22);
	const grain = noise.value2(u * 90, v * 90, 90);
	out.height = 6 * seam + grain;
	const tone = 0.72 + 0.28 * seam + 0.06 * grain;
	out.r = tone;
	out.g = tone;
	out.b = tone * 0.98;
	out.roughness = 0.9 - 0.2 * seam;
	out.occlusion = 0.55 + 0.45 * seam;
}

/** A number from 0 to 1 for a lattice point, from an integer hash (never a sine). */
function cellHash(i: number, j: number): number {
	let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Makes the ground's mesh, whose detail grows with the preset, and its material. */
export function createLand(
	{ scene, geometry, materials, textures }: SketchContext,
	quads: number,
	textureSize: number,
): void {
	const maps = textureSet(textures, textureSize, groundTexel);
	const mesh = geometry.fromArrays(
		terrain({
			size: LAND,
			quads,
			tile: 2.6,
			middle: 0.2,
			height: groundHeight,
			color: groundColor,
		}),
	);
	scene.createMesh({
		mesh,
		material: materials.standard({ vertexColors: true, roughness: 1, ...maps }),
		receiveShadows: true,
		castShadows: false,
	});
}

/**
 * The mountains around the clearing: snowy peaks behind a dark band of forest. The lowest crest
 * stands above the highest that the Manual camera can climb (`MOUNTAINS.heights` against the
 * camera's bounds in the sketch), so the view never passes over the ring.
 */
export const MOUNTAINS = {
	crest: [260, 340],
	heights: [85, 165],
} as const;

/** The ring's settings, with `segments` bearings and `rows` rows. */
export const mountainSettings = (segments: number, rows: number): MountainRingOptions => ({
	half: LAND / 2,
	land: groundHeight,
	crest: MOUNTAINS.crest,
	heights: MOUNTAINS.heights,
	segments,
	rows,
	seed: 23,
	palette: {
		forest: [0.02, 0.035, 0.03],
		rock: [0.075, 0.075, 0.085],
		snow: SNOW,
		treeLine: 45,
		// Snow lies on every gentle slope, from the foot up.
		snowLine: -1000,
		frost: 0.3,
	},
});

/** Makes the ring of mountains around the land, with `segments` bearings and `rows` rows. */
export function createMountains(
	{ scene, geometry, materials }: SketchContext,
	segments: number,
	rows: number,
): MountainRing {
	const ring = mountainRing(mountainSettings(segments, rows));
	scene.createMesh({
		mesh: geometry.fromArrays(ring.arrays),
		material: materials.standard({ vertexColors: true, roughness: 1 }),
		castShadows: false,
		receiveShadows: false,
	});
	return ring;
}

// The night town's houses and its clock tower: half-timbered walls under snow-laden roofs, with lit
// windows that glow through the bloom. Every wall, roof and gable is built from arrays in code, and
// its beams come from a texture made in code. The windows, the doors and the chimneys are instance
// batches, so the whole town draws in a few calls. A clock tower of stone stands at the square's
// corner, with a lit face and a spire.
import { quat, type SketchContext, vec3 } from '@null3d/engine';
import { Noise, random, type TexelSample, textureSet } from '../../lib/procedural';
import { groundHeight } from './land';

/** A house lot: its middle, the way its front faces (radians about y), its size and its floors. */
export type Lot = readonly [
	x: number,
	z: number,
	yaw: number,
	width: number,
	depth: number,
	floors: number,
];

/** The houses around the square and down the lanes, art-directed by hand. */
export const LOTS: readonly Lot[] = [
	[-5, 12.2, Math.PI, 5.4, 4.6, 2],
	[5, 12.2, Math.PI, 6, 4.8, 3],
	[-5, -12.4, 0, 5.2, 4.6, 2],
	[5, -12.4, 0, 6.2, 5, 3],
	[10.6, -5, -Math.PI / 2, 5.4, 4.4, 2],
	[10.6, 3.2, -Math.PI / 2, 5.8, 4.6, 3],
	[-10.6, -4, Math.PI / 2, 5.6, 4.4, 2],
	[-10.6, 4.6, Math.PI / 2, 5.2, 4.6, 2],
	[-5, 21.5, Math.PI, 5, 4.2, 2],
	[5, 28.5, Math.PI, 5.6, 4.4, 2],
	[-5, -20, 0, 5.4, 4.2, 2],
	[20.5, -5, -Math.PI / 2, 5.8, 4.6, 2],
	[26.5, 5, -Math.PI / 2, 5.2, 4.4, 2],
	[-21.5, 5, Math.PI / 2, 5.4, 4.4, 2],
];

/** The tower's place, its width and its height. */
export const TOWER = { x: 12.6, z: 8.4, width: 4.2, height: 12.5 } as const;

/** The height of one floor, and the meters that one repeat of the wall texture covers. */
const FLOOR = 3.1;
const TILE = 2.4;
const noise = new Noise(53);

/** A smoothstep from 0 to 1. */
const smooth = (t: number) => {
	const x = Math.min(Math.max(t, 0), 1);
	return x * x * (3 - 2 * x);
};

/** One mesh being built from quads and triangles of their own vertices. */
interface Build {
	positions: number[];
	colors: number[];
	uvs: number[];
	indices: number[];
}
const build = (): Build => ({ positions: [], colors: [], uvs: [], indices: [] });
type V3 = readonly [number, number, number];
type V2 = readonly [number, number];

/** Adds a face of three or four points (counter-clockwise seen from outside). */
function face(b: Build, points: readonly V3[], uv: readonly V2[], color: V3): void {
	const first = b.positions.length / 3;
	for (let k = 0; k < points.length; k++) {
		const p = points[k] as V3;
		const t = uv[k] as V2;
		b.positions.push(p[0], p[1], p[2]);
		b.colors.push(color[0], color[1], color[2]);
		b.uvs.push(t[0], t[1]);
	}
	if (points.length === 3) b.indices.push(first, first + 1, first + 2);
	else b.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

/** Adds an axis-aligned box centered at `at`, with coordinates in meters so beams keep their size. */
function box(b: Build, at: V3, size: V3, color: V3): void {
	const [x, y, z] = at;
	const [w, h, d] = size.map((s) => s / 2) as [number, number, number];
	const [x0, x1, y0, y1, z0, z1] = [x - w, x + w, y - h, y + h, z - d, z + d];
	const u = (a: number) => a / TILE;
	const uv = (a: number, c: number, a2: number, c2: number): V2[] => [
		[u(a), u(c)],
		[u(a2), u(c)],
		[u(a2), u(c2)],
		[u(a), u(c2)],
	];
	face(
		b,
		[
			[x0, y0, z1],
			[x1, y0, z1],
			[x1, y1, z1],
			[x0, y1, z1],
		],
		uv(x0, y0, x1, y1),
		color,
	);
	face(
		b,
		[
			[x1, y0, z0],
			[x0, y0, z0],
			[x0, y1, z0],
			[x1, y1, z0],
		],
		uv(x1, y0, x0, y1),
		color,
	);
	face(
		b,
		[
			[x1, y0, z1],
			[x1, y0, z0],
			[x1, y1, z0],
			[x1, y1, z1],
		],
		uv(z1, y0, z0, y1),
		color,
	);
	face(
		b,
		[
			[x0, y0, z0],
			[x0, y0, z1],
			[x0, y1, z1],
			[x0, y1, z0],
		],
		uv(z0, y0, z1, y1),
		color,
	);
	face(
		b,
		[
			[x0, y1, z1],
			[x1, y1, z1],
			[x1, y1, z0],
			[x0, y1, z0],
		],
		uv(x0, z1, x1, z0),
		color,
	);
	face(
		b,
		[
			[x0, y0, z0],
			[x1, y0, z0],
			[x1, y0, z1],
			[x0, y0, z1],
		],
		uv(x0, z0, x1, z1),
		color,
	);
}

/** A wall's texel: plaster between dark beams, with a diagonal brace in each bay. */
function timberTexel(u: number, v: number, out: TexelSample): void {
	const grain = noise.fbm2(u * 20, v * 20, 4);
	const studs = 1 - smooth(Math.min((u * 4) % 1, 1 - ((u * 4) % 1)) / 0.06);
	const rails = Math.max(
		1 - smooth(Math.abs(v - 0.08) / 0.05),
		1 - smooth(Math.abs(v - 0.92) / 0.05),
	);
	const bay = Math.floor(u * 4) % 2 === 0;
	const bu = (u * 4) % 1;
	const brace = bay
		? 1 -
			smooth(Math.min(Math.abs(v - (0.12 + bu * 0.76)), Math.abs(v - (0.88 - bu * 0.76))) / 0.05)
		: 0;
	const beam = Math.max(studs, Math.max(rails, brace));
	const plaster = 0.6 + 0.16 * grain;
	out.height = beam * 7 + grain * 1.5;
	out.r = beam ? 0.19 : plaster * 1.06;
	out.g = beam ? 0.12 : plaster;
	out.b = beam ? 0.08 : plaster * 0.88;
	out.roughness = beam ? 0.7 : 0.95;
	out.occlusion = beam ? 0.9 : 0.8 + 0.15 * grain;
}

/** A roof's texel: dark slate tiles, lapped in rows, which the snow does not quite hide. */
function roofTexel(u: number, v: number, out: TexelSample): void {
	const rows = 8;
	const row = Math.floor(v * rows);
	const tileU = (u * 5 + (row % 2) * 0.5) % 1;
	const lap = (v * rows) % 1;
	const edge = 1 - smooth(Math.min(tileU, 1 - tileU) / 0.06);
	out.height = edge * 3 + lap * 1.5 + 0.4 * noise.value2(u * 40, v * 40, 40);
	const shade = 0.42 + 0.16 * noise.fbm2(u * 7 + 2, v * 7, 3) - 0.22 * (1 - lap);
	out.r = shade;
	out.g = shade * 0.99;
	out.b = shade * 0.97;
	out.roughness = 0.75;
	out.occlusion = 0.6 + 0.4 * edge;
}

/** The tower's stone texel: blocks with courses offset every other row. */
function stoneTexel(u: number, v: number, out: TexelSample): void {
	const rows = 9;
	const row = Math.floor(v * rows);
	const bu = (u * 4 + (row % 2) * 0.5) % 1;
	const across = Math.min(
		1 - smooth(Math.min(bu, 1 - bu) / 0.04),
		1 - smooth(Math.abs(((v * rows) % 1) - 0.5) * 2 - 0.86),
	);
	const grain = noise.fbm2(u * 26, v * 26, 4);
	const tone = 0.36 + 0.16 * grain - 0.2 * across;
	out.height = (1 - across) * 5 + grain * 2;
	out.r = tone;
	out.g = tone * 0.98;
	out.b = tone * 0.95;
	out.roughness = 0.9 - 0.15 * across;
	out.occlusion = 0.5 + 0.5 * (1 - across);
}

/** A window's texel: a warm pane, divided by a dark mullion, inside a dark frame. */
function windowTexel(u: number, v: number, out: TexelSample): void {
	const frame = Math.min(u, 1 - u, v, 1 - v) * 2;
	const mullion = Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
	const pane = smooth(Math.min(frame, mullion) / 0.09);
	out.height = 0.5;
	out.r = pane;
	out.g = pane * 0.95;
	out.b = pane * 0.8;
	out.roughness = 0.4;
	out.occlusion = pane ? 1 : 0.2;
}

const SNOW: V3 = [0.82, 0.88, 1];
const GABLE: V3 = [0.6, 0.58, 0.54];

/** The walls (with gables) and the roof slopes of one house, its front facing +z and base y = 0. */
export function house(width: number, depth: number, floors: number): { walls: Build; roof: Build } {
	const h = floors * FLOOR + 0.25;
	const w = width / 2;
	const d = depth / 2;
	const ridge = h + depth * 0.42;
	const walls = build();
	const u = (a: number) => a / TILE;
	const v = (a: number) => a / TILE;
	face(
		walls,
		[
			[-w, 0, d],
			[w, 0, d],
			[w, h, d],
			[-w, h, d],
		],
		[
			[u(-w), v(0)],
			[u(w), v(0)],
			[u(w), v(h)],
			[u(-w), v(h)],
		],
		[1, 1, 1],
	);
	face(
		walls,
		[
			[w, 0, -d],
			[-w, 0, -d],
			[-w, h, -d],
			[w, h, -d],
		],
		[
			[u(w), v(0)],
			[u(-w), v(0)],
			[u(-w), v(h)],
			[u(w), v(h)],
		],
		[1, 1, 1],
	);
	face(
		walls,
		[
			[w, 0, d],
			[w, 0, -d],
			[w, h, -d],
			[w, h, d],
		],
		[
			[u(d), v(0)],
			[u(-d), v(0)],
			[u(-d), v(h)],
			[u(d), v(h)],
		],
		[1, 1, 1],
	);
	face(
		walls,
		[
			[-w, 0, -d],
			[-w, 0, d],
			[-w, h, d],
			[-w, h, -d],
		],
		[
			[u(-d), v(0)],
			[u(d), v(0)],
			[u(d), v(h)],
			[u(-d), v(h)],
		],
		[1, 1, 1],
	);
	// The gable triangles fill the wall top under the ridge, which runs along x.
	face(
		walls,
		[
			[w, h, d],
			[w, h, -d],
			[w, ridge, 0],
		],
		[
			[u(0), v(h)],
			[u(0), v(h)],
			[u(0), v(ridge)],
		],
		GABLE,
	);
	face(
		walls,
		[
			[-w, h, -d],
			[-w, h, d],
			[-w, ridge, 0],
		],
		[
			[u(0), v(h)],
			[u(0), v(h)],
			[u(0), v(ridge)],
		],
		GABLE,
	);
	// The two roof slopes, overhanging the walls, with the snow.
	const roof = build();
	const reach = depth / 2 + 0.5;
	const ends = width / 2 + 0.35;
	const slope = Math.hypot(reach, ridge - h) / TILE;
	face(
		roof,
		[
			[-ends, h, reach],
			[ends, h, reach],
			[ends, ridge, 0],
			[-ends, ridge, 0],
		],
		[
			[0, 0],
			[(2 * ends) / TILE, 0],
			[(2 * ends) / TILE, slope],
			[0, slope],
		],
		SNOW,
	);
	face(
		roof,
		[
			[ends, h, -reach],
			[-ends, h, -reach],
			[-ends, ridge, 0],
			[ends, ridge, 0],
		],
		[
			[0, 0],
			[(2 * ends) / TILE, 0],
			[(2 * ends) / TILE, slope],
			[0, slope],
		],
		SNOW,
	);
	return { walls, roof };
}

/**
 * The height of a house's roof surface above its base at local `lz`, where the ridge (the roof's
 * highest line) runs along local x at z = 0. A chimney stands on this surface, so it never floats.
 */
function roofSurface(depth: number, floors: number, lz: number): number {
	const h = floors * FLOOR + 0.25;
	const ridge = h + depth * 0.42;
	const reach = depth / 2 + 0.5;
	return ridge - (Math.abs(lz) / reach) * (ridge - h);
}

/** The homes whose chimneys smoke, and how high each chimney stands. */
export interface Home {
	x: number;
	z: number;
	top: number;
}

/** The town's houses, tower, lit windows and doors, with what the air and the props need. */
export function createHouses(
	{ scene, geometry, materials, textures }: SketchContext,
	textureSize: number,
): {
	homes: Home[];
	windows: number;
	/** Sets the share of the windows' light that the hour allows: none by day, all at night. */
	power(share: number): void;
	clear(x: number, z: number): boolean;
} {
	const wallMaps = textureSet(textures, textureSize, timberTexel, 4);
	const roofMaps = textureSet(textures, Math.max(128, textureSize >> 1), roofTexel);
	const stoneMaps = textureSet(textures, Math.max(128, textureSize >> 1), stoneTexel);
	const wallMat = materials.standard({ ...wallMaps, roughness: 0.95 });
	const roofMat = materials.standard({ ...roofMaps, roughness: 0.72, vertexColors: true });
	const stoneMat = materials.standard({ ...stoneMaps, roughness: 0.95 });
	const next = random(83);

	const glass = new Uint8Array(64 * 64 * 4);
	const sample: TexelSample = { height: 0, r: 0, g: 0, b: 0, roughness: 1, occlusion: 1 };
	for (let i = 0; i < 64 * 64; i++) {
		windowTexel(((i % 64) + 0.5) / 64, (Math.floor(i / 64) + 0.5) / 64, sample);
		glass.set(
			[Math.round(sample.r * 255), Math.round(sample.g * 255), Math.round(sample.b * 255), 255],
			i * 4,
		);
	}
	const windowRows: {
		at: V3;
		yaw: number;
		w: number;
		h: number;
		lit: number;
		warm: number;
		cool: number;
	}[] = [];
	const doorRows: { at: V3; yaw: number }[] = [];
	const homes: Home[] = [];
	const potRows: { at: V3; yaw: number }[] = [];

	for (const lot of LOTS) {
		const [x, z, yaw, width, depth, floors] = lot;
		const y = groundHeight(x, z);
		const { walls, roof } = house(width, depth, floors);
		const turn = quat.fromEuler(quat.create(), 0, yaw, 0);
		scene.createMesh({
			mesh: geometry.fromArrays({ ...walls, computeNormals: true }),
			material: wallMat,
			position: [x, y, z],
			rotation: turn,
			castShadows: true,
			receiveShadows: true,
		});
		scene.createMesh({
			mesh: geometry.fromArrays({ ...roof, computeNormals: true }),
			material: roofMat,
			position: [x, y, z],
			rotation: turn,
			castShadows: true,
			receiveShadows: true,
		});
		const on = (lx: number, lz: number): V3 => {
			const p = vec3.transformQuat(
				vec3.create(),
				[lx, 0, lz],
				quat.fromEuler(quat.create(), 0, yaw, 0),
			);
			return [x + (p[0] as number), y, z + (p[2] as number)];
		};
		// The windows: a row across the front on each floor, and one on each side above the ground.
		const front = depth / 2 + 0.05;
		for (let f = 0; f < floors; f++) {
			const wy = y + f * FLOOR + 1.7;
			const across = Math.max(1, Math.round(width / 2.4));
			for (let k = 0; k < across; k++) {
				const at = on(((k + 0.5) / across - 0.5) * (width - 1.3), front);
				windowRows.push({
					at: [at[0], wy, at[2]],
					yaw,
					w: 0.84,
					h: 1.12,
					lit: next() < 0.8 ? 1 : 0,
					warm: 0.6 + 0.5 * next(),
					cool: next() < 0.15 ? 1 : 0,
				});
			}
			if (f > 0)
				for (const side of [-1, 1]) {
					const at = on(side * (width / 2 + 0.05), (next() - 0.5) * (depth - 1.4));
					windowRows.push({
						at: [at[0], wy, at[2]],
						yaw: yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2),
						w: 0.78,
						h: 1.04,
						lit: next() < 0.5 ? 1 : 0,
						warm: 0.5 + 0.5 * next(),
						cool: 0,
					});
				}
		}
		const doorAt = on((next() - 0.5) * (width - 2.2), front + 0.02);
		doorRows.push({ at: [doorAt[0], y + 1.05, doorAt[2]], yaw });
		// The chimney: near the ridge but set off it, so its base meets the sloped roof on both
		// sides. Its base sinks a little below the surface, which hides the wedge the slope leaves.
		const lx = (next() - 0.5) * width * 0.4;
		const lz = (next() - 0.5) * depth * 0.5;
		const potAt = on(lx, lz);
		const base = y + roofSurface(depth, floors, lz) - 0.35;
		potRows.push({ at: [potAt[0], base, potAt[2]], yaw });
		homes.push({ x: potAt[0], z: potAt[2], top: base + 2.1 });
	}

	const windows = scene.createInstances(
		geometry.plane({ width: 1, height: 1 }),
		windowRows.length,
		{
			material: materials.shader({
				wgsl: WINDOW_WGSL,
				color: '#120f0b',
				roughness: 0.5,
				textures: {
					glassMap: textures.fromData({
						width: 64,
						height: 64,
						data: glass,
						colorSpace: 'srgb',
						mipmaps: true,
					}),
				},
			}),
			values: true,
		},
	);
	windowRows.forEach((row, k) => {
		windows.positions.set(row.at, k * 3);
		windows.rotations.set(quat.fromEuler(quat.create(), 0, row.yaw, 0), k * 4);
		windows.scales.set([row.w, row.h, 1], k * 3);
		(windows.values as Float32Array).set([row.lit, row.warm, next(), row.cool], k * 4);
	});
	windows.markDirty();

	/** The share of the windows' light that the hour allows: none by day, all at night. */
	let glow = 1;
	const setGlow = (share: number): void => {
		if (Math.abs(share - glow) < 0.02) return;
		glow = share;
		const values = windows.values as Float32Array;
		for (let k = 0; k < windowRows.length; k++)
			values[k * 4] = (windowRows[k]?.lit as number) * share;
		windows.markDirty();
	};

	const doors = scene.createInstances(
		geometry.box({ width: 0.95, height: 2.1, depth: 0.12 }),
		doorRows.length,
		{
			material: materials.standard({ color: '#37220f', roughness: 0.8 }),
		},
	);
	doorRows.forEach((row, k) => {
		doors.positions.set(row.at, k * 3);
		doors.rotations.set(quat.fromEuler(quat.create(), 0, row.yaw, 0), k * 4);
	});
	doors.markDirty();

	const pots = scene.createInstances(
		geometry.fromArrays({ ...chimney(), computeNormals: true }),
		potRows.length,
		{
			material: materials.standard({ color: '#6b635a', roughness: 0.95, vertexColors: true }),
		},
	);
	potRows.forEach((row, k) => {
		pots.positions.set(row.at, k * 3);
		pots.rotations.set(quat.fromEuler(quat.create(), 0, row.yaw, 0), k * 4);
	});
	pots.markDirty();

	// The tower, at the square's corner, and its lit clock face.
	const { x, z, width, height } = TOWER;
	const ty = groundHeight(x, z);
	scene.createMesh({
		mesh: geometry.fromArrays({ ...towerBody(width, height), computeNormals: true }),
		material: stoneMat,
		position: [x, ty, z],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.fromArrays({ ...towerSpire(width, height), computeNormals: true }),
		material: roofMat,
		position: [x, ty, z],
		castShadows: true,
		receiveShadows: true,
	});
	const dir = Math.atan2(-x, -z);
	const clock = scene.createInstances(geometry.circle({ radius: 0.85, segments: 24 }), 1, {
		material: materials.standard({
			color: '#20180c',
			emissive: '#ffc463',
			emissiveIntensity: 2.4,
			roughness: 0.5,
		}),
	});
	const offset = vec3.transformQuat(
		vec3.create(),
		[0, 0, width / 2 + 0.06],
		quat.fromEuler(quat.create(), 0, dir, 0),
	);
	clock.positions.set([x + (offset[0] as number), ty + height - 2.6, z + (offset[2] as number)], 0);
	clock.rotations.set(quat.fromEuler(quat.create(), 0, dir, 0), 0);
	clock.markDirty();

	const footprints = [
		...LOTS.map(([lx, lz, , lw, ld]) => ({ x: lx, z: lz, r: Math.max(lw, ld) * 0.62 + 0.7 })),
		{ x: TOWER.x, z: TOWER.z, r: TOWER.width },
	];
	return {
		homes,
		windows: windowRows.filter((row) => row.lit > 0).length,
		power: setGlow,
		clear: (px, pz) => footprints.some((f) => (px - f.x) ** 2 + (pz - f.z) ** 2 < f.r * f.r),
	};
}

/** The tower's shaft: a square body of stone with a wider belfry band near the top. */
function towerBody(width: number, height: number): Build {
	const b = build();
	const body = height - 2.5;
	box(b, [0, body / 2, 0], [width, body, width], [1, 1, 1]);
	const bw = width + 0.7;
	box(b, [0, body + 0.85, 0], [bw, 1.7, bw], [0.7, 0.7, 0.74]);
	return b;
}

/** The tower's spire: a tall pyramid of snow-topped slate over a cornice. */
function towerSpire(width: number, height: number): Build {
	const b = build();
	const w = width / 2 + 0.85;
	const base = height - 0.5;
	const tip = height + width * 1.6;
	// The cornice caps the belfry and carries the spire's foot. It reaches back to the band below
	// and out past the spire, so no slot of sky shows between them.
	box(b, [0, base + 0.1, 0], [2 * w + 0.4, 1.0, 2 * w + 0.4], SNOW);
	// Each slate face tiles like a house's roof: its rows run up the slope, its columns across the
	// base edge. The corners are counter-clockwise seen from outside, so the faces show, not hide.
	const upper = base + 0.35;
	const edge = w * Math.SQRT2;
	const across = edge / TILE;
	const slope = Math.hypot(w * Math.SQRT1_2, tip - upper) / TILE;
	for (let side = 0; side < 4; side++) {
		const a = (side * Math.PI) / 2;
		const p0: V3 = [Math.cos(a) * w, upper, Math.sin(a) * w];
		const p1: V3 = [Math.cos(a + Math.PI / 2) * w, upper, Math.sin(a + Math.PI / 2) * w];
		face(
			b,
			[p1, p0, [0, tip, 0]],
			[
				[0, 0],
				[across, 0],
				[across / 2, slope],
			],
			side % 2 === 0 ? SNOW : [0.62, 0.68, 0.8],
		);
	}
	return b;
}

/** A chimney pot: a stone shaft with a cap and a snow cap, each meeting the one below it exactly. */
export function chimney(): Build {
	const b = build();
	const w = 0.42;
	box(b, [0, 0.85, 0], [2 * w, 1.7, 2 * w], [1, 1, 1]);
	box(b, [0, 1.83, 0], [2 * w + 0.24, 0.26, 2 * w + 0.24], [1, 1, 1]);
	box(b, [0, 2.03, 0], [2 * w + 0.24, 0.14, 2 * w + 0.24], SNOW);
	return b;
}

/** The window shader: a dark frame whose pane glows warm from the row's own tint and flicker. */
const WINDOW_WGSL = /* wgsl */ `
#import null3d::noise::{value2}

var glassMap: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let t = textureSample(glassMap, glassMapSampler, input.uv);
    let v = object.values;
    // A candle behind the pane flickers a little; its phase comes from the row.
    let flicker = 0.88 + 0.12 * value2(vec2f(v.z * 40.0, frame.time * 0.7));
    let warm = mix(vec3f(1.0, 0.58, 0.26), vec3f(1.0, 0.82, 0.55), v.y);
    let tint = select(warm, vec3f(0.6, 0.72, 1.0), v.w > 0.5);
    s.baseColor = t.rgb * 0.05;
    s.emissive = t.rgb * tint * v.x * flicker * 2.6;
    s.roughness = 0.45;
    return s;
}
`;

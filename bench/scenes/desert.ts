// The desert, the scene that compares null3D with three.js's meshlet renderer: a dune ground, fluted
// columns, rock arches, boulders and pebbles, made from fixed seeds, so every run and both engines
// get the same shapes and places. The unique meshes hold about seven million triangles. Copies of
// them raise the scene's full-detail count to about 1.7 billion, which only a renderer that culls
// and picks coarser detail can draw. A camera walks a loop through the main temple, or circles high
// above the whole desert.
//
// Everything here is plain data and pure functions with no engine imports, as in spec.ts. The build
// of the model files, both engines' pages and the unit tests read the same module.
import { mulberry32 } from './spec';

/** The canvas of a desert run, in CSS pixels, at one device pixel per CSS pixel, for both engines. */
export const DESERT_CANVAS = { width: 1920, height: 1080, pixelRatio: 1 } as const;

/** The camera's two paths: `walk` at head height through the temple, `aerial` high above. */
export const DESERT_VIEWS = ['walk', 'aerial'] as const;
export type DesertView = (typeof DESERT_VIEWS)[number];

/** The side of the square ground, in meters. */
export const GROUND_SIZE = 800;

/** The grid cells along each side of the ground. */
export const GROUND_CELLS = 1000;

/** The materials, by name: base color as linear RGB and roughness. Every material is a dielectric. */
export const DESERT_MATERIALS = {
	sand: { color: [0.62, 0.42, 0.24], roughness: 0.95 },
	sandstone: { color: [0.72, 0.55, 0.38], roughness: 0.85 },
	rock: { color: [0.46, 0.27, 0.16], roughness: 0.9 },
	pebble: { color: [0.36, 0.33, 0.3], roughness: 0.8 },
} as const;
export type DesertMaterial = keyof typeof DESERT_MATERIALS;

/** The sun's direction of travel, toward the ground, its strength and its linear color. */
export const DESERT_SUN = {
	direction: [-0.45, -0.75, -0.48],
	intensity: 3,
	color: [1, 0.93, 0.82],
} as const;

/**
 * The sun's shadows when a page turns them on. null3D draws `cascades` maps of `mapSize` texels on
 * each side over `distance` meters from the camera. three.js's meshlet renderer draws one map of
 * `threeMapSize` texels, which covers the same distance around the camera, because it draws no
 * cascades: with three.js's cascaded shadow node the meshlet renderer drew only the sky.
 */
export const DESERT_SHADOWS = {
	cascades: 3,
	mapSize: 2048,
	threeMapSize: 4096,
	distance: 150,
} as const;

/** The sky's color, linear RGB, and the strength of the light from the whole sky. */
export const DESERT_SKY = { color: [0.55, 0.68, 0.85], ambient: 0.55 } as const;

/** The camera: its vertical field of view in degrees, and its near and far planes in meters. */
export const DESERT_CAMERA = { fov: 55, near: 0.1, far: 2000 } as const;

/**
 * The settings of three.js's meshlet renderer. Occlusion culling is on, as three.js ships it, and
 * no object is left out for its size on the screen, so both engines draw every copy in view.
 */
export const THREE_MESHLETS = { occlusionCulling: true, minScreenRadius: 0 } as const;

// Seeded noise.

/** The seed of the noise's permutation table. */
const NOISE_SEED = 1234;

const PERM = (() => {
	const next = mulberry32(NOISE_SEED);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		const t = p[i] as number;
		p[i] = p[j] as number;
		p[j] = t;
	}
	const table = new Uint8Array(512);
	for (let i = 0; i < 512; i++) table[i] = p[i & 255] as number;
	return table;
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);
const perm = (i: number) => PERM[i] as number;

function grad(hash: number, x: number, y: number, z: number): number {
	const h = hash & 15;
	const u = h < 8 ? x : y;
	const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
	return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Gradient noise in three dimensions, from about -1 to 1. */
export function noise3(x: number, y: number, z: number): number {
	const fx = Math.floor(x);
	const fy = Math.floor(y);
	const fz = Math.floor(z);
	const X = fx & 255;
	const Y = fy & 255;
	const Z = fz & 255;
	x -= fx;
	y -= fy;
	z -= fz;
	const u = fade(x);
	const v = fade(y);
	const w = fade(z);
	const A = perm(X) + Y;
	const AA = perm(A) + Z;
	const AB = perm(A + 1) + Z;
	const B = perm(X + 1) + Y;
	const BA = perm(B) + Z;
	const BB = perm(B + 1) + Z;
	return lerp(
		w,
		lerp(
			v,
			lerp(u, grad(perm(AA), x, y, z), grad(perm(BA), x - 1, y, z)),
			lerp(u, grad(perm(AB), x, y - 1, z), grad(perm(BB), x - 1, y - 1, z)),
		),
		lerp(
			v,
			lerp(u, grad(perm(AA + 1), x, y, z - 1), grad(perm(BA + 1), x - 1, y, z - 1)),
			lerp(u, grad(perm(AB + 1), x, y - 1, z - 1), grad(perm(BB + 1), x - 1, y - 1, z - 1)),
		),
	);
}

/** Noise summed over octaves that each double the frequency and halve the strength. */
export function fbm(x: number, y: number, z: number, octaves: number): number {
	let sum = 0;
	let amplitude = 0.5;
	let frequency = 1;
	for (let o = 0; o < octaves; o++) {
		sum += amplitude * noise3(x * frequency, y * frequency, z * frequency);
		amplitude *= 0.5;
		frequency *= 2;
	}
	return sum;
}

// The meshes.

/** A mesh's arrays: three floats per vertex of positions and of unit normals, three indices per triangle. */
export interface DesertMeshData {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint32Array;
}

/** The height of the dunes at a point of the ground, in meters. */
export function groundHeight(x: number, z: number): number {
	const ridge = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2.2) * 2.4;
	const swell = fbm(x * 0.004, 0.5, z * 0.004, 3) * 14;
	const ripples = Math.sin(x * 0.35 + z * 0.12 + fbm(x * 0.02, 1.5, z * 0.02, 2) * 6) * 0.08;
	return ridge + swell + ripples;
}

/** The ground: a grid of `cells` by `cells` squares over the whole desert, two triangles each. */
export function buildGround(cells = GROUND_CELLS): DesertMeshData {
	const n = cells + 1;
	const step = GROUND_SIZE / cells;
	const half = GROUND_SIZE / 2;
	const positions = new Float32Array(n * n * 3);
	const normals = new Float32Array(n * n * 3);
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const x = -half + i * step;
			const z = -half + j * step;
			const k = (j * n + i) * 3;
			positions[k] = x;
			positions[k + 1] = groundHeight(x, z);
			positions[k + 2] = z;
			const dx = groundHeight(x + 0.05, z) - groundHeight(x - 0.05, z);
			const dz = groundHeight(x, z + 0.05) - groundHeight(x, z - 0.05);
			const length = Math.hypot(dx, 0.1, dz);
			normals[k] = -dx / length;
			normals[k + 1] = 0.1 / length;
			normals[k + 2] = -dz / length;
		}
	}
	const indices = new Uint32Array(cells * cells * 6);
	let o = 0;
	for (let j = 0; j < cells; j++) {
		for (let i = 0; i < cells; i++) {
			const a = j * n + i;
			const b = a + 1;
			const c = a + n;
			const d = c + 1;
			indices.set([a, c, b, b, c, d], o);
			o += 6;
		}
	}
	return { positions, normals, indices };
}

/** Area-weighted vertex normals of an indexed triangle list. */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
	const normals = new Float32Array(positions.length);
	const p = (i: number) => positions[i] as number;
	for (let t = 0; t < indices.length; t += 3) {
		const a = (indices[t] as number) * 3;
		const b = (indices[t + 1] as number) * 3;
		const c = (indices[t + 2] as number) * 3;
		const e1x = p(b) - p(a);
		const e1y = p(b + 1) - p(a + 1);
		const e1z = p(b + 2) - p(a + 2);
		const e2x = p(c) - p(a);
		const e2y = p(c + 1) - p(a + 1);
		const e2z = p(c + 2) - p(a + 2);
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		for (const v of [a, b, c]) {
			normals[v] = (normals[v] as number) + nx;
			normals[v + 1] = (normals[v + 1] as number) + ny;
			normals[v + 2] = (normals[v + 2] as number) + nz;
		}
	}
	for (let v = 0; v < normals.length; v += 3) {
		const x = normals[v] as number;
		const y = normals[v + 1] as number;
		const z = normals[v + 2] as number;
		const length = Math.hypot(x, y, z) || 1;
		normals[v] = x / length;
		normals[v + 1] = y / length;
		normals[v + 2] = z / length;
	}
	return normals;
}

/**
 * The indices of a grid of rings that wraps around its second axis: `rows` rings of `around`
 * vertices each, with the seam's vertices shared. `flip` reverses the winding.
 */
function wrappedGridIndices(rows: number, around: number, flip: boolean): Uint32Array {
	const indices = new Uint32Array((rows - 1) * around * 6);
	let o = 0;
	for (let r = 0; r < rows - 1; r++) {
		for (let s = 0; s < around; s++) {
			const a = r * around + s;
			const b = r * around + ((s + 1) % around);
			const c = a + around;
			const d = b + around;
			indices.set(flip ? [a, b, c, b, d, c] : [a, c, b, b, c, d], o);
			o += 6;
		}
	}
	return indices;
}

/** The radius of a column's profile at a height, before its flutes and wear. */
function columnRadius(y: number, height: number, capital: boolean): number {
	if (y < 0.35) return 0.82;
	if (y < 0.7) return 0.62 + 0.1 * Math.sin(((y - 0.35) / 0.35) * Math.PI);
	const top = capital ? height - 1.1 : height;
	if (y < top) return 0.52 - 0.07 * ((y - 0.7) / (top - 0.7)) ** 1.5;
	if (y < height - 0.4) return 0.45 + 0.3 * ((y - top) / (height - 0.4 - top)) ** 2;
	return 0.82;
}

/** A fluted column: two whole ones with capitals, and a third broken, with a jagged top. */
function buildColumn(variant: number): DesertMeshData {
	const height = [9, 10.5, 5.5][variant] as number;
	const capital = variant !== 2;
	const rows = 900;
	const around = 288;
	const flutes = 24;
	const seed = variant * 17.3;
	const positions = new Float32Array((rows + 1) * around * 3 + 3);
	for (let r = 0; r <= rows; r++) {
		const y = (r / rows) * height;
		const base = columnRadius(y, height, capital);
		const shaft = y > 0.7 && y < (capital ? height - 1.1 : height);
		for (let s = 0; s < around; s++) {
			const angle = (s / around) * Math.PI * 2;
			const cx = Math.cos(angle);
			const cz = Math.sin(angle);
			let radius = base;
			if (shaft) radius *= 1 - 0.045 * Math.abs(Math.sin(angle * flutes * 0.5)) ** 0.6;
			radius += 0.025 * fbm(cx * 2 + seed, y * 0.9, cz * 2, 4);
			const k = (r * around + s) * 3;
			positions[k] = cx * radius;
			positions[k + 1] = y;
			positions[k + 2] = cz * radius;
		}
	}
	if (!capital) {
		for (let s = 0; s < around; s++) {
			const angle = (s / around) * Math.PI * 2;
			const drop = 0.6 * (0.5 + 0.5 * fbm(Math.cos(angle) * 1.5, 3.3, Math.sin(angle) * 1.5, 3));
			for (let r = rows - 20; r <= rows; r++) {
				const k = (r * around + s) * 3 + 1;
				positions[k] = Math.min(positions[k] as number, height - drop * ((r - rows + 20) / 20));
			}
		}
	}
	// The top closes with a fan around a center vertex, the last of the list.
	const center = (rows + 1) * around;
	positions[center * 3 + 1] = capital ? height : height - 0.3;
	const side = wrappedGridIndices(rows + 1, around, false);
	const indices = new Uint32Array(side.length + around * 3);
	indices.set(side);
	let o = side.length;
	const top = rows * around;
	for (let s = 0; s < around; s++) {
		indices.set([top + s, center, top + ((s + 1) % around)], o);
		o += 3;
	}
	return { positions, normals: vertexNormals(positions, indices), indices };
}

/** A rock arch: a tube along a half ellipse whose legs reach below the ground, worn by noise. */
function buildArch(variant: number): DesertMeshData {
	const span = [12, 15, 10][variant] as number;
	const rise = [1.1, 0.8, 1.4][variant] as number;
	const along = 1600;
	const around = 320;
	const seed = 40 + variant * 9.1;
	const positions = new Float32Array(along * around * 3);
	for (let a = 0; a < along; a++) {
		const t = -0.1 + (a / (along - 1)) * 1.2;
		const angle = Math.PI * t;
		const cx = span * Math.cos(angle);
		const cy = span * rise * Math.sin(angle);
		// The tangent, and the normal in the arch's plane that points away from its center.
		const tx = -span * Math.sin(angle);
		const ty = span * rise * Math.cos(angle);
		const tl = Math.hypot(tx, ty);
		const nx = ty / tl;
		const ny = -tx / tl;
		const thickness = 2.1 + 1.6 * (1 - Math.min(1, Math.max(0, Math.sin(angle)))) ** 2;
		for (let s = 0; s < around; s++) {
			const phi = (s / around) * Math.PI * 2;
			const ox = nx * Math.cos(phi);
			const oy = ny * Math.cos(phi);
			const oz = Math.sin(phi) * 1.3;
			const px = cx + ox * thickness;
			const py = cy + oy * thickness;
			const pz = oz * thickness;
			const bump =
				fbm(px * 0.18 + seed, py * 0.18, pz * 0.18, 5) * 1.6 +
				Math.abs(noise3(px * 0.9, py * 2.5 + seed, pz * 0.9)) * 0.25;
			const k = (a * around + s) * 3;
			positions[k] = px + ox * bump;
			positions[k + 1] = py + oy * bump;
			positions[k + 2] = pz + oz * bump;
		}
	}
	const indices = wrappedGridIndices(along, around, true);
	return { positions, normals: vertexNormals(positions, indices), indices };
}

/** The twelve corners of an icosahedron, on the unit sphere, and its twenty faces. */
const ICOSAHEDRON = (() => {
	const t = (1 + Math.sqrt(5)) / 2;
	const corners = [
		[-1, t, 0],
		[1, t, 0],
		[-1, -t, 0],
		[1, -t, 0],
		[0, -1, t],
		[0, 1, t],
		[0, -1, -t],
		[0, 1, -t],
		[t, 0, -1],
		[t, 0, 1],
		[-t, 0, -1],
		[-t, 0, 1],
	];
	const faces = [
		[0, 11, 5],
		[0, 5, 1],
		[0, 1, 7],
		[0, 7, 10],
		[0, 10, 11],
		[1, 5, 9],
		[5, 11, 4],
		[11, 10, 2],
		[10, 7, 6],
		[7, 1, 8],
		[3, 9, 4],
		[3, 4, 2],
		[3, 2, 6],
		[3, 6, 8],
		[3, 8, 9],
		[4, 9, 5],
		[2, 4, 11],
		[6, 2, 10],
		[8, 6, 7],
		[9, 8, 1],
	];
	return { corners, faces };
})();

type Triple = [number, number, number];

/** A unit icosphere: each subdivision splits every triangle into four, with shared vertices. */
export function icosphere(subdivisions: number): { points: Triple[]; faces: Triple[] } {
	const points = ICOSAHEDRON.corners.map(([x = 0, y = 0, z = 0]): Triple => {
		const l = Math.hypot(x, y, z);
		return [x / l, y / l, z / l];
	});
	let faces = ICOSAHEDRON.faces.map(([a = 0, b = 0, c = 0]): Triple => [a, b, c]);
	for (let d = 0; d < subdivisions; d++) {
		const middles = new Map<number, number>();
		const middle = (a: number, b: number) => {
			const key = a < b ? a * 1e7 + b : b * 1e7 + a;
			let index = middles.get(key);
			if (index === undefined) {
				const [ax, ay, az] = points[a] as Triple;
				const [bx, by, bz] = points[b] as Triple;
				const l = Math.hypot(ax + bx, ay + by, az + bz);
				index = points.length;
				points.push([(ax + bx) / l, (ay + by) / l, (az + bz) / l]);
				middles.set(key, index);
			}
			return index;
		};
		const next: Triple[] = [];
		for (const [a, b, c] of faces) {
			const ab = middle(a, b);
			const bc = middle(b, c);
			const ca = middle(c, a);
			next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
		}
		faces = next;
	}
	return { points, faces };
}

/** A stone: an icosphere pushed in and out by noise and squashed on each axis. */
function buildStone(
	subdivisions: number,
	roughness: number,
	frequency: number,
	squash: Triple,
	seed: number,
): DesertMeshData {
	const { points, faces } = icosphere(subdivisions);
	const positions = new Float32Array(points.length * 3);
	points.forEach(([x, y, z], v) => {
		const radius =
			1 + roughness * fbm(x * frequency + seed, y * frequency, z * frequency - seed, 5);
		positions[v * 3] = x * radius * squash[0];
		positions[v * 3 + 1] = y * radius * squash[1];
		positions[v * 3 + 2] = z * radius * squash[2];
	});
	const indices = new Uint32Array(faces.length * 3);
	for (const [f, [a, b, c]] of faces.entries()) indices.set([a, c, b], f * 3);
	return { positions, normals: vertexNormals(positions, indices), indices };
}

/** A unique mesh of the desert: its name, its material and the function that builds its arrays. */
export interface DesertMesh {
	name: string;
	material: DesertMaterial;
	build: () => DesertMeshData;
}

/** The name of the ground's mesh, the one mesh that the scene draws once. */
export const GROUND = 'ground';

/** Every unique mesh: the ground, then the props that the scene copies many times. */
export const DESERT_MESHES: readonly DesertMesh[] = [
	{ name: GROUND, material: 'sand', build: () => buildGround() },
	...[0, 1, 2].map((v) => ({
		name: `column-${v}`,
		material: 'sandstone' as const,
		build: () => buildColumn(v),
	})),
	...[0, 1, 2].map((v) => ({
		name: `arch-${v}`,
		material: 'rock' as const,
		build: () => buildArch(v),
	})),
	...[0, 1, 2, 3].map((v) => ({
		name: `boulder-${v}`,
		material: 'rock' as const,
		build: () => buildStone(6, 0.38, 1.2, [1, 0.72, 0.9], 100 + v * 13.7),
	})),
	...[0, 1, 2, 3, 4, 5].map((v) => ({
		name: `pebble-${v}`,
		material: 'pebble' as const,
		build: () => buildStone(5, 0.14, 1.8, [1, 0.55, 0.8], 300 + v * 7.9),
	})),
];

// The model files.

/**
 * The two model files: the ground, which the scene draws once, and the props, which it copies many
 * times. Each holds one node per mesh, named as the mesh.
 */
export const DESERT_FILES = ['ground', 'props'] as const;
export type DesertFile = (typeof DESERT_FILES)[number];

/** The meshes of a model file. */
export const meshesOf = (file: DesertFile): DesertMesh[] =>
	DESERT_MESHES.filter((mesh) => (mesh.name === GROUND) === (file === 'ground'));

/**
 * The forms of each file: `raw`, float vertices with no compression, which three.js loads as they
 * are, and `null3d`, the asset tool's output, which null3D loads.
 */
export const DESERT_FORMS = ['raw', 'null3d'] as const;
export type DesertForm = (typeof DESERT_FORMS)[number];

/** The address prefix under which the benchmark's server serves the model files. */
export const DESERT_URL = '/bench-desert/';

/** The address of one form of one model file, from the server's root. */
export const desertModelPath = (form: DesertForm, file: DesertFile) =>
	`${DESERT_URL}${form}/${file}.glb`;

// The placements.

/** The seed of the placements. */
const PLACEMENT_SEED = 2026;

/** The floats of one placement row: the position, the rotation as a quaternion (x, y, z, w) and a uniform scale. */
export const ROW_FLOATS = 8;

/** The copies of each kind of prop that the layout places. */
export const DESERT_COPIES = { columns: 420, arches: 48, boulders: 3000, pebbles: 60_000 } as const;

/** The objects that the scene draws: the ground and every copy of a prop. */
export const DESERT_COUNT =
	1 + Object.values(DESERT_COPIES).reduce((sum: number, copies) => sum + copies, 0);

/** A quaternion that turns about the vertical axis, then tips about the local x axis. */
export function yawPitch(yaw: number, pitch: number): [number, number, number, number] {
	const cy = Math.cos(yaw / 2);
	const sy = Math.sin(yaw / 2);
	const cp = Math.cos(pitch / 2);
	const sp = Math.sin(pitch / 2);
	return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/**
 * Every copy of every mesh but the ground, by mesh name: rows of `ROW_FLOATS` floats. Temples of
 * columns stand in rectangles, some fallen and some broken; lone columns, arches and clusters of
 * boulders spread over the dunes; pebbles lie densest near the middle.
 */
export function desertPlacements(): Record<string, Float32Array> {
	const rows: Record<string, number[]> = {};
	const add = (name: string, x: number, y: number, z: number, q: number[], s: number) => {
		let list = rows[name];
		if (!list) rows[name] = list = [];
		list.push(x, y, z, q[0] as number, q[1] as number, q[2] as number, q[3] as number, s);
	};
	const next = mulberry32(PLACEMENT_SEED);
	const between = (a: number, b: number) => a + (b - a) * next();
	const pick = (count: number) => Math.min(count - 1, Math.floor(next() * count));
	const limit = GROUND_SIZE / 2 - 20;
	const columns = () =>
		((rows['column-0']?.length ?? 0) +
			(rows['column-1']?.length ?? 0) +
			(rows['column-2']?.length ?? 0)) /
		ROW_FLOATS;

	for (let site = 0; site < 7; site++) {
		const angle = (site / 7) * Math.PI * 2 + 0.4;
		const distance = site === 0 ? 0 : between(70, 260);
		const cx = Math.cos(angle) * distance;
		const cz = Math.sin(angle) * distance;
		const yaw = between(0, Math.PI);
		const long = 8 + pick(6);
		const wide = 4 + pick(3);
		const gap = 4.2;
		const c = Math.cos(yaw);
		const s = Math.sin(yaw);
		for (let i = 0; i < long; i++) {
			for (let j = 0; j < wide; j++) {
				if (j > 0 && j < wide - 1 && i > 0 && i < long - 1) continue;
				const lx = (i - (long - 1) / 2) * gap;
				const lz = (j - (wide - 1) / 2) * gap;
				const x = cx + lx * c - lz * s;
				const z = cz + lx * s + lz * c;
				const roll = next();
				if (roll < 0.12) {
					add(
						`column-${pick(2)}`,
						x,
						groundHeight(x, z) + 0.6,
						z,
						yawPitch(between(0, 6.28), Math.PI / 2),
						1,
					);
				} else {
					const name = roll < 0.3 ? 'column-2' : `column-${pick(2)}`;
					add(name, x, groundHeight(x, z) - 0.3, z, yawPitch(between(0, 6.28), 0), 1);
				}
			}
		}
	}
	while (columns() < DESERT_COPIES.columns) {
		const x = between(-limit, limit);
		const z = between(-limit, limit);
		const fallen = next() < 0.3;
		add(
			`column-${pick(3)}`,
			x,
			groundHeight(x, z) + (fallen ? 0.55 : -0.4),
			z,
			yawPitch(between(0, 6.28), fallen ? Math.PI / 2 : between(-0.08, 0.08)),
			between(0.85, 1.15),
		);
	}
	for (let k = 0; k < DESERT_COPIES.arches; k++) {
		const angle = between(0, Math.PI * 2);
		const distance = between(40, limit);
		const x = Math.cos(angle) * distance;
		const z = Math.sin(angle) * distance;
		add(
			`arch-${pick(3)}`,
			x,
			groundHeight(x, z) - 0.5,
			z,
			yawPitch(between(0, 6.28), 0),
			between(0.7, 1.4),
		);
	}
	const clusterSize = 20;
	for (let cluster = 0; cluster < DESERT_COPIES.boulders / clusterSize; cluster++) {
		const cx = between(-limit, limit);
		const cz = between(-limit, limit);
		for (let k = 0; k < clusterSize; k++) {
			const x = cx + between(-25, 25);
			const z = cz + between(-25, 25);
			const scale = between(0.4, 2.6);
			add(
				`boulder-${pick(4)}`,
				x,
				groundHeight(x, z) - scale * 0.2,
				z,
				yawPitch(between(0, 6.28), between(-0.3, 0.3)),
				scale,
			);
		}
	}
	for (let k = 0; k < DESERT_COPIES.pebbles; k++) {
		const angle = between(0, Math.PI * 2);
		const distance = limit * next() ** 1.6;
		const x = Math.cos(angle) * distance;
		const z = Math.sin(angle) * distance;
		const scale = between(0.05, 0.28);
		add(
			`pebble-${pick(6)}`,
			x,
			groundHeight(x, z) - scale * 0.15,
			z,
			yawPitch(between(0, 6.28), between(-0.4, 0.4)),
			scale,
		);
	}
	return Object.fromEntries(
		Object.entries(rows).map(([name, list]) => [name, new Float32Array(list)]),
	);
}

/** The copies that a list of placement rows holds. */
export const copiesOf = (rows: Float32Array) => rows.length / ROW_FLOATS;

// The camera.

/** The seconds of one lap of either camera path. */
export const LAP_SECONDS = 40;

/** A camera's position and the point it looks at. */
export interface DesertCamera {
	position: Triple;
	target: Triple;
}

/**
 * The camera at a time, in seconds. `walk` follows a loop at head height through the main temple and
 * the dunes around it. `aerial` circles high above the whole desert, looking down at its middle,
 * where every object is far away.
 */
export function desertCamera(view: DesertView, seconds: number): DesertCamera {
	const angle = (seconds / LAP_SECONDS) * Math.PI * 2;
	if (view === 'aerial') {
		const radius = 260;
		return {
			position: [Math.cos(angle) * radius, 140, Math.sin(angle) * radius],
			target: [0, 0, 0],
		};
	}
	const radius = 45 + 25 * Math.sin(angle * 2);
	const x = Math.cos(angle) * radius;
	const z = Math.sin(angle) * radius;
	const ahead = angle + 0.35;
	const tx = Math.cos(ahead) * radius * 1.2;
	const tz = Math.sin(ahead) * radius * 1.2;
	return {
		position: [x, groundHeight(x, z) + 2.2, z],
		target: [tx, groundHeight(tx, tz) + 1.8, tz],
	};
}

/** The scene's triangles at full detail, counting every copy, from each mesh's own count. */
export function fullDetailTriangles(
	triangles: Readonly<Record<string, number>>,
	rows: Readonly<Record<string, Float32Array>>,
): number {
	let total = triangles[GROUND] ?? 0;
	for (const [name, list] of Object.entries(rows)) total += (triangles[name] ?? 0) * copiesOf(list);
	return total;
}

/**
 * A page's desert switches: `?view=walk` (the default) or `?view=aerial`. Any other view throws,
 * with a message that names the ones there are.
 */
export function readDesertView(params: URLSearchParams): DesertView {
	const view = params.get('view') ?? 'walk';
	if (!(DESERT_VIEWS as readonly string[]).includes(view))
		throw new Error(
			`"${view}" is not a desert view. Use ?view=${DESERT_VIEWS.join(' or ?view=')}.`,
		);
	return view as DesertView;
}

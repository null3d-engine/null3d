// The desert scene that both engines draw: a dune ground, fluted columns, rock arches, boulders and
// pebbles, made from a fixed seed so every run and both engines get the same shapes and places.
// The unique meshes hold about seven million triangles. Copies of them raise the scene's full-detail
// count to about 1.7 billion, which only a renderer that culls and picks coarser detail can draw.
// The module is plain JavaScript, so a build script, a sketch worker and a page without a bundler
// can all import it.

/** The side of the square ground, in meters. */
export const GROUND_SIZE = 800;

/** The grid cells along each side of the ground. */
const GROUND_CELLS = 1000;

/** The materials, by name: base color as linear RGB and roughness. */
export const MATERIALS = {
	sand: { color: [0.62, 0.42, 0.24], roughness: 0.95 },
	sandstone: { color: [0.72, 0.55, 0.38], roughness: 0.85 },
	rock: { color: [0.46, 0.27, 0.16], roughness: 0.9 },
	pebble: { color: [0.36, 0.33, 0.3], roughness: 0.8 },
};

/** The sun's direction of travel, toward the ground, and its strength. */
export const SUN = { direction: [-0.45, -0.75, -0.48], intensity: 3, color: [1, 0.93, 0.82] };

/** The sun's shadows when a page turns them on: cascades, the texels of each map's side and the
 * distance from the camera that they cover, in meters. */
export const SHADOWS = { cascades: 3, mapSize: 2048, distance: 150 };

/** The sky's color, linear RGB, and the strength of the light from the whole sky. */
export const SKY = { color: [0.55, 0.68, 0.85], ambient: 0.55 };

/** The field of view of the camera, vertical, in degrees. */
export const FOV_DEGREES = 55;

/** The camera's near and far planes, in meters. */
export const NEAR = 0.1;
export const FAR = 2000;

// --- Seeded numbers and noise -------------------------------------------------------------------

/** A seeded generator of numbers from 0 to 1. */
export function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const PERM = (() => {
	const next = random(1234);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		const t = p[i];
		p[i] = p[j];
		p[j] = t;
	}
	const table = new Uint8Array(512);
	for (let i = 0; i < 512; i++) table[i] = p[i & 255];
	return table;
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function grad(hash, x, y, z) {
	const h = hash & 15;
	const u = h < 8 ? x : y;
	const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
	return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Gradient noise in three dimensions, from about -1 to 1. */
export function noise3(x, y, z) {
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
	const A = PERM[X] + Y;
	const AA = PERM[A] + Z;
	const AB = PERM[A + 1] + Z;
	const B = PERM[X + 1] + Y;
	const BA = PERM[B] + Z;
	const BB = PERM[B + 1] + Z;
	const lerp = (t, a, b) => a + t * (b - a);
	return lerp(
		w,
		lerp(
			v,
			lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)),
			lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z)),
		),
		lerp(
			v,
			lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)),
			lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1)),
		),
	);
}

/** Noise summed over octaves that each double the frequency and halve the strength. */
export function fbm(x, y, z, octaves) {
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

// --- The ground ---------------------------------------------------------------------------------

/** The height of the dunes at a point of the ground, in meters. */
export function groundHeight(x, z) {
	const ridge = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2.2) * 2.4;
	const swell = fbm(x * 0.004, 0.5, z * 0.004, 3) * 14;
	const ripples = Math.sin(x * 0.35 + z * 0.12 + fbm(x * 0.02, 1.5, z * 0.02, 2) * 6) * 0.08;
	return ridge + swell + ripples;
}

function buildGround() {
	const n = GROUND_CELLS + 1;
	const step = GROUND_SIZE / GROUND_CELLS;
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
	const indices = new Uint32Array(GROUND_CELLS * GROUND_CELLS * 6);
	let o = 0;
	for (let j = 0; j < GROUND_CELLS; j++) {
		for (let i = 0; i < GROUND_CELLS; i++) {
			const a = j * n + i;
			const b = a + 1;
			const c = a + n;
			const d = c + 1;
			indices[o++] = a;
			indices[o++] = c;
			indices[o++] = b;
			indices[o++] = b;
			indices[o++] = c;
			indices[o++] = d;
		}
	}
	return { positions, normals, indices };
}

// --- Shared mesh helpers ------------------------------------------------------------------------

/** Area-weighted vertex normals of an indexed triangle list. */
function vertexNormals(positions, indices) {
	const normals = new Float32Array(positions.length);
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t] * 3;
		const b = indices[t + 1] * 3;
		const c = indices[t + 2] * 3;
		const e1x = positions[b] - positions[a];
		const e1y = positions[b + 1] - positions[a + 1];
		const e1z = positions[b + 2] - positions[a + 2];
		const e2x = positions[c] - positions[a];
		const e2y = positions[c + 1] - positions[a + 1];
		const e2z = positions[c + 2] - positions[a + 2];
		const nx = e1y * e2z - e1z * e2y;
		const ny = e1z * e2x - e1x * e2z;
		const nz = e1x * e2y - e1y * e2x;
		for (const v of [a, b, c]) {
			normals[v] += nx;
			normals[v + 1] += ny;
			normals[v + 2] += nz;
		}
	}
	for (let v = 0; v < normals.length; v += 3) {
		const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
		normals[v] /= length;
		normals[v + 1] /= length;
		normals[v + 2] /= length;
	}
	return normals;
}

/**
 * The indices of a grid of rings that wraps around its second axis: `rows` rings of `around`
 * vertices each, with the seam's vertices shared.
 */
function wrappedGridIndices(rows, around, flip) {
	const indices = new Uint32Array((rows - 1) * around * 6);
	let o = 0;
	for (let r = 0; r < rows - 1; r++) {
		for (let s = 0; s < around; s++) {
			const a = r * around + s;
			const b = r * around + ((s + 1) % around);
			const c = a + around;
			const d = b + around;
			if (flip) {
				indices[o++] = a;
				indices[o++] = b;
				indices[o++] = c;
				indices[o++] = b;
				indices[o++] = d;
				indices[o++] = c;
			} else {
				indices[o++] = a;
				indices[o++] = c;
				indices[o++] = b;
				indices[o++] = b;
				indices[o++] = c;
				indices[o++] = d;
			}
		}
	}
	return indices;
}

// --- Columns ------------------------------------------------------------------------------------

/** The radius of a column's profile at a height, before its flutes and wear. */
function columnRadius(y, height, capital) {
	if (y < 0.35) return 0.82;
	if (y < 0.7) return 0.62 + 0.1 * Math.sin(((y - 0.35) / 0.35) * Math.PI);
	const top = capital ? height - 1.1 : height;
	if (y < top) return 0.52 - 0.07 * ((y - 0.7) / (top - 0.7)) ** 1.5;
	if (y < height - 0.4) return 0.45 + 0.3 * ((y - top) / (height - 0.4 - top)) ** 2;
	return 0.82;
}

function buildColumn(variant) {
	const height = [9, 10.5, 5.5][variant];
	const capital = variant !== 2;
	const rows = 900;
	const around = 288;
	const flutes = 24;
	const seed = variant * 17.3;
	const positions = new Float32Array((rows + 1) * around * 3);
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
	// A broken column's top is jagged; a whole one ends in a flat top.
	if (!capital) {
		for (let s = 0; s < around; s++) {
			const angle = (s / around) * Math.PI * 2;
			const drop = 0.6 * (0.5 + 0.5 * fbm(Math.cos(angle) * 1.5, 3.3, Math.sin(angle) * 1.5, 3));
			for (let r = rows - 20; r <= rows; r++) {
				const k = (r * around + s) * 3 + 1;
				positions[k] = Math.min(positions[k], height - drop * ((r - rows + 20) / 20));
			}
		}
	}
	const side = wrappedGridIndices(rows + 1, around, false);
	// The top closes with a fan around a center vertex.
	const center = (rows + 1) * around;
	const all = new Float32Array(positions.length + 3);
	all.set(positions);
	all[center * 3 + 1] = capital ? height : height - 0.3;
	const indices = new Uint32Array(side.length + around * 3);
	indices.set(side);
	let o = side.length;
	const top = rows * around;
	for (let s = 0; s < around; s++) {
		indices[o++] = top + s;
		indices[o++] = center;
		indices[o++] = top + ((s + 1) % around);
	}
	return { positions: all, normals: vertexNormals(all, indices), indices };
}

// --- Arches -------------------------------------------------------------------------------------

function buildArch(variant) {
	const span = [12, 15, 10][variant];
	const rise = [1.1, 0.8, 1.4][variant];
	const along = 1600;
	const around = 320;
	const seed = 40 + variant * 9.1;
	const positions = new Float32Array(along * around * 3);
	for (let a = 0; a < along; a++) {
		// The curve runs past both feet, so the legs reach below the ground.
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

// --- Boulders and pebbles -----------------------------------------------------------------------

/** A unit icosphere: each subdivision splits every triangle into four, with shared vertices. */
function icosphere(subdivisions) {
	const t = (1 + Math.sqrt(5)) / 2;
	const points = [
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
	].map(([x, y, z]) => {
		const l = Math.hypot(x, y, z);
		return [x / l, y / l, z / l];
	});
	let faces = [
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
	for (let d = 0; d < subdivisions; d++) {
		const middles = new Map();
		const middle = (a, b) => {
			const key = a < b ? a * 1e7 + b : b * 1e7 + a;
			let index = middles.get(key);
			if (index === undefined) {
				const [ax, ay, az] = points[a];
				const [bx, by, bz] = points[b];
				const mx = ax + bx;
				const my = ay + by;
				const mz = az + bz;
				const l = Math.hypot(mx, my, mz);
				index = points.length;
				points.push([mx / l, my / l, mz / l]);
				middles.set(key, index);
			}
			return index;
		};
		const next = [];
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

function buildStone(subdivisions, roughness, frequency, squash, seed) {
	const { points, faces } = icosphere(subdivisions);
	const positions = new Float32Array(points.length * 3);
	for (let v = 0; v < points.length; v++) {
		const [x, y, z] = points[v];
		const radius =
			1 + roughness * fbm(x * frequency + seed, y * frequency, z * frequency - seed, 5);
		positions[v * 3] = x * radius * squash[0];
		positions[v * 3 + 1] = y * radius * squash[1];
		positions[v * 3 + 2] = z * radius * squash[2];
	}
	const indices = new Uint32Array(faces.length * 3);
	for (let f = 0; f < faces.length; f++) {
		indices[f * 3] = faces[f][0];
		indices[f * 3 + 1] = faces[f][2];
		indices[f * 3 + 2] = faces[f][1];
	}
	return { positions, normals: vertexNormals(positions, indices), indices };
}

const buildBoulder = (variant) => buildStone(6, 0.38, 1.2, [1, 0.72, 0.9], 100 + variant * 13.7);

const buildPebble = (variant) => buildStone(5, 0.14, 1.8, [1, 0.55, 0.8], 300 + variant * 7.9);

// --- The list of meshes -------------------------------------------------------------------------

/** Each unique mesh: its name, material and builder. */
export const MESHES = [
	{ name: 'ground', material: 'sand', build: buildGround },
	...[0, 1, 2].map((v) => ({
		name: `column-${v}`,
		material: 'sandstone',
		build: () => buildColumn(v),
	})),
	...[0, 1, 2].map((v) => ({ name: `arch-${v}`, material: 'rock', build: () => buildArch(v) })),
	...[0, 1, 2, 3].map((v) => ({
		name: `boulder-${v}`,
		material: 'rock',
		build: () => buildBoulder(v),
	})),
	...[0, 1, 2, 3, 4, 5].map((v) => ({
		name: `pebble-${v}`,
		material: 'pebble',
		build: () => buildPebble(v),
	})),
];

// --- Placements ---------------------------------------------------------------------------------

/** A quaternion that turns about the vertical axis, then tips about the local x axis. */
function yawPitch(yaw, pitch) {
	const cy = Math.cos(yaw / 2);
	const sy = Math.sin(yaw / 2);
	const cp = Math.cos(pitch / 2);
	const sp = Math.sin(pitch / 2);
	return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/**
 * Every copy of every mesh but the ground, by mesh name: rows of eight floats, the position, the
 * rotation as a quaternion (x, y, z, w) and a uniform scale.
 */
export function placements() {
	const rows = {};
	const add = (name, x, y, z, q, s) => {
		let list = rows[name];
		if (!list) rows[name] = list = [];
		list.push(x, y, z, q[0], q[1], q[2], q[3], s);
	};
	const next = random(2026);
	const between = (a, b) => a + (b - a) * next();
	const pick = (count) => Math.min(count - 1, Math.floor(next() * count));
	const limit = GROUND_SIZE / 2 - 20;

	// Temples: rectangles of columns, with some fallen and some broken.
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
	// Lone columns across the dunes.
	while (
		(rows['column-0']?.length ?? 0) +
			(rows['column-1']?.length ?? 0) +
			(rows['column-2']?.length ?? 0) <
		420 * 8
	) {
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
	// Rock arches.
	for (let k = 0; k < 48; k++) {
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
	// Boulders, in clusters.
	for (let cluster = 0; cluster < 150; cluster++) {
		const cx = between(-limit, limit);
		const cz = between(-limit, limit);
		for (let k = 0; k < 20; k++) {
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
	// Pebbles, densest near the middle.
	for (let k = 0; k < 60000; k++) {
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

// --- The camera ---------------------------------------------------------------------------------

/** The seconds of one lap of the walking camera. */
export const LAP_SECONDS = 40;

/**
 * The camera at a time, in seconds: its position and the point it looks at. `walk` follows a loop
 * at head height through the main temple and the dunes around it. `aerial` circles high above the
 * whole desert, looking down at its middle, where every object is far away.
 */
export function cameraAt(view, seconds) {
	const angle = (seconds / LAP_SECONDS) * Math.PI * 2;
	if (view === 'aerial') {
		const radius = 260;
		const x = Math.cos(angle) * radius;
		const z = Math.sin(angle) * radius;
		return { position: [x, 140, z], target: [0, 0, 0] };
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

/** The triangles of the scene at full detail, counting every copy. */
export function fullDetailTriangles(triangleCounts, rows) {
	let total = triangleCounts.ground ?? 0;
	for (const [name, list] of Object.entries(rows))
		total += (triangleCounts[name] ?? 0) * (list.length / 8);
	return total;
}

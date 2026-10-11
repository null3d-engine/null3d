// What the comparison scenes share, with no engine imports, so the null3D half and the three.js
// half of each comparison run the same code: seeded randomness, the fixed-step clock, rotations,
// camera loops, the grid that places cells, meshes as plain arrays, textures made in code and the
// color grading table. Functions that run every frame write into arrays that the caller owns, so
// they allocate nothing. The rest is setup code.

/** A list of numbers that a per-frame function fills: a typed array or a plain array. */
export type OutArray = Float32Array | Float64Array | number[];

/** Colors are sRGB hex strings. Both engines convert them to linear values and light in linear space. */
export type Hex = `#${string}`;

export const TAU = 2 * Math.PI;

/**
 * A float in [0, 1) from three integers, with no state: per-object, per-event randomness inside
 * frame code without a stored generator. The same inputs always give the same value.
 */
export function hash01(a: number, b: number, c = 0): number {
	let t =
		(Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>>
		0;
	t = (t + 0x6d2b79f5) >>> 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** An S-curve from 0 to 1 for t in [0, 1]: zero speed at both ends. */
export function smoothstep(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

// The fixed-step simulation. Every scene moves in steps of SIM_STEP seconds, so both engines reach
// the same state after the same number of steps, whatever their frame rates.

/**
 * Seconds per simulation step. 120 steps a second match a 120 Hz display, so motion changes on
 * every frame there; a 60 Hz display runs two steps a frame.
 */
export const SIM_STEP = 1 / 120;
/** Steps a frame may run. A frame that falls further behind drops the rest: the scene slows. */
export const MAX_STEPS_PER_FRAME = 8;

/**
 * Turns frame times into whole simulation steps, as null3D's fixed steps do: a frame runs the steps
 * that fell due, at most MAX_STEPS_PER_FRAME, and drops the rest.
 */
export class FixedClock {
	/** Simulation seconds so far: steps times SIM_STEP. */
	time = 0;
	/** Steps so far. */
	steps = 0;
	private carry = 0;

	/** Adds a frame's time and returns how many steps to run now. */
	advance(frameSeconds: number): number {
		this.carry += frameSeconds > 0 ? frameSeconds : 0;
		let steps = Math.floor(this.carry / SIM_STEP + 1e-9);
		if (steps > MAX_STEPS_PER_FRAME) {
			steps = MAX_STEPS_PER_FRAME;
			this.carry = 0;
		} else {
			this.carry -= steps * SIM_STEP;
		}
		this.steps += steps;
		this.time = this.steps * SIM_STEP;
		return steps;
	}

	/** Moves the clock to `seconds` of simulation at once, and returns how many steps to run. */
	skipTo(seconds: number): number {
		const target = Math.max(this.steps, stepsUntil(seconds));
		const steps = target - this.steps;
		this.steps = target;
		this.time = target * SIM_STEP;
		this.carry = 0;
		return steps;
	}
}

/** The number of steps from 0 to `seconds`: the state that held frames and tests look at. */
export function stepsUntil(seconds: number): number {
	return Math.round(seconds / SIM_STEP);
}

// Rotations as quaternions (x, y, z, w), written into caller-owned arrays at an offset.

/** Writes the rotation of `angle` radians about the unit axis (ax, ay, az). */
export function quatAxisAngle(
	out: OutArray,
	offset: number,
	ax: number,
	ay: number,
	az: number,
	angle: number,
): void {
	const s = Math.sin(angle / 2);
	out[offset] = ax * s;
	out[offset + 1] = ay * s;
	out[offset + 2] = az * s;
	out[offset + 3] = Math.cos(angle / 2);
}

/** Writes a turn about +Y (yaw). */
export function quatYaw(out: OutArray, offset: number, angle: number): void {
	quatAxisAngle(out, offset, 0, 1, 0, angle);
}

/** Writes a turn about +X (pitch): +Y tips toward +Z for a positive angle. */
export function quatPitch(out: OutArray, offset: number, angle: number): void {
	quatAxisAngle(out, offset, 1, 0, 0, angle);
}

/** Writes a × b, the rotation b followed by a. `out` may not share storage with a or b. */
export function quatMultiply(
	out: OutArray,
	o: number,
	a: ArrayLike<number>,
	ao: number,
	b: ArrayLike<number>,
	bo: number,
): void {
	const ax = a[ao] as number;
	const ay = a[ao + 1] as number;
	const az = a[ao + 2] as number;
	const aw = a[ao + 3] as number;
	const bx = b[bo] as number;
	const by = b[bo + 1] as number;
	const bz = b[bo + 2] as number;
	const bw = b[bo + 3] as number;
	out[o] = aw * bx + ax * bw + ay * bz - az * by;
	out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
	out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
	out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Writes vector (vx, vy, vz) turned by quaternion q at offset `qo` into out[o..o+2]. */
export function rotateVector(
	out: OutArray,
	o: number,
	q: ArrayLike<number>,
	qo: number,
	vx: number,
	vy: number,
	vz: number,
): void {
	const x = q[qo] as number;
	const y = q[qo + 1] as number;
	const z = q[qo + 2] as number;
	const w = q[qo + 3] as number;
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	out[o] = vx + w * tx + (y * tz - z * ty);
	out[o + 1] = vy + w * ty + (z * tx - x * tz);
	out[o + 2] = vz + w * tz + (x * ty - y * tx);
}

// Camera paths: closed loops through control points, sampled with a uniform Catmull-Rom spline so
// the camera moves smoothly through every point.

/** A closed camera loop. Positions and targets have three floats per control point. */
export interface CameraLoop {
	/** Seconds per loop. */
	seconds: number;
	positions: readonly number[];
	targets: readonly number[];
}

function catmullRom(p: readonly number[], count: number, u: number, axis: number): number {
	const segment = Math.floor(u);
	const t = u - segment;
	const i1 = ((segment % count) + count) % count;
	const i0 = (i1 - 1 + count) % count;
	const i2 = (i1 + 1) % count;
	const i3 = (i1 + 2) % count;
	const p0 = p[i0 * 3 + axis] as number;
	const p1 = p[i1 * 3 + axis] as number;
	const p2 = p[i2 * 3 + axis] as number;
	const p3 = p[i3 * 3 + axis] as number;
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(-p0 + p2) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
}

/** Writes the camera position and look-at target at time t on a closed loop. */
export function sampleCameraLoop(
	loop: CameraLoop,
	t: number,
	outPosition: OutArray,
	outTarget: OutArray,
): void {
	const count = loop.positions.length / 3;
	const phase = (t / loop.seconds) % 1;
	const u = (phase < 0 ? phase + 1 : phase) * count;
	for (let axis = 0; axis < 3; axis++) {
		outPosition[axis] = catmullRom(loop.positions, count, u, axis);
		outTarget[axis] = catmullRom(loop.targets, count, u, axis);
	}
}

/**
 * The grid cell of the i-th entry of a square spiral that starts at (0, 0) and grows ring by ring,
 * so the first n entries always form a compact patch around the origin.
 */
export function spiralCell(i: number, out: Int32Array, offset: number): void {
	if (i === 0) {
		out[offset] = 0;
		out[offset + 1] = 0;
		return;
	}
	// Ring r holds the 8r cells at Chebyshev distance r; rings 1..r-1 hold (2r-1)^2 - 1 cells.
	const ring = Math.ceil((Math.sqrt(i + 1) - 1) / 2);
	const side = 2 * ring;
	const before = (2 * ring - 1) * (2 * ring - 1);
	const k = i - before;
	const edge = Math.floor(k / side);
	const along = k % side;
	let x: number;
	let z: number;
	if (edge === 0) {
		x = ring;
		z = -ring + 1 + along;
	} else if (edge === 1) {
		x = ring - 1 - along;
		z = ring;
	} else if (edge === 2) {
		x = -ring;
		z = ring - 1 - along;
	} else {
		x = -ring + 1 + along;
		z = -ring;
	}
	out[offset] = x;
	out[offset + 1] = z;
}

// Meshes that both engines upload as they are, so every shape and its triangle count match.

/** Vertex data of an indexed triangle mesh. */
export interface MeshData {
	/** Three floats per vertex. */
	position: Float32Array;
	/** Three floats per vertex, of unit length. */
	normal: Float32Array;
	/** Two floats per vertex, in meters along the surface, so textures keep one size on every part. */
	uv: Float32Array;
	/** Three vertex indices per triangle, counter-clockwise when seen from the front. */
	index: Uint16Array;
	/** Three floats per vertex: a linear color that multiplies the material's color, if any. */
	color?: Float32Array;
}

export function triangleCount(mesh: MeshData): number {
	return mesh.index.length / 3;
}

/**
 * The faces of a box, in three.js's BoxGeometry order (+X, -X, +Y, -Y, +Z, -Z). For each face: the
 * axes along the face's width, height and normal (0 = X, 1 = Y, 2 = Z), the direction of each
 * in-face axis, and which box dimension spans each axis, with its sign for the normal axis.
 */
const BOX_FACES = [
	{ u: 2, v: 1, w: 0, uDir: -1, vDir: -1, uSize: 2, vSize: 1, wSize: 0, wSign: 1 },
	{ u: 2, v: 1, w: 0, uDir: 1, vDir: -1, uSize: 2, vSize: 1, wSize: 0, wSign: -1 },
	{ u: 0, v: 2, w: 1, uDir: 1, vDir: 1, uSize: 0, vSize: 2, wSize: 1, wSign: 1 },
	{ u: 0, v: 2, w: 1, uDir: 1, vDir: -1, uSize: 0, vSize: 2, wSize: 1, wSign: -1 },
	{ u: 0, v: 1, w: 2, uDir: 1, vDir: -1, uSize: 0, vSize: 1, wSize: 2, wSign: 1 },
	{ u: 0, v: 1, w: 2, uDir: -1, vDir: -1, uSize: 0, vSize: 1, wSize: 2, wSign: -1 },
] as const;

/**
 * A box centered on the origin, with 4 vertices per face, so each face has its own normal, laid
 * out as three.js's `BoxGeometry(width, height, depth)`. Texture coordinates run in meters.
 */
export function boxGeometry(width: number, height: number, depth: number): MeshData {
	const size = [width, height, depth] as const;
	const position = new Float32Array(24 * 3);
	const normal = new Float32Array(24 * 3);
	const uv = new Float32Array(24 * 2);
	const index = new Uint16Array(36);
	for (const [f, face] of BOX_FACES.entries()) {
		const faceWidth = size[face.uSize];
		const faceHeight = size[face.vSize];
		const halfDepth = (size[face.wSize] * face.wSign) / 2;
		for (let corner = 0; corner < 4; corner++) {
			const vertex = f * 4 + corner;
			const ix = corner & 1;
			const iy = corner >> 1;
			position[vertex * 3 + face.u] = (ix * faceWidth - faceWidth / 2) * face.uDir;
			position[vertex * 3 + face.v] = (iy * faceHeight - faceHeight / 2) * face.vDir;
			position[vertex * 3 + face.w] = halfDepth;
			normal[vertex * 3 + face.w] = face.wSign;
			uv[vertex * 2] = ix * faceWidth;
			uv[vertex * 2 + 1] = (1 - iy) * faceHeight;
		}
		const first = f * 4;
		index.set([first, first + 2, first + 1, first + 2, first + 3, first + 1], f * 6);
	}
	return { position, normal, uv, index };
}

/**
 * A closed cylinder around the Y axis, centered on the origin: `segments` side faces with smooth
 * normals, and two flat caps. Texture coordinates run in meters around the side and across the caps.
 */
export function cylinderGeometry(radius: number, height: number, segments: number): MeshData {
	const vertexCount = (segments + 1) * 2 + (segments + 1) * 2;
	const position = new Float32Array(vertexCount * 3);
	const normal = new Float32Array(vertexCount * 3);
	const uv = new Float32Array(vertexCount * 2);
	const index = new Uint16Array(segments * 12);
	const half = height / 2;
	let v = 0;
	let t = 0;
	const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
		position.set([x, y, z], v * 3);
		normal.set([nx, ny, nz], v * 3);
		v++;
	};
	// Side: a bottom and a top vertex per segment edge; the seam repeats the first edge.
	for (let s = 0; s <= segments; s++) {
		const angle = (s / segments) * TAU;
		const x = Math.sin(angle);
		const z = Math.cos(angle);
		for (const y of [-half, half]) {
			uv.set([(s / segments) * TAU * radius, y + half], v * 2);
			vertex(x * radius, y, z * radius, x, 0, z);
		}
	}
	for (let s = 0; s < segments; s++) {
		const a = s * 2;
		index.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], t);
		t += 6;
	}
	// Caps: a center vertex and a ring vertex per segment, with flat normals.
	for (const [y, ny] of [
		[-half, -1],
		[half, 1],
	] as const) {
		const center = v;
		uv.set([radius, radius], v * 2);
		vertex(0, y, 0, 0, ny, 0);
		const ring = v;
		for (let s = 0; s < segments; s++) {
			const angle = (s / segments) * TAU;
			const x = Math.sin(angle) * radius;
			const z = Math.cos(angle) * radius;
			uv.set([x + radius, z + radius], v * 2);
			vertex(x, y, z, 0, ny, 0);
		}
		for (let s = 0; s < segments; s++) {
			const a = ring + s;
			const b = ring + ((s + 1) % segments);
			// Counter-clockwise seen from outside: from above for the top cap, from below for the bottom.
			if (ny > 0) index.set([center, a, b], t);
			else index.set([center, b, a], t);
			t += 3;
		}
	}
	return { position, normal, uv, index };
}

/** A copy of the mesh, moved by (x, y, z). */
export function translated(mesh: MeshData, x: number, y: number, z: number): MeshData {
	const position = Float32Array.from(mesh.position);
	for (let i = 0; i < position.length; i += 3) {
		position[i] = (position[i] as number) + x;
		position[i + 1] = (position[i + 1] as number) + y;
		position[i + 2] = (position[i + 2] as number) + z;
	}
	return {
		position,
		normal: Float32Array.from(mesh.normal),
		uv: Float32Array.from(mesh.uv),
		index: Uint16Array.from(mesh.index),
	};
}

// Textures made in code: tileable noise, turned into a color map, a map of occlusion, roughness and
// metalness (packed as glTF packs them, which both engines read), and a normal map.

/** One texture's texels: RGBA, 8 bits each, the first row at v = 0, as both engines take data. */
export interface TextureData {
	size: number;
	data: Uint8Array;
	/** 'srgb' for color maps, 'linear' for data maps. */
	colorSpace: 'srgb' | 'linear';
}

/** The three maps of a surface. */
export interface SurfaceMaps {
	color: TextureData;
	/** Occlusion in R (1, none), roughness in G and metalness in B. */
	orm: TextureData;
	/** A tangent-space normal map. */
	normal: TextureData;
}

/** Value noise that tiles over `period` lattice cells, from 0 to 1. */
function tiledNoise(x: number, y: number, period: number, seed: number): number {
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const fx = x - x0;
	const fy = y - y0;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const wrap = (n: number) => ((n % period) + period) % period;
	const at = (i: number, j: number) => hash01(seed, wrap(i), wrap(j));
	const top = lerp(at(x0, y0), at(x0 + 1, y0), sx);
	const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx);
	return lerp(top, bottom, sy);
}

/** Fractal noise over `octaves`, tiling across the texture, from about 0 to 1. */
function fbm(
	u: number,
	v: number,
	base: number,
	octaves: number,
	seed: number,
	stretch = 1,
): number {
	let sum = 0;
	let weight = 0.5;
	let total = 0;
	for (let o = 0; o < octaves; o++) {
		const period = base << o;
		sum += weight * tiledNoise(u * period, v * (period / stretch), period, seed + o * 17);
		total += weight;
		weight *= 0.5;
	}
	return sum / total;
}

/**
 * A surface's recipe at a texel: its sRGB color, roughness, metalness and height, from 0 to 1 each.
 */
type Texel = (
	u: number,
	v: number,
) => {
	r: number;
	g: number;
	b: number;
	roughness: number;
	metalness: number;
	height: number;
};

/** The surfaces that the comparisons draw. Each tiles over one meter. */
export type SurfaceKind =
	| 'paint'
	| 'brushed'
	| 'concrete'
	| 'rubber'
	| 'crate'
	| 'ground'
	| 'rock'
	| 'masonry'
	| 'camo';

const SURFACES: Readonly<Record<SurfaceKind, (seed: number) => Texel>> = {
	// Painted steel, white so a material's color tints it, with scuffs where bare metal shows.
	paint: (seed) => (u, v) => {
		const grain = fbm(u, v, 8, 4, seed);
		const wear = smoothstep((fbm(u, v, 4, 5, seed + 101) - 0.62) * 8);
		const paint = 0.86 + 0.1 * grain;
		const metal = 0.55 + 0.1 * grain;
		const shade = lerp(paint, metal, wear);
		return {
			r: shade,
			g: shade,
			b: shade,
			roughness: lerp(0.42 + 0.12 * grain, 0.3, wear),
			metalness: lerp(0.05, 0.95, wear),
			height: 0.5 + 0.15 * grain - 0.25 * wear,
		};
	},
	// Steel brushed along u: long fine streaks.
	brushed: (seed) => (u, v) => {
		const streak = fbm(u, v, 4, 5, seed, 16);
		const fine = tiledNoise(u * 64, v * 1024, 64, seed + 7);
		const shade = 0.62 + 0.12 * streak + 0.06 * fine;
		return {
			r: shade,
			g: shade,
			b: shade * 1.02,
			roughness: 0.28 + 0.14 * streak,
			metalness: 1,
			height: 0.5 + 0.3 * fine,
		};
	},
	// Poured concrete with stains and small pits.
	concrete: (seed) => (u, v) => {
		const stain = fbm(u, v, 4, 5, seed);
		const grit = tiledNoise(u * 128, v * 128, 128, seed + 3);
		const pit = grit > 0.9 ? 1 : 0;
		const shade = 0.42 + 0.22 * stain + 0.08 * grit - 0.12 * pit;
		return {
			r: shade,
			g: shade * 0.98,
			b: shade * 0.95,
			roughness: 0.8 + 0.15 * grit,
			metalness: 0,
			height: 0.5 + 0.2 * stain + 0.2 * grit - 0.4 * pit,
		};
	},
	// A rubber belt with ridges across it every 8 cm.
	rubber: (seed) => (u, v) => {
		const ridge = smoothstep((Math.abs(((u * 12.5) % 1) - 0.5) - 0.3) * 6);
		const grain = fbm(u, v, 16, 3, seed);
		const shade = 0.13 + 0.04 * grain + 0.04 * ridge;
		return {
			r: shade,
			g: shade,
			b: shade,
			roughness: 0.85 - 0.1 * ridge,
			metalness: 0,
			height: 0.3 + 0.5 * ridge + 0.1 * grain,
		};
	},
	// Planks of wood, with gaps between them every quarter meter.
	crate: (seed) => (u, v) => {
		const plank = Math.floor(v * 4);
		const along = (v * 4) % 1;
		const gap = along < 0.05 || along > 0.95 ? 1 : 0;
		const grain = fbm(u + hash01(seed, plank) * 7, along, 2, 4, seed + plank, 0.08);
		const tone = 0.55 + 0.25 * grain + 0.1 * hash01(seed, plank, 1);
		return {
			r: tone * (1 - 0.6 * gap),
			g: tone * 0.72 * (1 - 0.6 * gap),
			b: tone * 0.48 * (1 - 0.6 * gap),
			roughness: 0.75 + 0.15 * grain,
			metalness: 0,
			height: 0.6 + 0.2 * grain - 0.5 * gap,
		};
	},
	// Trampled earth: soil of mixed tones, pebbles and small clods, light so vertex colors tint it.
	ground: (seed) => (u, v) => {
		const soil = fbm(u, v, 4, 5, seed);
		const grit = tiledNoise(u * 96, v * 96, 96, seed + 5);
		const pebble = smoothstep((tiledNoise(u * 24, v * 24, 24, seed + 9) - 0.72) * 9);
		const shade = 0.62 + 0.22 * soil + 0.1 * grit + 0.12 * pebble;
		return {
			r: shade,
			g: shade * 0.93,
			b: shade * 0.84,
			roughness: 0.92 - 0.25 * pebble,
			metalness: 0,
			height: 0.35 + 0.25 * soil + 0.15 * grit + 0.45 * pebble,
		};
	},
	// Weathered rock with cracks and lichen-dark patches.
	rock: (seed) => (u, v) => {
		const mass = fbm(u, v, 3, 6, seed);
		const crack = smoothstep((0.06 - Math.abs(fbm(u, v, 6, 3, seed + 31) - 0.5)) * 18);
		const grain = tiledNoise(u * 128, v * 128, 128, seed + 2);
		const shade = (0.5 + 0.3 * mass + 0.08 * grain) * (1 - 0.55 * crack);
		return {
			r: shade,
			g: shade * 0.97,
			b: shade * 0.92,
			roughness: 0.82 + 0.12 * grain,
			metalness: 0,
			height: 0.5 + 0.3 * mass + 0.1 * grain - 0.5 * crack,
		};
	},
	// Rough stone blocks in courses half a meter high, with sunken mortar joints.
	masonry: (seed) => (u, v) => {
		const course = Math.floor(v * 2);
		const along = u * 2.5 + (course % 2) * 0.5;
		const block = Math.floor(along);
		const joint =
			Math.min(Math.abs(((v * 2) % 1) - 0.5), Math.abs((along % 1) - 0.5)) > 0.46 ? 1 : 0;
		const tone = 0.62 + 0.18 * hash01(seed, block, course) + 0.12 * fbm(u, v, 8, 4, seed + 3);
		const shade = joint ? 0.42 : tone;
		return {
			r: shade,
			g: shade * 0.95,
			b: shade * 0.88,
			roughness: joint ? 0.95 : 0.8 + 0.1 * hash01(seed, block, course + 99),
			metalness: 0,
			height: joint ? 0.1 : 0.6 + 0.2 * fbm(u, v, 8, 3, seed + 7),
		};
	},
	// A tank's paint: white so the army's color tints it, with dark camouflage patches, mud toward
	// the bottom of each tile and chipped edges where steel shows.
	camo: (seed) => (u, v) => {
		const blot = fbm(u, v, 2, 4, seed);
		const patch = smoothstep((blot - 0.55) * 10);
		const chip = smoothstep((fbm(u, v, 8, 4, seed + 41) - 0.74) * 12);
		const mud = smoothstep((fbm(u, v, 4, 4, seed + 77) - 0.6) * 6);
		const paint = lerp(0.9, 0.48, patch);
		const shade = lerp(lerp(paint, 0.42, mud * 0.8), 0.5, chip);
		return {
			r: shade * lerp(1, 0.9, mud),
			g: shade * lerp(1, 0.8, mud),
			b: shade * lerp(1, 0.62, mud),
			roughness: lerp(lerp(0.62, 0.95, mud), 0.35, chip),
			metalness: lerp(0.15, 0.9, chip),
			height: 0.55 + 0.1 * blot - 0.3 * chip + 0.2 * mud,
		};
	},
};

/** The byte of a value from 0 to 1. */
const byte = (value: number) => Math.round(clamp(value, 0, 1) * 255);

/**
 * The color, packed and normal maps of a surface, `size` texels a side, from a seed. The color map
 * holds sRGB bytes; the others hold linear values. Setup code: a 256 texel surface takes a few
 * milliseconds.
 */
export function surfaceMaps(kind: SurfaceKind, size: number, seed: number): SurfaceMaps {
	const texel = SURFACES[kind](seed);
	const color = new Uint8Array(size * size * 4);
	const orm = new Uint8Array(size * size * 4);
	const normal = new Uint8Array(size * size * 4);
	const height = new Float32Array(size * size);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const i = y * size + x;
			const t = texel(x / size, y / size);
			color.set([byte(t.r), byte(t.g), byte(t.b), 255], i * 4);
			orm.set([255, byte(t.roughness), byte(t.metalness), 255], i * 4);
			height[i] = t.height;
		}
	// The normal from the height's slope, wrapping at the edges so the map tiles. The bumps are a
	// few tenths of a millimeter deep across a texel of a few millimeters.
	const depth = 2.5;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const h = (dx: number, dy: number) =>
				height[((y + dy + size) % size) * size + ((x + dx + size) % size)] as number;
			const nx = (h(-1, 0) - h(1, 0)) * depth;
			const ny = (h(0, -1) - h(0, 1)) * depth;
			const length = Math.hypot(nx, ny, 1);
			normal.set(
				[
					byte(0.5 + (0.5 * nx) / length),
					byte(0.5 + (0.5 * ny) / length),
					byte(0.5 + 0.5 / length),
					255,
				],
				(y * size + x) * 4,
			);
		}
	return {
		color: { size, data: color, colorSpace: 'srgb' },
		orm: { size, data: orm, colorSpace: 'linear' },
		normal: { size, data: normal, colorSpace: 'linear' },
	};
}

// The color grade: a 3D table that both engines apply after the tone curve, as three.js's
// LUTPass does.

/** A grade's numbers: contrast and saturation around their middle, and lift, gamma and gain per channel. */
export interface GradeLook {
	contrast?: number;
	saturation?: number;
	lift?: readonly [number, number, number];
	gamma?: readonly [number, number, number];
	gain?: readonly [number, number, number];
}

/** A color grading table: `size` texels a side, RGBA bytes, red fastest as in a .cube file. */
export interface GradeTable {
	size: number;
	data: Uint8Array;
}

/** The table of a grade. Both engines read the same bytes. */
export function gradeTable(look: GradeLook, size = 33): GradeTable {
	const {
		contrast = 1,
		saturation = 1,
		lift = [0, 0, 0],
		gamma = [1, 1, 1],
		gain = [1, 1, 1],
	} = look;
	const data = new Uint8Array(size ** 3 * 4);
	const contrasted = (v: number) => clamp((v / (size - 1) - 0.5) * contrast + 0.5, 0, 1);
	const channel = (value: number, luma: number, i: 0 | 1 | 2) =>
		byte(lift[i] + Math.max(luma + (value - luma) * saturation, 0) ** gamma[i] * gain[i]);
	let at = 0;
	for (let b = 0; b < size; b++)
		for (let g = 0; g < size; g++)
			for (let r = 0; r < size; r++) {
				const red = contrasted(r);
				const green = contrasted(g);
				const blue = contrasted(b);
				const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				data[at++] = channel(red, luma, 0);
				data[at++] = channel(green, luma, 1);
				data[at++] = channel(blue, luma, 2);
				data[at++] = 255;
			}
	return { size, data };
}

// The effects that each comparison can switch, and the settings that both engines share.

/** The effects of a comparison. Each is a switch, on in both engines or off in both. */
export const EFFECT_NAMES = ['shadows', 'fog', 'bloom', 'ao', 'grade'] as const;
export type EffectName = (typeof EFFECT_NAMES)[number];
export type Effects = Record<EffectName, boolean>;

/** Every effect on. */
export function allEffects(): Effects {
	return { shadows: true, fog: true, bloom: true, ao: true, grade: true };
}

/** The effect switches as address text, such as `shadows,fog`. */
export function effectsToText(effects: Effects): string {
	return EFFECT_NAMES.filter((name) => effects[name]).join(',');
}

/** Reads effect switches from address text: null gives every effect, and unknown names throw. */
export function effectsFromText(text: string | null): Effects {
	if (text === null) return allEffects();
	const effects = { shadows: false, fog: false, bloom: false, ao: false, grade: false };
	for (const part of text.split(',')) {
		const name = part.trim();
		if (name === '') continue;
		if (!(EFFECT_NAMES as readonly string[]).includes(name))
			throw new RangeError(`"${name}" is not an effect. Use: ${EFFECT_NAMES.join(', ')}.`);
		effects[name as EffectName] = true;
	}
	return effects;
}

// How both engines build a comparison's scene.

/**
 * A comparison's two ways of building its scene, the same in both engines. 'scene-graph' makes one
 * object per part in a tree of parents and children, as each engine's own examples build jointed
 * models. 'instanced' makes one batch of copies per part kind, posed by the same closed-form loop.
 */
export const COMPARE_MODES = ['scene-graph', 'instanced'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

/** Reads a mode from address text: null gives the scene graph, and an unknown name throws. */
export function modeFromText(text: string | null): CompareMode {
	if (text === null || text === '') return 'scene-graph';
	if (!(COMPARE_MODES as readonly string[]).includes(text))
		throw new RangeError(`"${text}" is not a mode. Use: ${COMPARE_MODES.join(', ')}.`);
	return text as CompareMode;
}

// The benchmark scenes, defined once for every engine. Each engine's page builds its scene from
// these data and functions, so all engines draw the same objects, colors, motion and camera path.
// Everything here is plain data and pure functions with no engine imports. The per-frame
// functions write into arrays that the caller owns, so they allocate nothing.

/** A list of numbers that a per-frame function fills: a typed array or a plain array. */
export type OutArray = Float32Array | Float64Array | number[];

const TAU = 2 * Math.PI;

/**
 * A deterministic pseudo-random number generator (mulberry32). Each call returns the next float in
 * [0, 1), and the same seed always gives the same sequence.
 */
export function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), state | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Settings that every scene shares. Colors are sRGB hex strings: engines convert them to linear
// values and light in linear space.

/** The canvas of a benchmark run, in CSS pixels, at one device pixel per CSS pixel. */
export const CANVAS = { width: 1280, height: 720, pixelRatio: 1 } as const;
/** The size of the image that hold mode reads back for parity tests. */
export const PARITY_CANVAS = { width: 640, height: 360 } as const;
/** The clear color. */
export const BACKGROUND = '#101418';
/** The perspective camera: vertical field of view in degrees, and the near and far planes. */
export const CAMERA = { fov: 60, near: 0.1, far: 1000 } as const;
/** The directional light. The direction is the way the light travels, not where it comes from. */
export const SUN = { direction: [-1, -2, -1], color: '#ffffff', intensity: 3 } as const;
/** The ambient light. */
export const AMBIENT = { color: '#ffffff', intensity: 0.4 } as const;
/** The scene time, in seconds, of the single frame that hold mode renders. */
export const HOLD_TIME = 2.0;
/** A benchmark run's warm-up and measured seconds: the protocol that the bench command shares. */
export { MEASURE_SECONDS, WARMUP_SECONDS } from '../../packages/cli/src/protocol.js';

/** Seconds per turn of the orbiting cameras. */
export const ORBIT_SECONDS = 60;

/**
 * Writes the position of a camera that circles the origin and looks at it. It starts on +X and
 * turns counter-clockwise when seen from above, which is a positive turn about +Y.
 */
function orbitCamera(
	t: number,
	radius: number,
	height: number,
	outPosition: OutArray,
	outTarget: OutArray,
): void {
	const angle = (TAU * t) / ORBIT_SECONDS;
	outPosition[0] = radius * Math.cos(angle);
	outPosition[1] = height;
	outPosition[2] = -radius * Math.sin(angle);
	outTarget[0] = 0;
	outTarget[1] = 0;
	outTarget[2] = 0;
}

/** Vertex data of an indexed triangle mesh. */
export interface MeshData {
	/** Three floats per vertex. */
	position: Float32Array;
	/** Three floats per vertex, of unit length. */
	normal: Float32Array;
	/** Three vertex indices per triangle, counter-clockwise when seen from the front. */
	index: Uint16Array;
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
 * A box centered on the origin, with 24 vertices (4 per face, so each face has its own normal) and
 * 36 indices. It matches three.js's `BoxGeometry(width, height, depth)` value for value: the same
 * vertex order, positions, normals and triangle winding.
 */
export function boxGeometry(width: number, height: number, depth: number): MeshData {
	const size = [width, height, depth] as const;
	const position = new Float32Array(24 * 3);
	const normal = new Float32Array(24 * 3);
	const index = new Uint16Array(36);
	for (const [f, face] of BOX_FACES.entries()) {
		const faceWidth = size[face.uSize];
		const faceHeight = size[face.vSize];
		const halfDepth = (size[face.wSize] * face.wSign) / 2;
		for (let corner = 0; corner < 4; corner++) {
			const vertex = (f * 4 + corner) * 3;
			const x = (corner & 1) * faceWidth - faceWidth / 2;
			const y = (corner >> 1) * faceHeight - faceHeight / 2;
			position[vertex + face.u] = x * face.uDir;
			position[vertex + face.v] = y * face.vDir;
			position[vertex + face.w] = halfDepth;
			normal[vertex + face.w] = face.wSign;
		}
		// Corners 0 and 1 form the first row and corners 2 and 3 the second; two triangles per face.
		const first = f * 4;
		index.set([first, first + 2, first + 1, first + 2, first + 3, first + 1], f * 6);
	}
	return { position, normal, index };
}

// S1, the swarm: many instances of one box, each moved every frame by CPU code, and a camera that
// orbits them.

/** The instance count when the page has no `?n=` switch. */
export const S1_DEFAULT_COUNT = 100_000;
/** The width, height and depth of the box. */
export const S1_BOX_SIZE = 0.6;
/** The color of the one standard material. */
export const S1_COLOR = '#4a8cff';
/** Half the side of the cube that holds the instances' base positions. */
export const S1_EXTENT = 60;
/** How far each instance moves above and below its base position. */
export const S1_BOB_HEIGHT = 2;
/** The camera orbit: radius and height above the origin. */
export const S1_ORBIT = { radius: 140, height: 40 } as const;

/** Per-instance data of S1, as arrays with one entry (three for `base`) per instance. */
export interface S1Data {
	count: number;
	/** Base positions, three floats per instance, each in [-S1_EXTENT, S1_EXTENT). */
	base: Float32Array;
	/** Phase of the up-and-down motion, in radians, in [0, 2π). */
	phase: Float32Array;
	/** Speed of the up-and-down motion, in radians per second, in [0.5, 2). */
	speed: Float32Array;
	/** Turn rate about +Y, in radians per second, in [-1, 1). */
	spin: Float32Array;
}

function assertCount(n: number): void {
	if (!Number.isInteger(n) || n < 0) {
		throw new RangeError(`S1 needs a whole number of instances, 0 or more, not ${n}.`);
	}
}

/**
 * Makes S1's instances. The generator draws x, y, z, phase, speed and spin for instance 0, then the
 * same six values for instance 1, and so on. Storage as 32-bit floats can round a value just under
 * the top of its range up to the bound itself.
 */
export function createS1(n: number, seed = 1): S1Data {
	assertCount(n);
	const random = mulberry32(seed);
	const base = new Float32Array(n * 3);
	const phase = new Float32Array(n);
	const speed = new Float32Array(n);
	const spin = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		base[i * 3] = random() * 2 * S1_EXTENT - S1_EXTENT;
		base[i * 3 + 1] = random() * 2 * S1_EXTENT - S1_EXTENT;
		base[i * 3 + 2] = random() * 2 * S1_EXTENT - S1_EXTENT;
		phase[i] = random() * TAU;
		speed[i] = 0.5 + random() * 1.5;
		spin[i] = random() * 2 - 1;
	}
	return { count: n, base, phase, speed, spin };
}

/**
 * Writes instance i's position and rotation at time t, in seconds. The instance moves up and down
 * around its base position and turns about +Y. The rotation is a quaternion in x, y, z, w order.
 * The scale is always 1.
 */
export function s1InstanceAt(
	data: S1Data,
	i: number,
	t: number,
	outPosition: OutArray,
	outQuaternion: OutArray,
): void {
	const b = i * 3;
	outPosition[0] = data.base[b] ?? 0;
	outPosition[1] =
		(data.base[b + 1] ?? 0) +
		S1_BOB_HEIGHT * Math.sin((data.speed[i] ?? 0) * t + (data.phase[i] ?? 0));
	outPosition[2] = data.base[b + 2] ?? 0;
	const halfAngle = 0.5 * (data.spin[i] ?? 0) * t;
	outQuaternion[0] = 0;
	outQuaternion[1] = Math.sin(halfAngle);
	outQuaternion[2] = 0;
	outQuaternion[3] = Math.cos(halfAngle);
}

/** Writes S1's camera at time t: an orbit of the origin, one turn per `ORBIT_SECONDS`. */
export function s1Camera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	orbitCamera(t, S1_ORBIT.radius, S1_ORBIT.height, outPosition, outTarget);
}

// S1-static: S1's instances frozen at time 0, and a camera that flies through them.

/** The fly-through: the camera moves along -Z from `startZ` to `endZ`, then starts again. */
export const S1_STATIC_FLIGHT = { startZ: 100, endZ: -100, seconds: 30, height: 5 } as const;

/** Writes S1-static's camera at time t. It looks along -Z, the way it flies. */
export function s1StaticCamera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	const { startZ, endZ, seconds, height } = S1_STATIC_FLIGHT;
	const progress = (((t % seconds) + seconds) % seconds) / seconds;
	const z = startZ + (endZ - startZ) * progress;
	outPosition[0] = 0;
	outPosition[1] = height;
	outPosition[2] = z;
	outTarget[0] = 0;
	outTarget[1] = height;
	outTarget[2] = z - 1;
}

// S1-cells: S1-static's boxes spread over 8 x 8 of the engine's grid cells, 8 km on each side,
// and a camera that flies low over them, so only a few cells are in view at once.

/**
 * The square that S1-cells spreads its boxes over. The engine's grid cells are 1,024 m wide, and
 * the origin cell spans 512 m on each side of the origin, so the square covers the cells from -4
 * to 3 along x and along z, 64 cells in all.
 */
export const S1_CELLS_SQUARE = { cellSize: 1024, cells: 8, firstCell: -4 } as const;

/** The flight: the camera moves along -Z, `height` above the origin, then starts again. */
export const S1_CELLS_FLIGHT = {
	x: 300,
	startZ: 3000,
	endZ: -4000,
	seconds: 35,
	height: 5,
} as const;

/** Maps a coordinate of S1's cube onto the square's side: from -S1_EXTENT to the square's start. */
function acrossSquare(v: number): number {
	const { cellSize, cells, firstCell } = S1_CELLS_SQUARE;
	const start = (firstCell - 0.5) * cellSize;
	return start + ((v + S1_EXTENT) / (2 * S1_EXTENT)) * cells * cellSize;
}

/**
 * Writes S1-cells' instance i: S1's instance frozen at time 0, with its x and z spread from S1's
 * cube over the square. Its height and rotation stay S1's.
 */
export function s1CellsInstanceAt(
	data: S1Data,
	i: number,
	_t: number,
	outPosition: OutArray,
	outQuaternion: OutArray,
): void {
	s1InstanceAt(data, i, 0, outPosition, outQuaternion);
	outPosition[0] = acrossSquare(outPosition[0] as number);
	outPosition[2] = acrossSquare(outPosition[2] as number);
}

/** Writes S1-cells' camera at time t. It looks along -Z, the way it flies. */
export function s1CellsCamera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	const { x, startZ, endZ, seconds, height } = S1_CELLS_FLIGHT;
	const progress = (((t % seconds) + seconds) % seconds) / seconds;
	const z = startZ + (endZ - startZ) * progress;
	outPosition[0] = x;
	outPosition[1] = height;
	outPosition[2] = z;
	outTarget[0] = x;
	outTarget[1] = height;
	outTarget[2] = z - 1;
}

// S2, the hierarchy: a forest of trees of separate objects, whose roots turn every frame.

/** Trees in the forest when a page asks for no count. */
export const S2_ROOTS = 14;
/** Children of every node above the last level. */
export const S2_BRANCHING = 3;
/** Levels per tree, the root being level 0. */
export const S2_DEPTH = 6;
/** Nodes per tree: 1 + 3 + 9 + 27 + 81 + 243. */
export const S2_NODES_PER_TREE = (S2_BRANCHING ** S2_DEPTH - 1) / (S2_BRANCHING - 1);
/** Nodes in the forest when a page asks for no count. */
export const S2_NODE_COUNT = S2_ROOTS * S2_NODES_PER_TREE;
/** Box meshes that the nodes share. */
export const S2_MESH_COUNT = 20;
/** Standard materials that the nodes share, one per color. */
export const S2_MATERIAL_COUNT = 5;
/** The material colors. */
export const S2_COLORS = ['#e8554e', '#f2c14e', '#5bc27a', '#4a8cff', '#b06ce0'] as const;
/** Roots sit on a grid centered on the origin, with this many columns, this far apart. */
export const S2_GRID = { columns: 7, spacing: 30 } as const;
/** The distance in the XZ plane from a level-1 node to its parent. */
export const S2_BRANCH_RADIUS = 4;
/** Each level below level 1 sits this many times closer to its parent than the level above. */
export const S2_RADIUS_FALLOFF = 0.6;
/** The local scale of every node below the roots. */
export const S2_CHILD_SCALE = 0.7;
/** Mesh k's sizes come from a generator seeded with this plus k. */
export const S2_MESH_SEED = 100;
/** The camera orbit: radius and height above the origin. */
export const S2_ORBIT = { radius: 110, height: 60 } as const;

/**
 * The forest, one entry per node (three for `position`), in depth-first order: every parent comes
 * before its children, and each tree's nodes are contiguous. Transforms are local to the parent.
 */
export interface S2Data {
	/** The parent's node index, or -1 for a root. */
	parent: Int32Array;
	/** The level, 0 for a root. */
	depth: Uint8Array;
	/** The mesh index, below `S2_MESH_COUNT`. */
	mesh: Uint8Array;
	/** The material index, below `S2_MATERIAL_COUNT`. */
	material: Uint8Array;
	/** The local position, three floats per node. */
	position: Float32Array;
	/** The local rotation about +Y, in radians. */
	rotationY: Float32Array;
	/** The local uniform scale. */
	scale: Float32Array;
}

/** The trees of a forest with at least `count` nodes: whole trees, and at least one. */
export function s2Trees(count: number): number {
	return Math.max(1, Math.ceil(count / S2_NODES_PER_TREE));
}

/**
 * Makes a forest of `trees` trees. For each node in depth-first order, the generator draws, below
 * the roots only, the offset angle, the height in [-1, 1) and the rotation; then, for every node,
 * the mesh and the material. A root's rotation is 0 here, because `s2RootRotation` sets it each
 * frame.
 */
export function createS2(seed = 2, trees = S2_ROOTS): S2Data {
	const random = mulberry32(seed);
	const nodes = trees * S2_NODES_PER_TREE;
	const data: S2Data = {
		parent: new Int32Array(nodes),
		depth: new Uint8Array(nodes),
		mesh: new Uint8Array(nodes),
		material: new Uint8Array(nodes),
		position: new Float32Array(nodes * 3),
		rotationY: new Float32Array(nodes),
		scale: new Float32Array(nodes),
	};
	const { columns, spacing } = S2_GRID;
	const rows = Math.ceil(trees / columns);
	let next = 0;
	const addNode = (parent: number, depth: number, root: number): void => {
		const i = next++;
		data.parent[i] = parent;
		data.depth[i] = depth;
		if (depth === 0) {
			data.position[i * 3] = ((root % columns) - (columns - 1) / 2) * spacing;
			data.position[i * 3 + 2] = (Math.floor(root / columns) - (rows - 1) / 2) * spacing;
			data.scale[i] = 1;
		} else {
			const radius = S2_BRANCH_RADIUS * S2_RADIUS_FALLOFF ** (depth - 1);
			const angle = random() * TAU;
			data.position[i * 3] = radius * Math.cos(angle);
			data.position[i * 3 + 1] = random() * 2 - 1;
			data.position[i * 3 + 2] = radius * Math.sin(angle);
			data.rotationY[i] = random() * TAU;
			data.scale[i] = S2_CHILD_SCALE;
		}
		data.mesh[i] = Math.floor(random() * S2_MESH_COUNT);
		data.material[i] = Math.floor(random() * S2_MATERIAL_COUNT);
		if (depth + 1 < S2_DEPTH) {
			for (let c = 0; c < S2_BRANCHING; c++) addNode(i, depth + 1, root);
		}
	};
	for (let root = 0; root < trees; root++) addNode(-1, 0, root);
	return data;
}

/** The width, height and depth of S2's box mesh k, each in [0.5, 1.5). */
export function s2MeshSize(k: number): [width: number, height: number, depth: number] {
	const random = mulberry32(S2_MESH_SEED + k);
	const width = 0.5 + random();
	const height = 0.5 + random();
	const depth = 0.5 + random();
	return [width, height, depth];
}

/** The rotation about +Y, in radians, of root `rootIndex` at time t. Each root turns at its own rate. */
export function s2RootRotation(t: number, rootIndex: number): number {
	return t * (0.2 + 0.1 * (rootIndex % 5));
}

/** Writes S2's camera at time t: an orbit of the origin, one turn per `ORBIT_SECONDS`. */
export function s2Camera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	orbitCamera(t, S2_ORBIT.radius, S2_ORBIT.height, outPosition, outTarget);
}

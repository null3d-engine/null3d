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

/** A scene's directional light, its sun, and its ambient light. */
export interface SceneLights {
	sun: {
		readonly direction: readonly [number, number, number];
		readonly color: string;
		readonly intensity: number;
		/** True when the sun casts shadows. */
		readonly castShadows?: boolean;
	};
	ambient: { readonly color: string; readonly intensity: number };
}
/** The sun and the ambient light of every scene that names no others. */
export const VIEW_LIGHTS: SceneLights = { sun: SUN, ambient: AMBIENT };
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

function assertCount(scene: string, n: number): void {
	if (!Number.isInteger(n) || n < 0) {
		throw new RangeError(`${scene} needs a whole number of instances, 0 or more, not ${n}.`);
	}
}

/**
 * Makes S1's instances. The generator draws x, y, z, phase, speed and spin for instance 0, then the
 * same six values for instance 1, and so on. Storage as 32-bit floats can round a value just under
 * the top of its range up to the bound itself.
 */
export function createS1(n: number, seed = 1): S1Data {
	assertCount('S1', n);
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

// S3, the lights: still boxes in one batch on a floor, lit by many point lights with a range that
// move every frame, and a camera that orbits them.

/** The box count when the page has no `?n=` switch. */
export const S3_DEFAULT_COUNT = 20_000;
/** The point lights. Their count is fixed: `?n=` changes the box count only. */
export const S3_LIGHT_COUNT = 256;
/** Half the side of the square that holds the boxes and the centers of the lights' paths. */
export const S3_EXTENT = 100;
/**
 * The floor: a square plane under the boxes, wide enough for the lights' paths, with one standard
 * material. The rotation, a quaternion in x, y, z, w order, turns the plane from facing +Z to
 * facing +Y.
 */
export const S3_FLOOR = {
	size: 240,
	color: '#6c7480',
	rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
} as const;
/**
 * The boxes: one unit box, scaled to this width and to a height from `minHeight` up to
 * `maxHeight`, with one standard material.
 */
export const S3_BOX = { width: 0.8, minHeight: 0.5, maxHeight: 3, color: '#d8dce0' } as const;
/** Every point light: its range in meters, its decay, and its intensity in candela. */
export const S3_LIGHT = { range: 12, decay: 2, intensity: 30 } as const;
/** The point lights' colors: light i has the color at i modulo the list's length. */
export const S3_LIGHT_COLORS = [
	'#ff4d4d',
	'#ffa64d',
	'#ffff4d',
	'#4dff4d',
	'#4dffff',
	'#4d88ff',
	'#a64dff',
	'#ff4dd2',
] as const;
/**
 * The lights' paths: circles with a radius in meters, at a height above the floor, at a turn rate
 * in radians per second, each from its minimum up to its maximum.
 */
export const S3_PATHS = {
	minRadius: 2,
	maxRadius: 10,
	minHeight: 1.5,
	maxHeight: 4,
	minSpeed: 0.2,
	maxSpeed: 0.8,
} as const;
/** The seed of the lights' generator, which is not the boxes', so every box count has the same lights. */
export const S3_LIGHT_SEED = 30;
/** A dim sun and ambient light, so that the point lights show. */
export const S3_VIEW_LIGHTS: SceneLights = {
	sun: { direction: SUN.direction, color: '#b4c4ff', intensity: 0.4 },
	ambient: { color: AMBIENT.color, intensity: 0.1 },
};
/** The camera orbit: radius and height above the origin. */
export const S3_ORBIT = { radius: 120, height: 50 } as const;

/** Per-box and per-light data of S3. */
export interface S3Data {
	/** The box count. */
	count: number;
	/** Box positions on the floor, x and z per box, each in its cell of `s3Grid`. */
	base: Float32Array;
	/** Box heights. */
	height: Float32Array;
	/** Box turns about +Y, in radians, in [0, 2π). */
	yaw: Float32Array;
	/** The centers of the lights' circles, x and z per light, each in [-S3_EXTENT, S3_EXTENT). */
	lightCenter: Float32Array;
	/** The radii of the lights' circles. */
	lightRadius: Float32Array;
	/** The lights' heights above the floor. */
	lightHeight: Float32Array;
	/** The lights' turn rates about +Y, in radians per second; a negative rate turns clockwise. */
	lightSpeed: Float32Array;
	/** The lights' angles on their circles at time 0, in radians, in [0, 2π). */
	lightPhase: Float32Array;
}

/** The value at `share` of the way from `min` to `max`. */
const between = (min: number, max: number, share: number) => min + (max - min) * share;

/**
 * The grid that S3's boxes stand on, over the square of the boxes: `side` cells on each side of the
 * square, the fewest that hold `n` boxes, `spacing` meters apart. Box i stands in cell i, in rows
 * along +X from the -X and -Z corner, and moves from the cell's center by at most `jitter` along
 * each axis. The jitter keeps every turned box inside its cell, so no two boxes touch when the
 * cells are wide enough. Boxes that met would give pixels of equal depth, which GPUs draw in
 * either order.
 */
export function s3Grid(n: number): { side: number; spacing: number; jitter: number } {
	const side = Math.max(1, Math.ceil(Math.sqrt(n)));
	const spacing = (2 * S3_EXTENT) / side;
	// The farthest that a turned box reaches from its center, plus a margin, in each direction.
	const reach = S3_BOX.width * Math.SQRT1_2 * 1.05;
	return { side, spacing, jitter: Math.max(0, spacing / 2 - reach) };
}

/**
 * Makes S3's boxes and lights. The boxes' generator draws the offset in x and z from the cell's
 * center, the height and the turn for box 0, then the same four values for box 1, and so on. The
 * lights' generator draws each light's center x and z, radius, height, turn rate, direction of turn
 * and angle at time 0.
 */
export function createS3(n: number, seed = 3): S3Data {
	assertCount('S3', n);
	const boxes = mulberry32(seed);
	const base = new Float32Array(n * 2);
	const height = new Float32Array(n);
	const yaw = new Float32Array(n);
	const { side, spacing, jitter } = s3Grid(n);
	for (let i = 0; i < n; i++) {
		const column = i % side;
		const row = Math.floor(i / side);
		base[i * 2] = -S3_EXTENT + (column + 0.5) * spacing + between(-jitter, jitter, boxes());
		base[i * 2 + 1] = -S3_EXTENT + (row + 0.5) * spacing + between(-jitter, jitter, boxes());
		height[i] = between(S3_BOX.minHeight, S3_BOX.maxHeight, boxes());
		yaw[i] = boxes() * TAU;
	}
	const lights = mulberry32(S3_LIGHT_SEED);
	const lightCenter = new Float32Array(S3_LIGHT_COUNT * 2);
	const lightRadius = new Float32Array(S3_LIGHT_COUNT);
	const lightHeight = new Float32Array(S3_LIGHT_COUNT);
	const lightSpeed = new Float32Array(S3_LIGHT_COUNT);
	const lightPhase = new Float32Array(S3_LIGHT_COUNT);
	const { minRadius, maxRadius, minHeight, maxHeight, minSpeed, maxSpeed } = S3_PATHS;
	for (let i = 0; i < S3_LIGHT_COUNT; i++) {
		lightCenter[i * 2] = between(-S3_EXTENT, S3_EXTENT, lights());
		lightCenter[i * 2 + 1] = between(-S3_EXTENT, S3_EXTENT, lights());
		lightRadius[i] = between(minRadius, maxRadius, lights());
		lightHeight[i] = between(minHeight, maxHeight, lights());
		const speed = between(minSpeed, maxSpeed, lights());
		lightSpeed[i] = lights() < 0.5 ? -speed : speed;
		lightPhase[i] = lights() * TAU;
	}
	return {
		count: n,
		base,
		height,
		yaw,
		lightCenter,
		lightRadius,
		lightHeight,
		lightSpeed,
		lightPhase,
	};
}

/**
 * Writes box i's position, rotation and scale. The box stands on the floor, so its center is half
 * its height above it. The rotation is a quaternion in x, y, z, w order, about +Y.
 */
export function s3BoxAt(
	data: S3Data,
	i: number,
	outPosition: OutArray,
	outQuaternion: OutArray,
	outScale: OutArray,
): void {
	const height = data.height[i] ?? 0;
	outPosition[0] = data.base[i * 2] ?? 0;
	outPosition[1] = height / 2;
	outPosition[2] = data.base[i * 2 + 1] ?? 0;
	const halfAngle = 0.5 * (data.yaw[i] ?? 0);
	outQuaternion[0] = 0;
	outQuaternion[1] = Math.sin(halfAngle);
	outQuaternion[2] = 0;
	outQuaternion[3] = Math.cos(halfAngle);
	outScale[0] = S3_BOX.width;
	outScale[1] = height;
	outScale[2] = S3_BOX.width;
}

/** The color of point light i. */
export function s3LightColor(i: number): string {
	return S3_LIGHT_COLORS[i % S3_LIGHT_COLORS.length] as string;
}

/** Writes point light i's position at time t: on its circle, at its height above the floor. */
export function s3LightAt(data: S3Data, i: number, t: number, outPosition: OutArray): void {
	const angle = (data.lightSpeed[i] ?? 0) * t + (data.lightPhase[i] ?? 0);
	const radius = data.lightRadius[i] ?? 0;
	outPosition[0] = (data.lightCenter[i * 2] ?? 0) + radius * Math.cos(angle);
	outPosition[1] = data.lightHeight[i] ?? 0;
	outPosition[2] = (data.lightCenter[i * 2 + 1] ?? 0) + radius * Math.sin(angle);
}

/** Writes S3's camera at time t: an orbit of the origin, one turn per `ORBIT_SECONDS`. */
export function s3Camera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	orbitCamera(t, S3_ORBIT.radius, S3_ORBIT.height, outPosition, outTarget);
}

// S4, the phone scene: a town of still buildings and street furniture in about 50 mesh and material
// buckets, vehicles that drive its streets, textured standard materials, a sun that casts shadows,
// 16 street lights and fog, and a camera that circles above the town. Its page runs with the
// quality preset that the engine chooses, on a canvas that fills the window.

/**
 * The town, in meters: blocks on each side, the side of a block, the width of the streets between
 * and around the blocks, the height of each block's sidewalk slab, and building lots on each side
 * of a block.
 */
export const S4_TOWN = { blocks: 4, blockSize: 56, street: 14, slabHeight: 0.2, lots: 3 } as const;
/** From one block's center to the next. */
const S4_PITCH = S4_TOWN.blockSize + S4_TOWN.street;
/** Half the side of the town, to the outer edge of its outer streets. */
export const S4_EXTENT = (S4_TOWN.blocks / 2) * S4_PITCH + S4_TOWN.street / 2;
/** The side of the ground plane under the town, which reaches into the fog. */
export const S4_GROUND_SIZE = 800;

/** The center of block i along either axis, for i from 0 to `blocks - 1`. */
export function s4BlockCenter(i: number): number {
	return (i - (S4_TOWN.blocks - 1) / 2) * S4_PITCH;
}

/** The center line of street j along either axis, for j from 0 to `blocks`. */
export function s4StreetCenter(j: number): number {
	return (j - S4_TOWN.blocks / 2) * S4_PITCH;
}

/** A geometry generator that both engines have, by its null3D name. */
export type S4Generator =
	| 'box'
	| 'cylinder'
	| 'sphere'
	| 'cone'
	| 'capsule'
	| 'torus'
	| 'plane'
	| 'circle'
	| 'ring';

/**
 * One of S4's meshes: a generator and its null3D options, which three.js's geometry class of the
 * same name takes as arguments in its own order. `unit` is the mesh's size along x, y and z, so a
 * size in meters divided by it gives the object's scale. A flat mesh lies in the XY plane facing +Z,
 * and S4 turns it to face up, so its x and y become the object's x and z.
 */
export interface S4MeshSpec {
	generator: S4Generator;
	options: Readonly<Record<string, number>>;
	unit: readonly [number, number, number];
	flat?: boolean;
}

/** S4's meshes, which its objects share. */
export const S4_MESHES = {
	block: { generator: 'box', options: {}, unit: [1, 1, 1] },
	drum: {
		generator: 'cylinder',
		options: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 16 },
		unit: [1, 1, 1],
	},
	post: {
		generator: 'cylinder',
		options: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 6 },
		unit: [1, 1, 1],
	},
	ball: {
		generator: 'sphere',
		options: { radius: 0.5, widthSegments: 16, heightSegments: 10 },
		unit: [1, 1, 1],
	},
	cone: {
		generator: 'cone',
		options: { radius: 0.5, height: 1, radialSegments: 12 },
		unit: [1, 1, 1],
	},
	capsule: {
		generator: 'capsule',
		options: { radius: 0.25, height: 0.5, capSegments: 3, radialSegments: 8 },
		unit: [0.5, 1, 0.5],
	},
	hoop: {
		generator: 'torus',
		options: { radius: 0.4, tube: 0.1, radialSegments: 6, tubularSegments: 16 },
		unit: [1, 1, 0.2],
	},
	tile: { generator: 'plane', options: {}, unit: [1, 1, 1], flat: true },
	disc: {
		generator: 'circle',
		options: { radius: 0.5, segments: 16 },
		unit: [1, 1, 1],
		flat: true,
	},
	band: {
		generator: 'ring',
		options: { innerRadius: 0.4, outerRadius: 0.5, thetaSegments: 32 },
		unit: [1, 1, 1],
		flat: true,
	},
} as const satisfies Record<string, S4MeshSpec>;
export type S4MeshName = keyof typeof S4_MESHES;

/** The patterns of S4's textures. */
export const S4_TEXTURES = ['grain', 'bricks', 'windows', 'planks'] as const;
export type S4TextureName = (typeof S4_TEXTURES)[number];
/** The side of every texture, in texels. */
export const S4_TEXTURE_SIZE = 64;
/**
 * The anisotropy that S4's textures ask for. The quality preset caps it: null3D's `maxAnisotropy`
 * setting, and the same cap for the three.js twin.
 */
export const S4_ANISOTROPY = 16;

/**
 * One of S4's standard materials: its color, the texture that multiplies the color, and its
 * roughness and metalness.
 */
export interface S4MaterialSpec {
	color: string;
	texture: S4TextureName;
	roughness: number;
	metalness: number;
}

/** S4's materials, which its objects share. */
export const S4_MATERIALS = {
	asphalt: { color: '#5a5e63', texture: 'grain', roughness: 0.95, metalness: 0 },
	concrete: { color: '#b9b6ae', texture: 'grain', roughness: 0.9, metalness: 0 },
	brick: { color: '#b0614a', texture: 'bricks', roughness: 0.85, metalness: 0 },
	plaster: { color: '#e3d6bd', texture: 'windows', roughness: 0.8, metalness: 0 },
	glass: { color: '#7d9bb8', texture: 'windows', roughness: 0.25, metalness: 0.4 },
	metal: { color: '#8c9196', texture: 'grain', roughness: 0.4, metalness: 0.8 },
	wood: { color: '#8a5a36', texture: 'planks', roughness: 0.75, metalness: 0 },
	foliage: { color: '#4f8a3c', texture: 'grain', roughness: 0.9, metalness: 0 },
	paint: { color: '#e9e9e4', texture: 'grain', roughness: 0.6, metalness: 0 },
	red: { color: '#c23b30', texture: 'grain', roughness: 0.5, metalness: 0.1 },
} as const satisfies Record<string, S4MaterialSpec>;
export type S4MaterialName = keyof typeof S4_MATERIALS;

/** A kind of object: its mesh, its material and, for the kinds of fixed size, its size in meters. */
export interface S4Kind {
	mesh: S4MeshName;
	material: S4MaterialName;
	size?: readonly [number, number, number];
}

/** The ground, the sidewalk slabs, the buildings, what stands on their roofs, and the streets' marks. */
const S4_TOWN_KINDS = {
	ground: { mesh: 'tile', material: 'asphalt' },
	slab: { mesh: 'block', material: 'concrete' },
	brickBuilding: { mesh: 'block', material: 'brick' },
	plasterBuilding: { mesh: 'block', material: 'plaster' },
	glassBuilding: { mesh: 'block', material: 'glass' },
	concreteBuilding: { mesh: 'block', material: 'concrete' },
	glassTower: { mesh: 'drum', material: 'glass' },
	plasterTower: { mesh: 'drum', material: 'plaster' },
	tank: { mesh: 'drum', material: 'metal', size: [3, 2.5, 3] },
	plant: { mesh: 'block', material: 'metal', size: [4, 1.5, 3] },
	spire: { mesh: 'cone', material: 'brick', size: [3, 6, 3] },
	dome: { mesh: 'ball', material: 'glass', size: [5, 5, 5] },
	dash: { mesh: 'tile', material: 'paint', size: [3, 0, 0.25] },
	manhole: { mesh: 'disc', material: 'metal', size: [0.9, 0, 0.9] },
	crossing: { mesh: 'band', material: 'paint', size: [9, 0, 9] },
	lamp: { mesh: 'post', material: 'metal', size: [0.2, 5.5, 0.2] },
} as const satisfies Record<string, S4Kind>;

/** The street furniture along the sidewalks, which the generator picks from spot by spot. */
const S4_PROP_KINDS = [
	{ mesh: 'ball', material: 'foliage', size: [1, 1, 1] },
	{ mesh: 'cone', material: 'foliage', size: [1.1, 3, 1.1] },
	{ mesh: 'block', material: 'foliage', size: [1.2, 0.9, 0.7] },
	{ mesh: 'capsule', material: 'foliage', size: [0.8, 1.5, 0.8] },
	{ mesh: 'block', material: 'wood', size: [1.4, 0.5, 0.5] },
	{ mesh: 'drum', material: 'red', size: [0.6, 0.9, 0.6] },
	{ mesh: 'drum', material: 'metal', size: [0.6, 0.9, 0.6] },
	{ mesh: 'capsule', material: 'concrete', size: [0.3, 0.9, 0.3] },
	{ mesh: 'capsule', material: 'metal', size: [0.3, 0.9, 0.3] },
	{ mesh: 'capsule', material: 'paint', size: [0.3, 0.9, 0.3] },
	{ mesh: 'hoop', material: 'metal', size: [0.9, 0.9, 0.9] },
	{ mesh: 'hoop', material: 'red', size: [0.9, 0.9, 0.9] },
	{ mesh: 'capsule', material: 'red', size: [0.35, 0.8, 0.35] },
	{ mesh: 'block', material: 'red', size: [0.6, 1.2, 0.5] },
	{ mesh: 'cone', material: 'red', size: [0.4, 0.7, 0.4] },
	{ mesh: 'cone', material: 'paint', size: [0.4, 0.7, 0.4] },
	{ mesh: 'ball', material: 'concrete', size: [0.6, 0.6, 0.6] },
	{ mesh: 'post', material: 'wood', size: [0.25, 1.2, 0.25] },
	{ mesh: 'post', material: 'red', size: [0.25, 1.2, 0.25] },
	{ mesh: 'post', material: 'paint', size: [0.25, 1.2, 0.25] },
	{ mesh: 'drum', material: 'concrete', size: [1, 0.6, 1] },
	{ mesh: 'drum', material: 'wood', size: [0.7, 1, 0.7] },
	{ mesh: 'ball', material: 'metal', size: [0.5, 0.5, 0.5] },
	{ mesh: 'block', material: 'paint', size: [0.9, 1.6, 0.1] },
	{ mesh: 'post', material: 'glass', size: [1.2, 2.6, 1.2] },
	{ mesh: 'block', material: 'wood', size: [0.9, 0.9, 0.9] },
	{ mesh: 'block', material: 'brick', size: [0.6, 1.4, 0.6] },
	{ mesh: 'cone', material: 'metal', size: [0.5, 1.2, 0.5] },
	{ mesh: 'ball', material: 'red', size: [0.5, 0.5, 0.5] },
	{ mesh: 'capsule', material: 'wood', size: [0.3, 1.1, 0.3] },
	{ mesh: 'hoop', material: 'concrete', size: [1, 1, 1] },
	{ mesh: 'drum', material: 'paint', size: [0.6, 0.9, 0.6] },
	{ mesh: 'post', material: 'concrete', size: [0.3, 0.8, 0.3] },
	{ mesh: 'tile', material: 'concrete', size: [1, 0, 1] },
	{ mesh: 'disc', material: 'red', size: [0.8, 0, 0.8] },
	{ mesh: 'band', material: 'metal', size: [0.8, 0, 0.8] },
] as const satisfies readonly S4Kind[];

/** The vehicles: boxes of their own size that drive the streets. */
const S4_VEHICLE_KINDS = [
	{ mesh: 'block', material: 'red', size: [4.2, 1.5, 1.8] },
	{ mesh: 'block', material: 'paint', size: [5, 2.2, 2] },
	{ mesh: 'block', material: 'metal', size: [7, 2.8, 2.4] },
	{ mesh: 'block', material: 'glass', size: [10, 3, 2.5] },
] as const satisfies readonly S4Kind[];

/** Every kind of object, by index: the still ones first, then the vehicles. */
export const S4_KINDS: readonly S4Kind[] = [
	...Object.values(S4_TOWN_KINDS),
	...S4_PROP_KINDS,
	...S4_VEHICLE_KINDS,
];
const TOWN_KIND_NAMES = Object.keys(S4_TOWN_KINDS) as (keyof typeof S4_TOWN_KINDS)[];
/** The index in `S4_KINDS` of a kind of the town. */
const townKind = (name: keyof typeof S4_TOWN_KINDS): number => TOWN_KIND_NAMES.indexOf(name);
const FIRST_PROP_KIND = TOWN_KIND_NAMES.length;
/** The index in `S4_KINDS` of the first vehicle kind. */
export const S4_FIRST_VEHICLE_KIND = FIRST_PROP_KIND + S4_PROP_KINDS.length;

/** The mesh and the material of the objects of kind `kind`, which are their bucket. */
export function s4KindOf(kind: number): S4Kind {
	const found = S4_KINDS[kind];
	if (!found) throw new RangeError(`S4 has no object kind ${kind}.`);
	return found;
}

/**
 * The buildings: the least and the most width, depth and height, in meters, the share that are
 * round towers, and the share that carry something on the roof.
 */
export const S4_BUILDINGS = {
	minWidth: 9,
	maxWidth: 14,
	minHeight: 6,
	maxHeight: 30,
	towerShare: 0.25,
	roofShare: 0.5,
} as const;
/** Street furniture along each side of each block, and its distance from the block's edge. */
export const S4_PROPS = { perSide: 67, inset: 0.8 } as const;
/**
 * The road markings: the dashes' spacing along each street's center line, the manholes' spacing
 * along the lanes, and the lanes' distance from the center line, in meters.
 */
export const S4_MARKINGS = { dashSpacing: 6, manholeSpacing: 21, lane: 3.5 } as const;
/** How high the flat marks lie above what they lie on, so that the GPU draws them over it. */
const MARK_LIFT = 0.02;
/** The vehicles: how many, and their least and most speed in meters per second. */
export const S4_VEHICLES = { count: 200, minSpeed: 6, maxSpeed: 14 } as const;
/** How often each kind of vehicle drives, in the order of the vehicle kinds. */
const VEHICLE_WEIGHTS = [0.6, 0.2, 0.12, 0.08] as const;

/** The street lights: one above the corner of each block nearest the town's center. */
export const S4_STREET_LIGHT = {
	color: '#ffd29a',
	intensity: 120,
	range: 28,
	decay: 2,
	height: 6,
	cornerInset: 1.5,
} as const;
/** The sun, which casts the shadows, and the ambient light. */
export const S4_VIEW_LIGHTS: SceneLights = {
	sun: { direction: [-0.6, -1, -0.4], color: '#fff0dc', intensity: 2.5, castShadows: true },
	ambient: { color: '#c8d4e4', intensity: 0.5 },
};
/** Linear fog, whose color is also the background's. */
export const S4_FOG = { color: '#a7b6c6', near: 80, far: 360 } as const;
/**
 * How far from the camera the sun's shadows reach, in meters: null3D's default, and the far end of
 * the three.js twin's cascades.
 */
export const S4_SHADOW_DISTANCE = 200;
/**
 * The camera's path: a circle of `radius` at `height` above the town's center, one turn in
 * `seconds`. The camera looks at a point `lookAhead` radians further on, on a circle of
 * `lookRadius` on the ground, so it looks forward and down into the town.
 */
export const S4_CAMERA_PATH = {
	radius: 95,
	height: 42,
	lookRadius: 50,
	lookAhead: 0.9,
	seconds: 60,
} as const;

/** S4's still objects, vehicles and street lights. */
export interface S4Data {
	/** Still objects. */
	count: number;
	/** Each still object's index in `S4_KINDS`. */
	kind: Uint8Array;
	/** Centers, three floats per still object. */
	position: Float32Array;
	/** Turns about +Y, in radians. */
	yaw: Float32Array;
	/** Sizes in meters along the object's own x, y and z, three floats per still object. */
	size: Float32Array;
	/** Vehicles. */
	vehicles: number;
	/** Each vehicle's index in `S4_KINDS`. */
	vehicleKind: Uint8Array;
	/** 0 for a vehicle that drives along X, 1 for one that drives along Z. */
	vehicleAxis: Uint8Array;
	/** The coordinate of the vehicle's lane across the way it drives. */
	vehicleLane: Float32Array;
	/** 1 for a vehicle that drives toward +X or +Z, -1 for one that drives the other way. */
	vehicleDirection: Int8Array;
	/** Speeds, in meters per second. */
	vehicleSpeed: Float32Array;
	/** Where each vehicle is at time 0, as a share of the town's length from its -X or -Z edge. */
	vehiclePhase: Float32Array;
	/** The street lights' positions, three floats per light. */
	lights: Float32Array;
}

/** Collects still objects while `createS4` places them. */
class S4Objects {
	readonly kind: number[] = [];
	readonly position: number[] = [];
	readonly yaw: number[] = [];
	readonly size: number[] = [];

	add(kind: number, x: number, y: number, z: number, yaw: number, size: readonly number[]): void {
		this.kind.push(kind);
		this.position.push(x, y, z);
		this.yaw.push(yaw);
		this.size.push(size[0] ?? 0, size[1] ?? 0, size[2] ?? 0);
	}

	/**
	 * Adds an object of a kind of fixed size that stands on a surface at height `base`. A hoop's
	 * center sits on the surface, so it stands as an arch, and a flat mesh lies just above it.
	 */
	stand(kind: number, x: number, base: number, z: number, yaw: number): void {
		const { mesh, size = [1, 1, 1] } = s4KindOf(kind);
		const spec: S4MeshSpec = S4_MESHES[mesh];
		const lift = spec.flat ? MARK_LIFT : mesh === 'hoop' ? 0 : size[1] / 2;
		this.add(kind, x, base + lift, z, yaw, size);
	}
}

/** Whether a coordinate along a street lies in a crossing street, or within `margin` of one. */
function inCrossing(u: number, margin: number): boolean {
	for (let j = 0; j <= S4_TOWN.blocks; j++)
		if (Math.abs(u - s4StreetCenter(j)) < S4_TOWN.street / 2 + margin) return true;
	return false;
}

/**
 * Makes S4. The generator draws, block by block in rows along +X from the -X and -Z corner: for each
 * lot, whether its building is a round tower, the building's kind, width, depth (boxes only),
 * height and offset in x and z, whether it carries a roof object and that object's kind; then for
 * each spot along the block's four sides, the furniture's kind and turn. The road markings and the
 * street lights need no random numbers. Then for each vehicle: its axis, street, direction, kind,
 * speed and phase.
 */
export function createS4(seed = 4): S4Data {
	const random = mulberry32(seed);
	const pick = (count: number) => Math.min(count - 1, Math.floor(random() * count));
	const { blocks, blockSize, slabHeight, lots } = S4_TOWN;
	const objects = new S4Objects();
	objects.add(townKind('ground'), 0, 0, 0, 0, [S4_GROUND_SIZE, 0, S4_GROUND_SIZE]);
	const lot = blockSize / lots;
	const half = blockSize / 2;
	const boxKinds = [
		townKind('brickBuilding'),
		townKind('plasterBuilding'),
		townKind('glassBuilding'),
		townKind('concreteBuilding'),
	];
	const towerKinds = [townKind('glassTower'), townKind('plasterTower')];
	const roofKinds = [townKind('tank'), townKind('plant'), townKind('spire'), townKind('dome')];
	const { minWidth, maxWidth, minHeight, maxHeight, towerShare, roofShare } = S4_BUILDINGS;
	const lights: number[] = [];
	for (let bz = 0; bz < blocks; bz++) {
		for (let bx = 0; bx < blocks; bx++) {
			const cx = s4BlockCenter(bx);
			const cz = s4BlockCenter(bz);
			objects.add(townKind('slab'), cx, slabHeight / 2, cz, 0, [blockSize, slabHeight, blockSize]);
			for (let lz = 0; lz < lots; lz++) {
				for (let lx = 0; lx < lots; lx++) {
					const tower = random() < towerShare;
					const kinds = tower ? towerKinds : boxKinds;
					const kind = kinds[pick(kinds.length)] as number;
					const width = between(minWidth, maxWidth, random());
					const depth = tower ? width : between(minWidth, maxWidth, random());
					const height = between(minHeight, maxHeight, random());
					// The building keeps half a meter from the edge of its lot.
					const room = Math.max(0, (lot - Math.max(width, depth)) / 2 - 0.5);
					const x = cx - half + (lx + 0.5) * lot + between(-room, room, random());
					const z = cz - half + (lz + 0.5) * lot + between(-room, room, random());
					objects.add(kind, x, slabHeight + height / 2, z, 0, [width, height, depth]);
					if (random() < roofShare)
						objects.stand(
							roofKinds[pick(roofKinds.length)] as number,
							x,
							slabHeight + height,
							z,
							0,
						);
				}
			}
			// Sides 0 and 1 run along X on the block's -Z and +Z edges, sides 2 and 3 along Z on its -X
			// and +X edges.
			const across = half - S4_PROPS.inset;
			for (let side = 0; side < 4; side++) {
				const sign = side % 2 === 0 ? -1 : 1;
				for (let k = 0; k < S4_PROPS.perSide; k++) {
					const along = -half + ((k + 0.5) * blockSize) / S4_PROPS.perSide;
					const x = cx + (side < 2 ? along : sign * across);
					const z = cz + (side < 2 ? sign * across : along);
					const kind = FIRST_PROP_KIND + pick(S4_PROP_KINDS.length);
					objects.stand(kind, x, slabHeight, z, random() * TAU);
				}
			}
			// A street light, and a lamp post under it, at the block's corner nearest the town's center.
			const corner = half - S4_STREET_LIGHT.cornerInset;
			const px = cx - Math.sign(cx) * corner;
			const pz = cz - Math.sign(cz) * corner;
			objects.stand(townKind('lamp'), px, slabHeight, pz, 0);
			lights.push(px, S4_STREET_LIGHT.height, pz);
		}
	}
	const { dashSpacing, manholeSpacing, lane } = S4_MARKINGS;
	for (let axis = 0; axis < 2; axis++) {
		// Marks along X keep their turn, and marks along Z turn a quarter.
		const yaw = axis === 0 ? 0 : Math.PI / 2;
		for (let j = 0; j <= blocks; j++) {
			const line = s4StreetCenter(j);
			const mark = (kind: number, u: number, offset: number) =>
				axis === 0
					? objects.stand(kind, u, 0, line + offset, yaw)
					: objects.stand(kind, line + offset, 0, u, yaw);
			for (let u = -S4_EXTENT + dashSpacing / 2; u < S4_EXTENT; u += dashSpacing)
				if (!inCrossing(u, 1.5)) mark(townKind('dash'), u, 0);
			for (let k = 0, u = -S4_EXTENT + 10; u < S4_EXTENT; k++, u += manholeSpacing)
				if (!inCrossing(u, 1)) mark(townKind('manhole'), u, k % 2 === 0 ? lane : -lane);
		}
	}
	for (let jz = 0; jz <= blocks; jz++)
		for (let jx = 0; jx <= blocks; jx++)
			objects.stand(townKind('crossing'), s4StreetCenter(jx), 0, s4StreetCenter(jz), 0);

	const vehicles = S4_VEHICLES.count;
	const data: S4Data = {
		count: objects.kind.length,
		kind: Uint8Array.from(objects.kind),
		position: Float32Array.from(objects.position),
		yaw: Float32Array.from(objects.yaw),
		size: Float32Array.from(objects.size),
		vehicles,
		vehicleKind: new Uint8Array(vehicles),
		vehicleAxis: new Uint8Array(vehicles),
		vehicleLane: new Float32Array(vehicles),
		vehicleDirection: new Int8Array(vehicles),
		vehicleSpeed: new Float32Array(vehicles),
		vehiclePhase: new Float32Array(vehicles),
		lights: Float32Array.from(lights),
	};
	for (let i = 0; i < vehicles; i++) {
		const axis = random() < 0.5 ? 0 : 1;
		const line = s4StreetCenter(pick(blocks + 1));
		const direction = random() < 0.5 ? -1 : 1;
		let weight = random();
		let kind = 0;
		while (kind < VEHICLE_WEIGHTS.length - 1 && weight >= (VEHICLE_WEIGHTS[kind] as number))
			weight -= VEHICLE_WEIGHTS[kind++] as number;
		data.vehicleKind[i] = S4_FIRST_VEHICLE_KIND + kind;
		data.vehicleAxis[i] = axis;
		data.vehicleLane[i] = line + direction * lane;
		data.vehicleDirection[i] = direction;
		data.vehicleSpeed[i] = between(S4_VEHICLES.minSpeed, S4_VEHICLES.maxSpeed, random());
		data.vehiclePhase[i] = random();
	}
	return data;
}

/**
 * Writes a turn about +Y by `yaw` as a quaternion in x, y, z, w order. A flat mesh first turns a
 * quarter about +X, from facing +Z to facing +Y.
 */
function s4Rotation(yaw: number, flat: boolean, outQuaternion: OutArray): void {
	const s = Math.sin(yaw / 2);
	const c = Math.cos(yaw / 2);
	const k = flat ? Math.SQRT1_2 : 1;
	outQuaternion[0] = flat ? -c * k : 0;
	outQuaternion[1] = s * k;
	outQuaternion[2] = flat ? s * k : 0;
	outQuaternion[3] = c * k;
}

/** Writes still object i's position, rotation and scale. */
export function s4ObjectAt(
	data: S4Data,
	i: number,
	outPosition: OutArray,
	outQuaternion: OutArray,
	outScale: OutArray,
): void {
	const spec: S4MeshSpec = S4_MESHES[s4KindOf(data.kind[i] as number).mesh];
	const { position, size } = data;
	outPosition[0] = position[i * 3] as number;
	outPosition[1] = position[i * 3 + 1] as number;
	outPosition[2] = position[i * 3 + 2] as number;
	s4Rotation(data.yaw[i] as number, spec.flat === true, outQuaternion);
	const [ux, uy, uz] = spec.unit;
	const [sx, sy, sz] = [
		size[i * 3] as number,
		size[i * 3 + 1] as number,
		size[i * 3 + 2] as number,
	];
	outScale[0] = sx / ux;
	outScale[1] = spec.flat ? sz / uy : sy / uy;
	outScale[2] = spec.flat ? 1 : sz / uz;
}

/** Writes the scale of vehicle i, which never changes: the vehicle's size, as its mesh is 1 m. */
export function s4VehicleScale(data: S4Data, i: number, outScale: OutArray): void {
	const size = s4KindOf(data.vehicleKind[i] as number).size ?? [1, 1, 1];
	outScale[0] = size[0];
	outScale[1] = size[1];
	outScale[2] = size[2];
}

/**
 * Writes vehicle i's position and rotation at time t. It drives along its lane, and when it leaves
 * the town at one edge it comes back in at the other.
 */
export function s4VehicleAt(
	data: S4Data,
	i: number,
	t: number,
	outPosition: OutArray,
	outQuaternion: OutArray,
): void {
	const length = 2 * S4_EXTENT;
	const direction = data.vehicleDirection[i] as number;
	const speed = data.vehicleSpeed[i] as number;
	const travelled = (data.vehiclePhase[i] as number) * length + direction * speed * t;
	const u = -S4_EXTENT + (((travelled % length) + length) % length);
	const lane = data.vehicleLane[i] as number;
	const alongX = data.vehicleAxis[i] === 0;
	outPosition[0] = alongX ? u : lane;
	outPosition[1] = (s4KindOf(data.vehicleKind[i] as number).size?.[1] ?? 1) / 2;
	outPosition[2] = alongX ? lane : u;
	// The box's length lies along its own +X. A quarter turn clockwise, seen from above, points it
	// along +Z.
	const forward = direction > 0 ? 0 : Math.PI;
	s4Rotation(alongX ? forward : forward - Math.PI / 2, false, outQuaternion);
}

/** Writes S4's camera at time t, on its path. */
export function s4Camera(t: number, outPosition: OutArray, outTarget: OutArray): void {
	const { radius, height, lookRadius, lookAhead, seconds } = S4_CAMERA_PATH;
	const angle = (TAU * t) / seconds;
	outPosition[0] = radius * Math.cos(angle);
	outPosition[1] = height;
	outPosition[2] = -radius * Math.sin(angle);
	outTarget[0] = lookRadius * Math.cos(angle + lookAhead);
	outTarget[1] = 0;
	outTarget[2] = -lookRadius * Math.sin(angle + lookAhead);
}

/**
 * Makes one of S4's textures: RGBA8 texels in rows from v = 0 up, gray values that multiply a
 * material's color. `grain` is noise, `bricks` rows of bricks in mortar, `windows` a wall with a
 * grid of dark windows, and `planks` boards side by side.
 */
export function s4Texture(name: S4TextureName): Uint8Array {
	const size = S4_TEXTURE_SIZE;
	const random = mulberry32(40 + S4_TEXTURES.indexOf(name));
	// A shade for each brick of the 8 rows of 4, and for each of the 8 boards.
	const bricks = Array.from({ length: 32 }, () => between(150, 215, random()));
	const boards = Array.from({ length: 8 }, () => between(165, 235, random()));
	const texels = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const noise = random();
			let value: number;
			if (name === 'grain') value = between(205, 255, noise);
			else if (name === 'bricks') {
				const row = y >> 3;
				const shifted = x + (row % 2) * 8;
				const mortar = y % 8 === 0 || shifted % 16 === 0;
				value = mortar ? 235 : (bricks[row * 4 + ((shifted >> 4) % 4)] as number) + 20 * noise;
			} else if (name === 'windows') {
				const window = x % 8 >= 2 && x % 8 < 7 && y % 8 >= 2 && y % 8 < 7;
				value = window ? 70 + 30 * noise : 225 + 30 * noise;
			} else value = (boards[x >> 3] as number) + 20 * noise - (x % 8 === 0 ? 60 : 0);
			const at = (y * size + x) * 4;
			const byte = Math.round(Math.min(255, value));
			texels[at] = byte;
			texels[at + 1] = byte;
			texels[at + 2] = byte;
			texels[at + 3] = 255;
		}
	}
	return texels;
}

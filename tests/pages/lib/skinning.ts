// The skinning measurement scene, which the skinning page draws on WebGL2 in two ways and the
// runner's skinning plan reads back. A crowd of generated characters stands on a ground plane under
// a directional light with 1 to 4 shadow cascades. Each character is a tube of rings, skinned to a
// chain of joints with four influences per vertex, and the page bends each chain in code every
// frame. The joint matrices reach the GPU in a float texture.
//
// The two ways to skin:
// - In the vertex shader of every pass: each shadow cascade and the main pass skin again.
// - Once per frame with transform feedback: one pass skins every character that some pass draws
//   into a buffer, and the shadow and main passes draw that buffer as plain vertices.
//
// This module holds the mesh, the animation, the camera, the cascades and the culling, and how a
// result reads. It uses no browser or Node API, so the unit tests and the runner import it too.

/** The scene, the frame and the measurement's settings. */
export const SKINNING = {
	/** The frame in pixels, [width, height], on every device, so the GPU work matches. */
	size: [1280, 720] as const,
	/** Each character: rings along its height, vertices around each ring, and joints in its chain. */
	rings: 64,
	segments: 40,
	joints: 32,
	/** A character's height and its widest radius, in meters. */
	height: 1.8,
	radius: 0.24,
	/** Meters between characters on the crowd's square grid. */
	spacing: 2,
	/** The radius of the sphere around a character at any pose, about its middle, in meters. */
	boundRadius: 1.6,
	/** How a chain bends: radians per joint, how fast in radians per second, and the lag per joint. */
	bend: 0.035,
	twist: 0.02,
	speed: 2.4,
	jointLag: 0.35,
	/** A low camera behind the crowd, so near and far cascades both hold characters. */
	eye: [0, 4, 30] as const,
	target: [0, 0.8, 0] as const,
	fovYDegrees: 50,
	near: 0.1,
	far: 150,
	/** The direction that the light shines in, before it is made unit length. */
	light: [-0.5, -1, -0.4] as const,
	/** How far along the camera's view shadows reach, in meters. */
	shadowDistance: 80,
	/** How far the split distances lean from an even spread toward a logarithmic one, 0 to 1. */
	splitLambda: 0.8,
	/** How far each cascade's box reaches toward the light past its slice, in meters. */
	lightMargin: 40,
	/** Texels on each side of each cascade's layer of the shadow map. */
	shadowMapSize: 2048,
	/** The pose that the image check draws, in seconds of animation. */
	checkTime: 1.25,
	/**
	 * The image check counts a pixel as different when a channel differs by more than this many
	 * levels, and fails when more than `imageShare` of the pixels differ.
	 */
	imageLevels: 2,
	imageShare: 0.001,
	/** Each timed batch draws frames back to back for about this long, then waits for the GPU. */
	batchMs: 100,
	maxBatchFrames: 30,
	/** Timed batches of each path, which take turns. */
	rounds: 12,
	/** The time that each path draws before the timed batches. */
	warmUpMs: 1500,
} as const;

/** The crowd sizes and cascade counts that the skinning plan measures. */
export const SKINNING_CHARACTERS = [50, 100, 200, 500] as const;
export const SKINNING_CASCADES = [1, 2, 3, 4] as const;
/** The most cascades a page draws. */
export const MAX_CASCADES = 4;

/** The two ways to skin, as the page and its results name them. */
export type SkinningPath = 'vertex-shader' | 'transform-feedback';
export const SKINNING_PATHS: readonly SkinningPath[] = ['vertex-shader', 'transform-feedback'];

/** Floats in one joint's matrix: three rows of four, one texel per row. */
export const JOINT_FLOATS = 12;

/** One character's mesh at rest, with four joint influences per vertex. */
export interface CharacterMesh {
	vertexCount: number;
	positions: Float32Array;
	normals: Float32Array;
	/** Four joint numbers per vertex. */
	joints: Uint8Array;
	/** Four weights per vertex, which add up to 1. */
	weights: Float32Array;
	indices: Uint16Array;
}

/** The height of joint `j` at rest. */
const jointHeight = (j: number) => (SKINNING.height * j) / (SKINNING.joints - 1);

/**
 * Builds a character: a closed ring of vertices at each of the rings, widest at the middle. Each
 * vertex takes four neighboring joints of the chain, weighted with a cubic B-spline of its height,
 * so every vertex reads four joint matrices, as a skinned glTF character does.
 */
export function characterMesh(): CharacterMesh {
	const { rings, segments, joints, height, radius } = SKINNING;
	const vertexCount = rings * segments;
	const positions = new Float32Array(vertexCount * 3);
	const normals = new Float32Array(vertexCount * 3);
	const jointIds = new Uint8Array(vertexCount * 4);
	const weights = new Float32Array(vertexCount * 4);
	for (let ring = 0; ring < rings; ring++) {
		const y = (height * ring) / (rings - 1);
		const r = radius * (0.6 + 0.4 * Math.sin((Math.PI * y) / height));
		const u = (y / height) * (joints - 1);
		const below = Math.min(Math.floor(u), joints - 2);
		const t = u - below;
		const basis = [
			(1 - t) ** 3 / 6,
			(3 * t ** 3 - 6 * t ** 2 + 4) / 6,
			(-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6,
			t ** 3 / 6,
		];
		for (let s = 0; s < segments; s++) {
			const v = ring * segments + s;
			const angle = (2 * Math.PI * s) / segments;
			const c = Math.cos(angle);
			const n = Math.sin(angle);
			positions.set([r * c, y, r * n], v * 3);
			normals.set([c, 0, n], v * 3);
			for (let k = 0; k < 4; k++) {
				jointIds[v * 4 + k] = Math.min(joints - 1, Math.max(0, below - 1 + k));
				weights[v * 4 + k] = basis[k] ?? 0;
			}
		}
	}
	const indices = new Uint16Array((rings - 1) * segments * 6);
	let i = 0;
	for (let ring = 0; ring < rings - 1; ring++) {
		for (let s = 0; s < segments; s++) {
			const a = ring * segments + s;
			const b = ring * segments + ((s + 1) % segments);
			const c = a + segments;
			const d = b + segments;
			indices.set([a, c, b, b, c, d], i);
			i += 6;
		}
	}
	return { vertexCount, positions, normals, joints: jointIds, weights, indices };
}

/** The scratch place of one character: [x, z, facing]. */
const place = new Float64Array(3);

/**
 * Where character `c` of a crowd of `count` stands on the square grid, [x, z], and which way it
 * faces, in radians. It returns the same scratch array each time, so it allocates nothing.
 */
export function placeOf(c: number, count: number): Float64Array {
	const side = Math.ceil(Math.sqrt(count));
	const middle = (side - 1) / 2;
	place[0] = ((c % side) - middle) * SKINNING.spacing;
	place[1] = (Math.floor(c / side) - middle) * SKINNING.spacing;
	place[2] = c * 0.7;
	return place;
}

/** The scratch matrix of the joint chain: three rows of [x, y, z, translation]. */
const chain = new Float64Array(12);

/**
 * Writes the skinning matrix of each joint of each of `count` characters into `out`, at `time`
 * seconds: rows of three by four, character after character, joint after joint. Each matrix takes
 * a vertex from its rest position to the world, so a shader blends four of them and needs nothing
 * else. It allocates nothing.
 */
export function poseCharacters(out: Float32Array, count: number, time: number): void {
	const { joints, bend, twist, speed, jointLag } = SKINNING;
	const segment = jointHeight(1);
	const g = chain;
	for (let c = 0; c < count; c++) {
		const at = placeOf(c, count);
		const x = at[0]!;
		const z = at[1]!;
		const facing = at[2]!;
		const phase = (c * 2.399963) % (2 * Math.PI);
		const cy = Math.cos(facing);
		const sy = Math.sin(facing);
		// The character's place in the world: a turn about the vertical axis and a move.
		g.fill(0);
		g[0] = cy;
		g[2] = sy;
		g[3] = x;
		g[5] = 1;
		g[8] = -sy;
		g[10] = cy;
		g[11] = z;
		for (let j = 0; j < joints; j++) {
			if (j > 0) {
				// Up the chain by one segment along the parent joint's own vertical axis.
				g[3]! += segment * g[1]!;
				g[7]! += segment * g[5]!;
				g[11]! += segment * g[9]!;
			}
			const a = bend * Math.sin(speed * time + phase + j * jointLag);
			const b = twist * Math.cos(0.7 * speed * time + 1.3 * phase + j * jointLag);
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			const cb = Math.cos(b);
			const sb = Math.sin(b);
			// The joint's bend: a turn about Z, then about X, on the right of the chain.
			for (let row = 0; row < 3; row++) {
				const r0 = g[row * 4]!;
				const r1 = g[row * 4 + 1]!;
				const r2 = g[row * 4 + 2]!;
				g[row * 4] = r0 * ca + r1 * sa;
				g[row * 4 + 1] = -r0 * sa * cb + r1 * ca * cb + r2 * sb;
				g[row * 4 + 2] = r0 * sa * sb - r1 * ca * sb + r2 * cb;
			}
			// The rest pose has the joint at its height with no turn, so its inverse moves down.
			const rest = jointHeight(j);
			const base = (c * joints + j) * JOINT_FLOATS;
			for (let row = 0; row < 3; row++) {
				out[base + row * 4] = g[row * 4]!;
				out[base + row * 4 + 1] = g[row * 4 + 1]!;
				out[base + row * 4 + 2] = g[row * 4 + 2]!;
				out[base + row * 4 + 3] = g[row * 4 + 3]! - rest * g[row * 4 + 1]!;
			}
		}
	}
}

type Vec3 = [number, number, number];

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [
	a[0]! - b[0]!,
	a[1]! - b[1]!,
	a[2]! - b[2]!,
];
const dot = (a: readonly number[], b: readonly number[]) =>
	a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
	a[1]! * b[2]! - a[2]! * b[1]!,
	a[2]! * b[0]! - a[0]! * b[2]!,
	a[0]! * b[1]! - a[1]! * b[0]!,
];
const unit = (a: readonly number[]): Vec3 => {
	const length = Math.hypot(a[0]!, a[1]!, a[2]!);
	return [a[0]! / length, a[1]! / length, a[2]! / length];
};

/** The camera's axes: [right, up, forward], each of unit length. */
export function cameraAxes(): [Vec3, Vec3, Vec3] {
	const forward = unit(sub(SKINNING.target, SKINNING.eye));
	const right = unit(cross(forward, [0, 1, 0]));
	return [right, cross(right, forward), forward];
}

/**
 * A matrix in WebGL's column order from its four rows, each [x, y, z, w], for a uniform.
 */
function columns(rows: readonly (readonly number[])[]): Float32Array {
	const m = new Float32Array(16);
	for (let row = 0; row < 4; row++)
		for (let col = 0; col < 4; col++) m[col * 4 + row] = rows[row]![col]!;
	return m;
}

/** A plane [x, y, z, w] of unit normal: a point p is on its inner side where x·p + w ≥ 0. */
type Plane = [number, number, number, number];

/** The six planes of a frustum or a box. */
export type Planes = readonly Plane[];

/** One view of the frame: the main camera or a cascade. */
export interface SkinningView {
	/** The matrix from the world into the view's clip space, in WebGL's column order. */
	viewProj: Float32Array;
	/** The planes that a character's sphere must reach to be drawn in the view. */
	planes: Planes;
}

/** The main camera's view, with the frustum's six planes, for a frame of `aspect`. */
export function cameraView(aspect: number): SkinningView & { eye: Vec3; forward: Vec3 } {
	const [right, up, forward] = cameraAxes();
	const { eye, near, far } = SKINNING;
	const f = 1 / Math.tan((SKINNING.fovYDegrees * Math.PI) / 360);
	const view = [
		[...right, -dot(right, eye)],
		[...up, -dot(up, eye)],
		[-forward[0], -forward[1], -forward[2], dot(forward, eye)],
	];
	// WebGL's perspective projection: depth from -1 at the near plane to 1 at the far plane.
	const rows = [
		view[0]!.map((v) => (v * f) / aspect),
		view[1]!.map((v) => v * f),
		view[2]!.map(
			(v, i) => (v * (far + near)) / (near - far) + (i === 3 ? (2 * far * near) / (near - far) : 0),
		),
		view[2]!.map((v) => -v),
	];
	const plane = (sign: number, k: number) => {
		const p = rows[3]!.map((v, i) => v + sign * rows[k]![i]!);
		const length = Math.hypot(p[0]!, p[1]!, p[2]!);
		return p.map((v) => v / length) as Plane;
	};
	return {
		viewProj: columns(rows),
		planes: [plane(1, 0), plane(-1, 0), plane(1, 1), plane(-1, 1), plane(1, 2), plane(-1, 2)],
		eye: [...eye],
		forward,
	};
}

/** One cascade: a box along the light's axes around one slice of the camera's view. */
export interface Cascade extends SkinningView {
	/** The distance along the camera's view where the slice ends. */
	end: number;
	/** The width of one shadow map texel in the world, in meters. */
	texel: number;
}

/** The distances along the camera's view where each of `count` slices ends. */
export function splitDistances(count: number): number[] {
	const { near, shadowDistance: far, splitLambda: lambda } = SKINNING;
	return Array.from({ length: count }, (_, i) => {
		const share = (i + 1) / count;
		return lambda * near * (far / near) ** share + (1 - lambda) * (near + (far - near) * share);
	});
}

/** The four corners of the camera's view at distance `d` along it, for a frame of `aspect`. */
export function sliceCorners(d: number, aspect: number): Vec3[] {
	const [right, up, forward] = cameraAxes();
	const tan = Math.tan((SKINNING.fovYDegrees * Math.PI) / 360);
	return [-1, 1].flatMap((sx) =>
		[-1, 1].map(
			(sy) =>
				[0, 1, 2].map(
					(i) =>
						SKINNING.eye[i]! +
						forward[i]! * d +
						right[i]! * sx * d * tan * aspect +
						up[i]! * sy * d * tan,
				) as Vec3,
		),
	);
}

/**
 * The cascades for a frame of `aspect`. Each slice of the camera's view gets the smallest box
 * along the light's axes that holds its eight corners, as the engine fits its cascades. The box
 * reaches toward the light past the slice, so casters between the light and the slice cast into
 * it.
 */
export function fitCascades(count: number, aspect: number): Cascade[] {
	const light = unit(SKINNING.light);
	const right = unit(cross(light, [0, 1, 0]));
	const up = cross(right, light);
	const axes = [right, up, light];
	let start: number = SKINNING.near;
	return splitDistances(count).map((end) => {
		const corners = [...sliceCorners(start, aspect), ...sliceCorners(end, aspect)];
		start = end;
		const [low, high] = [Math.min, Math.max].map((pick) =>
			axes.map((axis) => pick(...corners.map((corner) => dot(axis, corner)))),
		) as [Vec3, Vec3];
		low[2] -= SKINNING.lightMargin;
		// Each axis maps from its low end to its high end onto -1 to 1.
		const rows = axes.map((axis, i) => {
			const scale = 2 / (high[i]! - low[i]!);
			return [...axis.map((v) => v * scale), -scale * low[i]! - 1];
		});
		return {
			viewProj: columns([...rows, [0, 0, 0, 1]]),
			planes: axes.flatMap((axis, i): Plane[] => [
				[axis[0], axis[1], axis[2], -low[i]!],
				[-axis[0], -axis[1], -axis[2], high[i]!],
			]),
			end,
			texel: Math.max(high[0] - low[0], high[1] - low[1]) / SKINNING.shadowMapSize,
		};
	});
}

/** True when the sphere about (x, y, z) with the scene's bound radius reaches inside every plane. */
export function sphereInside(planes: Planes, x: number, y: number, z: number): boolean {
	for (let i = 0; i < planes.length; i++) {
		const p = planes[i]!;
		if (p[0] * x + p[1] * y + p[2] * z + p[3] < -SKINNING.boundRadius) return false;
	}
	return true;
}

/**
 * Writes the characters of a crowd of `count` that `view` draws into `out` from `at`, in order,
 * and returns how many. It allocates nothing.
 */
export function cullCharacters(
	view: SkinningView,
	count: number,
	out: Uint32Array,
	at: number,
): number {
	const y = SKINNING.height / 2;
	let drawn = 0;
	for (let c = 0; c < count; c++) {
		const place = placeOf(c, count);
		if (sphereInside(view.planes, place[0]!, y, place[1]!)) out[at + drawn++] = c;
	}
	return drawn;
}

/**
 * The ranges of indices that draw `count` characters, listed in `ids` from `start`, from a buffer
 * that holds each skinned character at the slot that `slotOf` gives. Characters in consecutive
 * slots share one range. It writes each range's index count into `counts` and its byte offset into
 * a buffer of 32-bit indices into `offsets`, as `multiDrawElementsWEBGL` takes them, and returns
 * how many ranges. It allocates nothing.
 */
export function indexRanges(
	ids: Uint32Array,
	start: number,
	count: number,
	slotOf: Int32Array,
	indexCount: number,
	counts: Int32Array,
	offsets: Int32Array,
): number {
	let ranges = 0;
	let next = -1;
	for (let i = start; i < start + count; i++) {
		const slot = slotOf[ids[i]!]!;
		if (slot === next) counts[ranges - 1]! += indexCount;
		else {
			counts[ranges] = indexCount;
			offsets[ranges] = slot * indexCount * 4;
			ranges++;
		}
		next = slot + 1;
	}
	return ranges;
}

/** The timings of one path, each a median over the timed batches. */
export interface PathTiming {
	/** Milliseconds per frame, from the start of a batch until the GPU finished its last frame. */
	frameMs: number;
	/** The quartiles of the batches' frame times, as a sign of their spread. */
	frameMsQuartiles: [number, number];
	/** Milliseconds of JavaScript per frame: the culling, the uploads and the WebGL calls. */
	cpuMs: number;
	/** Milliseconds of GPU work per frame, where the browser has GPU timer queries. */
	gpuMs: number | null;
	/** Frames in each timed batch, and the timed batches. */
	batchFrames: number;
	batches: number;
	/** Vertices skinned per frame, over every pass. */
	skinnedVertices: number;
}

/** How the two paths' images of one pose compare. */
export interface ImageComparison {
	/** Pixels in which some channel differs by more than the scene's level threshold. */
	differing: number;
	pixels: number;
	/** The largest difference in any channel, in levels from 0 to 255. */
	largest: number;
}

/** What the skinning page reports. */
export interface SkinningResult {
	characters: number;
	cascades: number;
	/** The frame in pixels, and each character's vertices and joints. */
	size: readonly [number, number];
	vertices: number;
	joints: number;
	/** Whether the page drew with WEBGL_multi_draw, and timed with GPU timer queries. */
	multiDraw: boolean;
	gpuTimer: boolean;
	/** Characters drawn by the main pass, then by each cascade. */
	drawn: number[];
	/** Characters that the transform feedback pass skins: those that some pass draws. */
	skinned: number;
	image: ImageComparison;
	paths: Record<SkinningPath, PathTiming>;
}

/** The share of the vertex shader path's frame time that transform feedback saves; below 0 costs. */
export function frameSaving(result: Pick<SkinningResult, 'paths'>): number {
	const each = result.paths['vertex-shader'].frameMs;
	return (each - result.paths['transform-feedback'].frameMs) / each;
}

/** Compares two frames of RGBA bytes with the scene's level threshold. */
export function compareImages(a: Uint8Array, b: Uint8Array): ImageComparison {
	let differing = 0;
	let largest = 0;
	for (let i = 0; i < a.length; i += 4) {
		let most = 0;
		for (let k = 0; k < 4; k++) most = Math.max(most, Math.abs(a[i + k]! - b[i + k]!));
		if (most > SKINNING.imageLevels) differing++;
		largest = Math.max(largest, most);
	}
	return { differing, pixels: a.length / 4, largest };
}

/** What is wrong with a skinning page's result; empty when nothing is. */
export function skinningProblems(result: SkinningResult): string[] {
	const problems: string[] = [];
	const { differing, pixels, largest } = result.image;
	if (differing > pixels * SKINNING.imageShare)
		problems.push(
			`the two paths drew different images: ${differing} of ${pixels} pixels differ, by up to ${largest} levels`,
		);
	for (const path of SKINNING_PATHS) {
		const timing = result.paths[path];
		if (!(timing.frameMs > 0)) problems.push(`the ${path} path measured no frame time`);
	}
	return problems;
}

/** The median of some numbers, and the quartiles around it. */
export function quartiles(values: readonly number[]): [number, number, number] {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (share: number) => {
		const place = share * (sorted.length - 1);
		const low = Math.floor(place);
		const high = Math.min(sorted.length - 1, low + 1);
		return sorted[low]! + (sorted[high]! - sorted[low]!) * (place - low);
	};
	return sorted.length === 0 ? [0, 0, 0] : [at(0.25), at(0.5), at(0.75)];
}

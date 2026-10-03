// The skinning scene, defined once for null3D's image tests and for its three.js twin, which the
// parity test compares them with. It is plain data with no engine imports: three generated
// characters, each a tapered tube skinned to a chain of joints, stand side by side. One clip holds
// three poses, a key each second with step interpolation: straight, bent to one side, and bent
// forward with a twist. The characters play it at different speeds, so at the held time each
// shows another pose, whatever the frame steps' rounding.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const SKINNING_IMAGE = PARITY_CANVAS;
/** The sketch time of the held frame, in seconds. */
export const SKINNING_HOLD = 1.5;

/** A character: its joints, its height, and its rings and vertices around each ring. */
export const CHARACTER = {
	joints: 6,
	height: 2,
	radius: 0.28,
	rings: 31,
	around: 24,
} as const;

/** The camera: its vertical field of view in degrees, where it stands and the point it looks at. */
export const SKINNING_CAMERA = {
	fov: 40,
	position: [0, 1.6, 7] as Vec3,
	target: [0, 1.1, 0] as Vec3,
	near: 0.1,
	far: 50,
} as const;

/** The characters: where each stands, its sRGB color, and the speed at which it plays the clip. */
export const CHARACTERS: readonly { position: Vec3; color: string; speed: number }[] = [
	{ position: [-1.8, 0, 0], color: '#e8554e', speed: 0 },
	{ position: [0, 0, 0], color: '#f2c14e', speed: 1 },
	{ position: [1.8, 0, 0], color: '#4a8cff', speed: 1.5 },
];

/** The ground of the image test with shadows: a square this wide, and its sRGB color. */
export const GROUND = { size: 8, color: '#8a8f99' } as const;

/** The clip's name, and the time of each key in seconds. The last key repeats the third pose. */
export const CLIP = 'poses';
export const KEY_TIMES = [0, 1, 2, 3] as const;

/** The length of one segment of the chain: the distance between a joint and the next. */
const SEGMENT = CHARACTER.height / (CHARACTER.joints - 1);

/** The arrays of a character's mesh, as both engines read them. */
export interface CharacterMesh {
	positions: Float32Array;
	normals: Float32Array;
	/** Four joint numbers per vertex. */
	joints: Uint16Array;
	/** Four weights per vertex, which add up to 1. */
	weights: Float32Array;
	indices: Uint16Array;
}

/**
 * A character's mesh: a closed ring of vertices at each ring, widest in the middle. Each vertex
 * takes the two joints that it lies between, weighted by how near it lies to each, as skinned
 * glTF characters usually have it.
 */
export function characterMesh(): CharacterMesh {
	const { rings, around, height, radius, joints } = CHARACTER;
	const count = rings * around;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const jointIds = new Uint16Array(count * 4);
	const weights = new Float32Array(count * 4);
	for (let ring = 0; ring < rings; ring++) {
		const y = (height * ring) / (rings - 1);
		const r = radius * (0.55 + 0.45 * Math.sin((Math.PI * y) / height));
		const t = Math.min(y / SEGMENT, joints - 1);
		const below = Math.min(Math.floor(t), joints - 2);
		const share = t - below;
		for (let k = 0; k < around; k++) {
			const v = ring * around + k;
			const angle = (2 * Math.PI * k) / around;
			positions.set([r * Math.cos(angle), y, r * Math.sin(angle)], v * 3);
			normals.set([Math.cos(angle), 0, Math.sin(angle)], v * 3);
			jointIds.set([below, below + 1, 0, 0], v * 4);
			weights.set([1 - share, share, 0, 0], v * 4);
		}
	}
	const indices = new Uint16Array((rings - 1) * around * 6);
	let i = 0;
	for (let ring = 0; ring < rings - 1; ring++)
		for (let k = 0; k < around; k++) {
			const a = ring * around + k;
			const b = ring * around + ((k + 1) % around);
			indices.set([a, a + around, b, b, a + around, b + around], i);
			i += 6;
		}
	return { positions, normals, joints: jointIds, weights, indices };
}

/** One joint of the chain at rest: its parent, and its place relative to the parent. */
export interface ChainJoint {
	/** The parent's index, or -1 for the root. */
	parent: number;
	translation: Vec3;
	/** The inverse of the joint's matrix at rest, row-major 3 × 4. */
	inverseBind: readonly number[];
}

/** The chain: joints up the y axis, one segment apart, with no turn at rest. */
export const CHAIN: readonly ChainJoint[] = Array.from({ length: CHARACTER.joints }, (_, j) => ({
	parent: j - 1,
	translation: [0, j === 0 ? 0 : SEGMENT, 0] as Vec3,
	inverseBind: [1, 0, 0, 0, 0, 1, 0, -j * SEGMENT, 0, 0, 1, 0],
}));

/** A quaternion [x, y, z, w] for a turn of `angle` radians about the unit axis `axis`. */
function turn(axis: Vec3, angle: number): [number, number, number, number] {
	const s = Math.sin(angle / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** The product of two quaternions: `b` then `a`. */
function times(a: readonly number[], b: readonly number[]): [number, number, number, number] {
	const [ax, ay, az, aw] = a as [number, number, number, number];
	const [bx, by, bz, bw] = b as [number, number, number, number];
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

/**
 * The rotation keys of joint `j` of the clip, four numbers per key: straight, bent to the side
 * about z, bent forward about x with a twist about y, and the same again. The root stays upright.
 */
export function rotationKeys(j: number): number[] {
	if (j === 0) return KEY_TIMES.flatMap(() => [0, 0, 0, 1]);
	const side = turn([0, 0, 1], 0.28 + 0.04 * j);
	const forward = times(turn([1, 0, 0], 0.22), turn([0, 1, 0], 0.15));
	return [[0, 0, 0, 1], side, forward, forward].flat();
}

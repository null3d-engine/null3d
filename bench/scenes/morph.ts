// The morph target scene, defined once for null3D's image tests and for its three.js twin, which
// the parity test compares them with. It is plain data with no engine imports: three spheres
// stand side by side, each with the same three morph targets at its own weights. The first rests,
// the second blends two targets, and the third blends all three, one of them below 0. The first
// target lifts the top into a dome, the second widens the sphere and flattens it, and the third
// bulges its front out and turns the normals there forward, so both engines must morph normals too.
import { PARITY_CANVAS } from './spec';

export { AMBIENT, BACKGROUND, SUN } from './spec';

type Vec3 = readonly [number, number, number];

/** The image's size in pixels: the size of the benchmark scenes' parity images. */
export const MORPH_IMAGE = PARITY_CANVAS;

/** The sphere: its radius, and its segments around and from pole to pole. */
export const SPHERE = { radius: 0.8, around: 48, rings: 24 } as const;

/** The targets' names, as both engines name them. */
export const TARGET_NAMES = ['Lift', 'Widen', 'Bulge'] as const;

/** The camera: its vertical field of view in degrees, where it stands and the point it looks at. */
export const MORPH_CAMERA = {
	fov: 40,
	position: [0, 0.9, 6] as Vec3,
	target: [0, 0.2, 0] as Vec3,
	near: 0.1,
	far: 50,
} as const;

/**
 * The close-up: the third sphere, which blends all three targets, nearly filling the view, so a
 * step of the half floats that hold the deltas would show at its edges and in its shading.
 */
export const MORPH_CLOSEUP_CAMERA = {
	fov: 30,
	position: [2.6, 0.5, 2.8] as Vec3,
	target: [1.9, 0.15, 0.4] as Vec3,
	near: 0.1,
	far: 50,
} as const;

/** The spheres: where each stands, its sRGB color, and its weight for each target. */
export const SPHERES: readonly { position: Vec3; color: string; weights: readonly number[] }[] = [
	{ position: [-1.9, 0, 0], color: '#e8554e', weights: [0, 0, 0] },
	{ position: [0, 0, 0], color: '#f2c14e', weights: [1, 0.5, 0] },
	{ position: [1.9, 0, 0], color: '#4a8cff', weights: [0.6, -0.5, 1] },
];

/**
 * The weights that the third sphere draws with on WebGL2 when the quality setting keeps 2 of them:
 * its two weights farthest from 0. The cap's image test draws these weights on every sphere.
 */
export function cappedWeights(weights: readonly number[], keep: number): number[] {
	const order = weights
		.map((w, k) => [Math.abs(w), k] as const)
		.filter(([size]) => size > 0)
		.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	const kept = new Set(order.slice(0, keep).map(([, k]) => k));
	return weights.map((w, k) => (kept.has(k) ? w : 0));
}

/** The arrays of the sphere's mesh and its targets' deltas, as both engines read them. */
export interface MorphMesh {
	positions: Float32Array;
	normals: Float32Array;
	indices: Uint16Array;
	/** For each target, how far it moves each position. */
	positionDeltas: Float32Array[];
	/** For each target, how far it turns each normal. */
	normalDeltas: Float32Array[];
}

/** The sphere's mesh, from pole to pole, with a seam of doubled vertices, and its targets. */
export function morphMesh(): MorphMesh {
	const { radius, around, rings } = SPHERE;
	const count = (rings + 1) * (around + 1);
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const deltas = () => TARGET_NAMES.map(() => new Float32Array(count * 3));
	const positionDeltas = deltas();
	const normalDeltas = deltas();
	const [lift, widen, bulge] = positionDeltas as [Float32Array, Float32Array, Float32Array];
	const turn = normalDeltas[2] as Float32Array;
	for (let ring = 0; ring <= rings; ring++) {
		const polar = (Math.PI * ring) / rings;
		for (let k = 0; k <= around; k++) {
			const v = ring * (around + 1) + k;
			const azimuth = (2 * Math.PI * k) / around;
			const n = [
				Math.sin(polar) * Math.cos(azimuth),
				Math.cos(polar),
				Math.sin(polar) * Math.sin(azimuth),
			] as const;
			positions.set([radius * n[0], radius * n[1], radius * n[2]], v * 3);
			normals.set(n, v * 3);
			const up = Math.max(n[1], 0);
			lift.set([0, 0.6 * up * up, 0], v * 3);
			widen.set([0.35 * radius * n[0], -0.3 * radius * n[1], 0.35 * radius * n[2]], v * 3);
			const front = Math.max(n[2], 0) ** 2;
			bulge.set([0.4 * front * n[0], 0.4 * front * n[1], 0.4 * front * n[2]], v * 3);
			turn.set([0, 0, 0.5 * front], v * 3);
		}
	}
	const indices = new Uint16Array(rings * around * 6);
	let i = 0;
	for (let ring = 0; ring < rings; ring++)
		for (let k = 0; k < around; k++) {
			const a = ring * (around + 1) + k;
			const b = a + around + 1;
			indices.set([a, a + 1, b, a + 1, b + 1, b], i);
			i += 6;
		}
	return { positions, normals, indices, positionDeltas, normalDeltas };
}

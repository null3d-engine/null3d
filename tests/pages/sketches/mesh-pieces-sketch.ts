// A field of rough rocks drawn by many copies, whose triangle lists come in pieces (NULL3D_pieces)
// with ?pieces=1 and whole without it. Both sides draw the same triangles in the same order, so
// only the culling of each piece of each copy differs, and the frames must match pixel for pixel.
// With ?pieces=1 the rock comes from a file that stores its pieces, and with ?pieces=0 the same
// arrays are made in code with `levels: false`: a file's mesh that stores no pieces plans them at
// run time once its copies pay, so it would cull too. The rock is open at the top, so its inside
// shows. One batch draws it single-sided, whose back faces the cone test may drop, and one
// double-sided, whose pieces must keep their back faces. A mirrored copy and a stretched one skip
// the cone test. The rock has a coarser level of its own, with pieces too, so far copies cull that
// level's pieces. On the page's 'view' message, with a view's place in VIEWS, the camera moves
// there, and a few frames later the sketch posts 'turned'.
import { defineSketch } from '@null3d/engine';
import { planPieces } from '../../../packages/engine/levels/pieces.js';
import { GltfBuilder, type GltfJson } from '../lib/gltf-files';

const params = new URL(import.meta.url).searchParams;
const PIECES = params.get('pieces') === '1';
/** Frames after a move before 'turned': a pipelined engine draws a frame or two behind the sketch. */
const TURN_FRAMES = 3;
/** The fine rock's error, which switches its coarser level in about 12 m out at the picture's size. */
const LOD_ERROR = 0.04;

/** The camera's place and target in each view: inside the field, at its edge, and far above it. */
export const VIEWS: readonly { position: number[]; target: number[] }[] = [
	{ position: [0, 1.2, 0], target: [6, 0.6, 2] },
	{ position: [1.5, 0.8, -1], target: [-6, 0.4, -5] },
	{ position: [-9, 1.5, 9], target: [0, 0, 0] },
	{ position: [0, 30, 26], target: [0, 0, 0] },
];

/**
 * A rough rock around the origin, a sphere of `rings` by `around` cells whose radius rises and
 * falls with smooth waves, open at its top rings so that its inside shows. Positions, normals by
 * the cells' facings, and indices.
 */
function rock(around: number, rings: number) {
	const positions: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rings; r++)
		for (let a = 0; a <= around; a++) {
			const polar = (r / rings) * Math.PI;
			const turn = (a / around) * Math.PI * 2;
			const radius =
				1 +
				0.06 * Math.sin(5 * turn + 2 * polar) * Math.cos(3 * polar) +
				0.02 * Math.sin(13 * turn) * Math.sin(11 * polar);
			positions.push(
				radius * Math.sin(polar) * Math.cos(turn),
				radius * Math.cos(polar),
				radius * Math.sin(polar) * Math.sin(turn),
			);
		}
	const open = Math.floor(rings / 5);
	for (let r = open; r < rings; r++)
		for (let a = 0; a < around; a++) {
			const p = r * (around + 1) + a;
			const q = p + around + 1;
			indices.push(p, p + 1, q, p + 1, q + 1, q);
		}
	const normals = new Float32Array(positions.length);
	for (let t = 0; t < indices.length; t += 3) {
		const [i, j, k] = [indices[t] as number, indices[t + 1] as number, indices[t + 2] as number];
		const e1 = [0, 1, 2].map(
			(c) => (positions[j * 3 + c] as number) - (positions[i * 3 + c] as number),
		);
		const e2 = [0, 1, 2].map(
			(c) => (positions[k * 3 + c] as number) - (positions[i * 3 + c] as number),
		);
		const n = [
			(e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
			(e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
			(e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
		];
		for (const v of [i, j, k])
			for (let c = 0; c < 3; c++)
				normals[v * 3 + c] = (normals[v * 3 + c] as number) + (n[c] as number);
	}
	for (let v = 0; v < normals.length; v += 3) {
		const length =
			Math.hypot(normals[v] as number, normals[v + 1] as number, normals[v + 2] as number) || 1;
		for (let c = 0; c < 3; c++) normals[v + c] = (normals[v + c] as number) / length;
	}
	// The pieces' order, which both files keep, so the two draw the same triangles in one order.
	const plan = planPieces(
		positions,
		indices,
		Math.max(4, Math.min(24, Math.round(indices.length / 3 / 1024))),
	);
	if (!plan) throw new Error('the rock gets no pieces');
	const sorted = new Uint32Array(indices.length);
	plan.order.forEach((triangle, k) => {
		sorted.set(indices.slice(triangle * 3, triangle * 3 + 3), k * 3);
	});
	return { positions: new Float32Array(positions), normals, indices: sorted, plan };
}

/**
 * The file: a rock mesh for each material, each with its coarser level, which stores its pieces
 * with ?pieces=1. The whole side draws the same arrays made in code with the file's material.
 */
function rockFile(): Uint8Array {
	const b = new GltfBuilder();
	if (PIECES) b.uses('NULL3D_pieces');
	b.uses('MSFT_lod');
	const primitive = (shape: ReturnType<typeof rock>, material: number): GltfJson => ({
		attributes: {
			POSITION: b.positions(shape.positions),
			NORMAL: b.accessor(shape.normals, 3),
		},
		indices: b.accessor(shape.indices, 1),
		material,
		...(PIECES && {
			extensions: {
				NULL3D_pieces: {
					triangles: Array.from(shape.plan.counts),
					bounds: Array.from(shape.plan.bounds),
					version: 1,
				},
			},
		}),
	});
	const fine = rock(128, 64);
	const coarse = rock(40, 20);
	const sides = [
		{ name: 'single', doubleSided: false, color: [0.62, 0.55, 0.45, 1] },
		{ name: 'double', doubleSided: true, color: [0.4, 0.5, 0.62, 1] },
	];
	for (const side of sides) {
		const material = b.material({
			name: side.name,
			doubleSided: side.doubleSided,
			pbrMetallicRoughness: {
				baseColorFactor: side.color,
				roughnessFactor: 0.8,
				metallicFactor: 0,
			},
		});
		const level = b.node(
			{ name: `${side.name}-lod1`, mesh: b.mesh([primitive(coarse, material)]) },
			true,
		);
		b.node({
			name: side.name,
			mesh: b.mesh([primitive(fine, material)]),
			extensions: { MSFT_lod: { ids: [level] } },
			extras: { NULL3D_lod_error: [LOD_ERROR] },
		});
	}
	return b.glb();
}

/** A small hash of whole numbers, so the copies' places are the same on every machine. */
function hash(n: number): number {
	let x = (n * 0x9e3779b1) >>> 0;
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b) >>> 0;
	x ^= x >>> 13;
	return (x >>> 0) / 0xffffffff;
}

export default defineSketch(async ({ scene, geometry, assets, quality, page }) => {
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground([0.55, 0.62, 0.7]);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.05, far: 200 });
	scene.setActiveCamera(camera);
	const place = (view: number) => {
		const { position, target } = VIEWS[view] ?? (VIEWS[0] as (typeof VIEWS)[number]);
		camera.setPosition(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
		camera.lookAt(target[0] ?? 0, target[1] ?? 0, target[2] ?? 0);
	};
	place(0);
	const url = URL.createObjectURL(
		new Blob([rockFile() as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
	);
	const file = await assets.loadGltf(url);
	/**
	 * The whole side: the file's arrays made in code with `levels: false`, which plans no pieces,
	 * and the same coarser level, set by hand at the file's error. Both sides draw it.
	 */
	const wholeRock = () => {
		const arrays = (around: number, rings: number) => {
			const { positions, normals, indices } = rock(around, rings);
			return { positions, normals, indices: Array.from(indices) };
		};
		const fine = geometry.fromArrays({ ...arrays(128, 64), levels: false });
		const coarse = geometry.fromArrays({ ...arrays(40, 20), levels: false });
		fine.setLevels([{ mesh: coarse, error: LOD_ERROR }]);
		return fine;
	};
	const whole = PIECES ? undefined : wholeRock();
	for (const [side, count] of [
		['single', 60],
		['double', 24],
	] as const) {
		const node = file.find(side);
		if (!node?.material) throw new Error(`no ${side} rock`);
		const mesh = PIECES ? node.mesh : whole;
		if (!mesh) throw new Error(`no ${side} rock`);
		const batch = scene.createInstances(mesh, count, { material: node.material });
		for (let k = 0; k < count; k++) {
			const seed = (side === 'single' ? 0 : 1000) + k * 7;
			const angle = hash(seed) * Math.PI * 2;
			const distance = 2 + hash(seed + 1) * 22;
			batch.positions.set(
				[Math.cos(angle) * distance, hash(seed + 2) * 0.8, Math.sin(angle) * distance],
				k * 3,
			);
			// A turn about a random axis.
			const [ax, ay, az] = [hash(seed + 3) - 0.5, hash(seed + 4) - 0.5, hash(seed + 5) - 0.5];
			const length = Math.hypot(ax, ay, az) || 1;
			const half = hash(seed + 6) * Math.PI;
			const s = Math.sin(half) / length;
			batch.rotations.set([ax * s, ay * s, az * s, Math.cos(half)], k * 4);
			const size = 0.5 + hash(seed + 5) * 1.5;
			// One copy mirrored and one stretched, whose pieces skip the cone test.
			const scale =
				k === 1
					? [-size, size, size]
					: k === 2
						? [size * 1.7, size * 0.6, size]
						: [size, size, size];
			batch.scales.set(scale, k * 3);
		}
	}
	let framesToTurned = 0;
	page.onMessage((message, data) => {
		if (message !== 'view' || typeof data !== 'number') return;
		place(data);
		framesToTurned = TURN_FRAMES;
	});
	return {
		onUpdate() {
			if (framesToTurned === 0) return;
			framesToTurned -= 1;
			if (framesToTurned === 0) page.post('turned', true);
		},
	};
});

// A village of one house, as a building kit makes one: a box of separate quads with a round
// chimney pot, whose far level is set by hand, drawn by many copies. With ?pieces=1 the house takes
// facing pieces once its copies draw; with ?pieces=0 its copies draw it whole. Both draw the same
// triangles in the same order, so the frames must match pixel for pixel. One copy is mirrored and
// one stretched, which skip the cone test.
//
// Made in code, the pieced house takes the engine's default and plans its pieces on the job
// workers, and the whole one says `levels: false`. With ?file=1 the pieced house comes from a file
// that places it once and holds its facing pieces, as the asset tool writes them, and the scene
// copies it in code; the whole house is made in code from the same arrays, with `levels: false`,
// and draws with the file's material. ?copies= sets the copies: too few to pay for the pieces, the
// file's house draws whole, with the draws of the whole one.
//
// On the page's 'view' message, with a view's place in HOUSE_VIEWS, the camera moves there, and a
// few frames later the sketch posts 'turned'.
import { defineSketch } from '@null3d/engine';
import { facingPieces } from '../../../packages/engine/levels/pieces.js';
import { quadBox } from '../../lib/level-meshes';
import { GltfBuilder } from '../lib/gltf-files';

const params = new URL(import.meta.url).searchParams;
const PIECES = params.get('pieces') === '1';
const FILE = params.get('file') === '1';
/** Frames after a move before 'turned': a pipelined engine draws a frame or two behind the sketch. */
const TURN_FRAMES = 3;
/** Copies of the house: by default their triangles together pass the floor of facing pieces. */
const COPIES = Number(params.get('copies') ?? 64);
/** The far house's error: it covers a pixel only kilometers out, far past the views. */
const FAR_ERROR = 50;

/** The camera's place and target in each view: in a street, at the village's edge, and above it. */
export const HOUSE_VIEWS: readonly { position: number[]; target: number[] }[] = [
	{ position: [2, 2, -6], target: [30, 4, 40] },
	{ position: [-20, 8, -20], target: [40, 0, 40] },
	{ position: [60, 3, 10], target: [0, 5, 60] },
	{ position: [30, 90, -40], target: [30, 0, 40] },
];

/** The house: a box of separate quads, 10 by 10 on each side, and a pot of quads on its roof. */
function house() {
	const box = quadBox(10, 8, 6, 8);
	const positions = Array.from(box.positions);
	const normals = Array.from(box.normals);
	const indices = Array.from(box.indices);
	const around = 24;
	const ring = (k: number, t: number) => {
		const radius = 0.4 + 0.15 * Math.sin((k / 4) * Math.PI);
		const turn = (t / around) * Math.PI * 2;
		return [2 + radius * Math.cos(turn), 3 + k * 0.25, 2 - radius * Math.sin(turn)];
	};
	for (let r = 0; r < 4; r++)
		for (let a = 0; a < around; a++) {
			const first = positions.length / 3;
			const corners = [ring(r, a), ring(r, a + 1), ring(r + 1, a + 1), ring(r + 1, a)];
			for (const c of corners) positions.push(...(c as [number, number, number]));
			const turn = ((a + 0.5) / around) * Math.PI * 2;
			for (let c = 0; c < 4; c++) normals.push(Math.cos(turn), 0, -Math.sin(turn));
			indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
		}
	return { positions, normals, indices };
}

/**
 * The house in its facing pieces' order, as the asset tool stores it, and the pieces, which a
 * file holds for it.
 */
function sortedHouse() {
	const shape = house();
	const plan = facingPieces(shape.positions, shape.indices);
	if (!plan) throw new Error('the house gets no facing pieces');
	const indices = new Uint32Array(shape.indices.length);
	plan.order.forEach((triangle, k) => {
		indices.set(shape.indices.slice(triangle * 3, triangle * 3 + 3), k * 3);
	});
	return {
		positions: new Float32Array(shape.positions),
		normals: new Float32Array(shape.normals),
		indices,
		plan,
	};
}

/** A file that places the sorted house once, with its far level, and its pieces with ?pieces=1. */
function houseFile(shape: ReturnType<typeof sortedHouse>): Uint8Array {
	const b = new GltfBuilder();
	if (PIECES) b.uses('NULL3D_pieces');
	b.uses('MSFT_lod');
	const material = b.material({
		name: 'plaster',
		pbrMetallicRoughness: {
			baseColorFactor: [0.69, 0.58, 0.4, 1],
			roughnessFactor: 0.8,
			metallicFactor: 0,
		},
	});
	const far = quadBox(1, 8, 6, 8);
	const level = b.node(
		{
			name: 'house-far',
			mesh: b.mesh([
				{
					attributes: { POSITION: b.positions(far.positions), NORMAL: b.accessor(far.normals, 3) },
					indices: b.accessor(far.indices, 1),
					material,
				},
			]),
		},
		true,
	);
	b.node({
		name: 'house',
		mesh: b.mesh([
			{
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
			},
		]),
		extensions: { MSFT_lod: { ids: [level] } },
		extras: { NULL3D_lod_error: [FAR_ERROR] },
	});
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

export default defineSketch(async ({ scene, geometry, materials, assets, quality, page }) => {
	quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
	scene.setBackground([0.55, 0.62, 0.7]);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 400 });
	scene.setActiveCamera(camera);
	const place = (view: number) => {
		const { position, target } =
			HOUSE_VIEWS[view] ?? (HOUSE_VIEWS[0] as (typeof HOUSE_VIEWS)[number]);
		camera.setPosition(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
		camera.lookAt(target[0] ?? 0, target[1] ?? 0, target[2] ?? 0);
	};
	place(0);
	/** The house made in code, with its far level set by hand. */
	const madeInCode = (arrays: ReturnType<typeof house>, levels: boolean) => {
		const made = geometry.fromArrays({ ...arrays, ...(levels ? {} : { levels: false }) });
		const far = quadBox(1, 8, 6, 8);
		made.setLevels([{ mesh: geometry.fromArrays({ ...far, levels: false }), error: FAR_ERROR }]);
		return made;
	};
	/**
	 * The file's house and material: with ?pieces=1 the file's own mesh, copied in code, and with
	 * ?pieces=0 the same arrays made in code, which draw whole.
	 */
	const fromFile = async () => {
		const shape = sortedHouse();
		const url = URL.createObjectURL(
			new Blob([houseFile(shape) as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
		);
		const node = (await assets.loadGltf(url)).find('house');
		if (!node?.mesh || !node.material) throw new Error('no house in the file');
		const arrays = {
			positions: Array.from(shape.positions),
			normals: Array.from(shape.normals),
			indices: Array.from(shape.indices),
		};
		return { mesh: PIECES ? node.mesh : madeInCode(arrays, false), material: node.material };
	};
	const { mesh, material } = FILE
		? await fromFile()
		: {
				mesh: madeInCode(house(), PIECES),
				material: materials.standard({ color: '#d8c8a8', roughness: 0.8 }),
			};
	const batch = scene.createInstances(mesh, COPIES, { material, colors: true });
	const colors = batch.colors as Float32Array;
	for (let k = 0; k < COPIES; k++) {
		const [x, z] = [(k % 8) * 14 + hash(k) * 3, Math.floor(k / 8) * 14 + hash(k + 99) * 3];
		batch.positions.set([x, 3, z], k * 3);
		const half = (Math.floor(hash(k + 7) * 4) * Math.PI) / 4;
		batch.rotations.set([0, Math.sin(half), 0, Math.cos(half)], k * 4);
		// One copy mirrored and one stretched, whose pieces skip the cone test.
		batch.scales.set(k === 9 ? [-1, 1, 1] : k === 10 ? [1.6, 0.7, 1] : [1, 1, 1], k * 3);
		colors.set(
			[0.7 + 0.3 * hash(k + 3), 0.7 + 0.3 * hash(k + 4), 0.7 + 0.3 * hash(k + 5), 1],
			k * 4,
		);
	}
	batch.markDirty();
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

// A village of one house made in code, as a building kit makes one: a box of separate quads with
// a round chimney pot, whose far level is set by hand, drawn by many copies. With ?pieces=1 the
// mesh takes the engine's default and plans facing pieces once its copies draw; with ?pieces=0 it
// says `levels: false`, so its copies draw it whole. Both draw the same triangles, so the frames
// must match pixel for pixel. One copy is mirrored and one stretched, which skip the cone test. On
// the page's 'view' message, with a view's place in HOUSE_VIEWS, the camera moves there, and a few
// frames later the sketch posts 'turned'.
import { defineSketch } from '@null3d/engine';
import { quadBox } from '../../lib/level-meshes';

const params = new URL(import.meta.url).searchParams;
const PIECES = params.get('pieces') === '1';
/** Frames after a move before 'turned': a pipelined engine draws a frame or two behind the sketch. */
const TURN_FRAMES = 3;
/** Copies of the house: their triangles together pass the floor of facing pieces. */
const COPIES = 64;

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

/** A small hash of whole numbers, so the copies' places are the same on every machine. */
function hash(n: number): number {
	let x = (n * 0x9e3779b1) >>> 0;
	x ^= x >>> 15;
	x = Math.imul(x, 0x85ebca6b) >>> 0;
	x ^= x >>> 13;
	return (x >>> 0) / 0xffffffff;
}

export default defineSketch(({ scene, geometry, materials, quality, page }) => {
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
	const mesh = geometry.fromArrays({ ...house(), ...(PIECES ? {} : { levels: false }) });
	// The far house, a plain box, switches in only far past the views: its error covers a pixel only
	// kilometers out.
	const far = quadBox(1, 8, 6, 8);
	mesh.setLevels([{ mesh: geometry.fromArrays({ ...far, levels: false }), error: 50 }]);
	const material = materials.standard({ color: '#d8c8a8', roughness: 0.8 });
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

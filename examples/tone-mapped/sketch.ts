// Two rows of the same bright colors on a display in a dark gallery. The top row sets
// toneMapped: false, so the engine keeps each color exactly as the display shows it. The bottom row
// takes AgX's punchy curve, which darkens and desaturates each color. The demo starts on the 8-bit
// path, where each material's shader applies the output transform, so the rows differ.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';

const COLORS = ['#ff5a3c', '#ffb347', '#ffe14a', '#7dff5a', '#4ae1ff', '#4a8cff', '#d05aff'];
/** A tile's side in meters, and the gap between two of them. */
const TILE = 0.52;
const GAP = 0.14;
const WIDTH = COLORS.length * TILE + (COLORS.length - 1) * GAP;
/** The rows' centers: the top row keeps its display color, and the bottom takes the curve. */
const ROW_Y = [1.78, 0.98];

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post } = ctx;
	scene.setBackground('#0a0b10');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.4 });
	post.set({ toneMapping: 'agx-punchy', vignette: { intensity: 0.4 } });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.1,
		far: 100,
		position: [0, 1.5, 6.8],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 1.35, 0], maxPolarAngle: Math.PI * 0.55 });

	// The floor and the display's frame, in the low light of the room.
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 30 }),
		material: materials.standard({ color: '#22252c', roughness: 0.22, metalness: 0.2 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.box({
			width: WIDTH + 0.6,
			height: ROW_Y[0] - ROW_Y[1] + TILE + 0.8,
			depth: 0.2,
		}),
		material: materials.standard({ color: '#15171d', roughness: 0.3, metalness: 0.3 }),
		position: [0, (ROW_Y[0] + ROW_Y[1]) / 2 - 0.02, -0.1],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.box({ width: WIDTH + 0.8, height: 0.3, depth: 0.5 }),
		material: materials.standard({ color: '#101116', roughness: 0.45 }),
		position: [0, 0.15, -0.1],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createSpotLight({
		position: [0, 5.4, 3.4],
		target: [0, 1.2, 0],
		color: '#ffe6cc',
		intensity: 900,
		range: 14,
		angle: 0.62,
		penumbra: 0.7,
		castShadows: true,
	});

	// The same seven colors twice: the top row keeps the display color, the bottom row is mapped.
	const tile = geometry.plane({ width: TILE, height: TILE });
	COLORS.forEach((color, column) => {
		const x = (column - (COLORS.length - 1) / 2) * (TILE + GAP);
		ROW_Y.forEach((y, row) => {
			scene.createMesh({
				mesh: tile,
				material: materials.unlit({ color, toneMapped: row !== 0 }),
				position: [x, y, 0.03],
			});
		});
	});

	return {
		onUpdate(dt) {
			view.update(dt);
		},
	};
});

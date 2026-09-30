// The masked materials' scene (bench/scenes/alpha-mask.ts), which the parity test also draws with
// three.js: cards cut by vertex alpha at three cutoffs, lit and unlit, and a batch of tilted cards,
// all drawn with MSAA.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	cardMesh,
	MASK_BOXES,
	MASK_CAMERA,
	MASK_CARDS,
	MASK_TILE,
	SUN,
	turnAboutX,
} from '../../../bench/scenes/alpha-mask';

export default defineSketch(({ scene, materials, geometry, post }) => {
	// The three.js twin draws with no tone mapping, three.js's default.
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	const { fov, near, far, position, target } = MASK_CAMERA;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, near, far, position, target }));

	for (const { size, position: center, color } of MASK_BOXES) {
		const [width, height, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color }),
			position: center,
		});
	}

	const card = geometry.fromArrays(cardMesh());
	for (const { lit, cutoff, position: center, rotation } of MASK_CARDS) {
		const options = { vertexColors: true, alphaMode: 'mask', alphaCutoff: cutoff } as const;
		const mesh = scene.createMesh({
			mesh: card,
			material: lit ? materials.standard(options) : materials.unlit(options),
			position: center,
		});
		mesh.setRotationEuler(rotation[0], rotation[1], rotation[2]);
	}

	const tiles = scene.createInstances(card, MASK_TILE.positions.length, {
		material: materials.standard({
			vertexColors: true,
			alphaMode: 'mask',
			alphaCutoff: MASK_TILE.cutoff,
		}),
	});
	const turn = turnAboutX(MASK_TILE.tilt);
	const { scale } = MASK_TILE;
	for (const [k, center] of MASK_TILE.positions.entries()) {
		tiles.positions.set(center, k * 3);
		tiles.rotations.set(turn, k * 4);
		tiles.scales.set([scale, scale, scale], k * 3);
	}
	tiles.markDirty();
	return {};
});

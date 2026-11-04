// The scene of the 3D label test: a red plate that turns with its object, which traces the red
// pixels, and a green plate that faces the camera. The sketch turns the camera about its view in
// every frame unless `?still` holds it, so each frame has a place of its own. It answers the page's
// 'places' message with the green plate's place in every frame, from `worldToScreen`, by the
// engine's frame numbers, which the label tables use.
import { defineSketch, quat } from '@null3d/engine';
import { CAMERA, FACE, PLATE } from './labels-3d-scene';

/** The camera's roll per frame, in radians: about 6 CSS pixels of the green plate's circle. */
const STEP = 0.1;

export default defineSketch(({ scene, geometry, materials, ui, page }) => {
	const still = new URL(import.meta.url).searchParams.has('still');
	const camera = scene.createPerspectiveCamera({
		...CAMERA,
		position: [0, 0, 0],
		target: [0, 0, -1],
	});
	scene.setActiveCamera(camera);
	scene.setBackground('#000000');
	const plate = scene.createMesh({
		mesh: geometry.box({ width: 0.6, height: 0.4, depth: 0.05 }),
		material: materials.unlit({ color: '#ff0000' }),
		position: PLATE.position,
		rotation: quat.fromEuler(quat.create(), ...PLATE.rotation),
	});
	ui.trackLabel(plate, 'plate', { transform: 'world', offset: PLATE.offset });
	const face = scene.createMesh({
		mesh: geometry.box({ width: 0.6, height: 0.4, depth: 0.05 }),
		material: materials.unlit({ color: '#00ff00' }),
		position: FACE.position,
	});
	ui.trackLabel(face, 'face', { transform: 'billboard', rotation: FACE.rotation });
	/** The engine's frame number, then the green plate's x and y in CSS pixels, for each frame. */
	const places: number[] = [];
	const out = [0, 0, 0];
	let turns = 0;
	page.onMessage((name) => {
		if (name === 'places') page.post('places', places);
	});
	return {
		onUpdate() {
			if (!still) camera.setRotationEuler(0, 0, ++turns * STEP);
		},
		onLateUpdate() {
			camera.worldToScreen(FACE.position, out);
			// The frame being recorded follows the one whose labels were placed last.
			const frame = (ui as unknown as { frame: number }).frame + 1;
			places.push(frame, out[0] as number, out[1] as number);
		},
	};
});

// Objects below a hidden ancestor, for the hidden subtree test. A rig of a static base, a moving
// arm, a still crate on the arm, a moving finger on the crate and a point light on the arm moves
// for several frames. ?mode=hide hides the rig's base meanwhile, so the engine stops updating the
// objects below it, and puts the camera below a hidden body that carries it. ?mode=reference keeps
// the rig shown and places the camera itself. Both modes then hold still and post 'still'. On the
// page's 'show', both move the arm and the finger once more, ?mode=hide shows the rig in the same
// frame, and both post 'after' a few frames later. The arm starts out of view, so a frame that
// culled it with an old bounding sphere would lack it.
import { defineSketch } from '@null3d/engine';

const hiding = new URL(import.meta.url).searchParams.get('mode') === 'hide';
/** Frames of movement before the scene holds still: more than the two that write hidden rows. */
const MOVES = 8;
/** Frames after the show before the 'after' message. */
const SETTLE = 6;

export default defineSketch(({ scene, geometry, materials, page, time }) => {
	scene.setBackground('#101418');
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 2 });
	scene.createAmbientLight({ intensity: 0.3 });
	const paint = materials.standard({ color: '#c8a060', roughness: 0.6 });
	const blue = materials.standard({ color: '#4a8cff', roughness: 0.4 });
	const box = geometry.box();
	scene.createMesh({ mesh: geometry.plane(), material: paint, scale: [20, 1, 20] });

	// The camera rides on a moving body: below it while hidden, or placed alone for reference.
	const body = scene.createMesh({ mesh: box, material: blue, position: [0, 3, 14], dynamic: true });
	const camera = scene.createPerspectiveCamera({
		parent: hiding ? body : null,
		position: hiding ? [0, 0.5, 0] : [0, 3.5, 14],
	});
	scene.setActiveCamera(camera);
	body.setVisible(false);

	const base = scene.createMesh({ mesh: box, material: paint, position: [0, 0.5, 0] });
	const arm = scene.createMesh({
		mesh: box,
		material: blue,
		parent: base,
		position: [-30, 1, 0],
		dynamic: true,
	});
	const crate = scene.createMesh({ mesh: box, material: paint, parent: arm, position: [0, 1, 0] });
	const finger = scene.createMesh({
		mesh: box,
		material: blue,
		parent: crate,
		position: [0.8, 0, 0],
		scale: [0.4, 0.4, 0.4],
		dynamic: true,
	});
	scene.createPointLight({
		parent: arm,
		position: [0, 2, 1],
		color: '#ff6040',
		intensity: 30,
		range: 10,
	});
	if (hiding) base.setVisible(false);

	/** Moves the rig and the camera to step `k`. */
	const pose = (k: number) => {
		arm.setPosition(-30 + k * 3.5, 1, 0);
		arm.setRotationEuler(0, k * 0.2, 0);
		finger.setPosition(0.8, 0.1 * k, 0);
		const z = 14 - k * 0.5;
		if (hiding) body.setPosition(0, 3, z);
		else camera.setPosition(0, 3.5, z);
	};

	let start = -1;
	let shown = -1;
	let asked = false;
	page.onMessage((message) => {
		if (message === 'show') asked = true;
	});
	return {
		onUpdate() {
			if (start < 0) start = time.frame;
			const step = time.frame - start;
			if (step <= MOVES) pose(step);
			if (step === MOVES) page.post('still');
			if (shown < 0 && asked) {
				shown = time.frame;
				arm.setPosition(-1, 1, 0);
				arm.setRotationEuler(0, 0.6, 0);
				finger.setPosition(0.8, 1.2, 0);
				if (hiding) base.setVisible(true);
			}
			if (shown >= 0 && time.frame - shown === SETTLE) page.post('after');
		},
	};
});

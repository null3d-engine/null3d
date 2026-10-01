// A scene for the camera controls: a checked floor with a marker on each side, so each camera pose
// draws a different image. ?map uses map controls in place of orbit controls. ?moved makes the
// controls test's drags through the controls' own calls, so the held frame shows the pose that
// the live test reaches with Playwright. The sketch answers the page's 'pose' message with the
// camera's position, the controls' target, the count of fingers it read last, and its frame. The
// scene keeps the whole canvas, so a slow GPU's frames during play do not lower the render scale of
// the image that the live test compares.
import { createMapControls, createOrbitControls } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';
import { CONTROLS_MOVES, CONTROLS_VIEW } from '../lib/controls-view';

const params = new URL(import.meta.url).searchParams;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, page, engine, input, time, quality } = ctx;
	quality.set({ minRenderScale: 1 });
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: CONTROLS_VIEW.fov,
		near: 0.1,
		far: 100,
		position: [...CONTROLS_VIEW.position],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1.5], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	const box = geometry.box();
	// A floor of 7 by 7 tiles in two colors, like a chess board.
	const dark = scene.createInstances(box, 25, {
		material: materials.standard({ color: '#3c5a46' }),
	});
	const pale = scene.createInstances(box, 24, {
		material: materials.standard({ color: '#9fb8a4' }),
	});
	const rows = [0, 0];
	for (let tile = 0; tile < 49; tile++) {
		const x = tile % 7;
		const z = Math.floor(tile / 7);
		const shade = (x + z) % 2;
		const row = (rows[shade] as number) * 3;
		rows[shade] = row / 3 + 1;
		const batch = shade === 0 ? dark : pale;
		batch.positions.set([x - 3, -0.05, z - 3], row);
		batch.scales.set([1, 0.1, 1], row);
	}
	dark.markDirty();
	pale.markDirty();
	const marker = (color: string, position: [number, number, number], height: number) =>
		scene.createMesh({
			mesh: box,
			material: materials.standard({ color }),
			position,
			scale: [0.5, height, 0.5],
		});
	marker('#e8554e', [0, 0.75, 0], 1.5);
	marker('#4a8cff', [2.5, 0.25, 0], 0.5);
	marker('#f2c14e', [0, 0.25, -2.5], 0.5);
	marker('#c77dff', [-2.5, 0.5, 1.5], 1);

	const create = params.has('map') ? createMapControls : createOrbitControls;
	const controls = create(ctx, camera, { target: [...CONTROLS_VIEW.target] });
	if (params.has('moved')) {
		const { turn, pan, wheel } = CONTROLS_MOVES;
		const { height } = engine.viewport;
		// A drag as long as the canvas is high turns the camera once around.
		controls.rotateLeft((2 * Math.PI * turn[0]) / height);
		controls.rotateUp((2 * Math.PI * turn[1]) / height);
		controls.update(0);
		controls.pan(pan[0], pan[1]);
		controls.update(0);
		// Each 100 pixels of wheel scroll up bring the camera closer by a factor of 0.95.
		controls.dollyIn(0.95 ** (-wheel * 0.01));
		controls.update(0);
	}

	const position = [0, 0, 0];
	page.onMessage((type) => {
		if (type !== 'pose') return;
		camera.getPosition(position);
		page.post('pose', {
			position,
			target: controls.target,
			fingers: input.touches.length,
			frame: time.frame,
		});
	});
	return {
		onUpdate(dt) {
			controls.update(dt);
		},
	};
});

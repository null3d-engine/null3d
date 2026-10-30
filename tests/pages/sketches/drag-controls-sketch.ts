// The sketch of the drag-controls test: one crate that a press drags over a plane facing the
// camera, or turns with the right button. The page asks it for the crate's pose and for where the
// crate shows on the canvas, so that a test takes hold of the crate itself rather than a guess at
// where it might be.
import { createDragControls } from '@null3d/controls';
import { defineSketch, quat, vec3 } from '@null3d/engine';

export default defineSketch((ctx) => {
	const { scene, geometry, materials, page, time } = ctx;
	scene.setBackground('#10141a');
	scene.createAmbientLight({ intensity: 0.8 });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 1.2 });
	const camera = scene.createPerspectiveCamera({ fov: 50, position: [0, 3.2, 6] });
	camera.lookAt(0, 0, 0);
	scene.setActiveCamera(camera);
	const crate = scene.createMesh({
		name: 'crate',
		mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
		material: materials.standard({ color: '#b08850' }),
		position: [0, 0, 0],
		dynamic: true,
	});
	const drag = createDragControls(ctx, camera, [crate]);

	/** Scratch arrays: made once, used in every answer. */
	const position = vec3.create();
	const rotation = quat.create();
	const point = vec3.create();
	const screen = vec3.create();

	const report = () => {
		crate.getPosition(position);
		crate.getRotation(rotation);
		vec3.copy(point, position);
		camera.worldToScreen(point, screen);
		page.post('pose', {
			position: [...position],
			rotation: [...rotation],
			screen: [screen[0] as number, screen[1] as number],
			dragging: drag.dragging !== null,
			hovered: drag.hovered !== null,
			action: drag.state,
			time: time.now,
		});
	};

	page.onMessage((type) => {
		if (type === 'pose') report();
	});

	return {
		onUpdate(dt) {
			drag.update(dt);
		},
	};
});

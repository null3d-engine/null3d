// Screens in the world, from the screens add-on: three wall panels that a sketch paints on
// OffscreenCanvas objects, and a console panel close to the camera. Each panel refreshes at its own
// rate, and only the rectangles that a reading changed upload: its number, its bar and its lights.
// The console's texels are large on screen, so its sub-pixels, scan band and dead texels show. A
// click turns a panel down or up. The room is a dark wall with a metal frame around each panel.
import { defineSketch } from '@null3d/engine';
import { createPanels } from './screens';

export default defineSketch(async (ctx) => {
	const { scene, assets, materials, geometry, time, post } = ctx;
	scene.setBackground('#05080d');
	// The built-in room lights the metal and shows in its frames, with the lamps as accents.
	scene.setEnvironment(await assets.builtinEnvironment('room'), {
		intensity: 0.5,
		rotation: [0, 2.2, 0],
	});
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		position: [0, 0.2, 7.5],
		target: [0, 0.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#2a4a66', intensity: 0.5 });
	const lamp = scene.createPointLight({
		color: '#7fd8ff',
		intensity: 14,
		range: 12,
		position: [0, 2.2, 3],
	});
	post.set({ bloom: { intensity: 0.6, threshold: 0.9 } });

	// The wall and the metal frames that hold the panels.
	const wall = materials.standard({ color: '#1a2230', roughness: 0.9, metalness: 0.1 });
	const frame = materials.standard({ color: '#39424f', roughness: 0.35, metalness: 0.9 });
	scene.createMesh({
		mesh: geometry.box(),
		material: wall,
		position: [0, 0.2, -1.2],
		scale: [9, 4.5, 0.3],
	});
	for (const x of [-2.8, 0, 2.8]) {
		scene.createMesh({
			mesh: geometry.plane({ width: 2.75, height: 2.75 }),
			material: frame,
			position: [x, 0.2, -0.98],
		});
	}

	const panels = createPanels(ctx);

	return {
		onUpdate() {
			panels.update(time.now);
			// The lamp breathes, which moves the glow across the metal.
			lamp.setIntensity(12 + 3 * Math.sin(time.now * 2));
		},
	};
});

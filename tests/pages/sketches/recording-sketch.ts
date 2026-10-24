// The sketch of the recording and replay test. It sends each frame's numbers to the page, which
// keeps them for the test to compare across a recording and its replay: the frame's number, sketch
// time, step, the key's state and a number from the seeded random. A replay that follows the page's
// own frame rate, or that seeds the random differently, writes a different line.
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, input, time, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	const box = scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#4a8cff' }),
		dynamic: true,
	});
	// A number from the thread's random generator, which a recording seeds.
	const first = math.random();
	return {
		onUpdate(dt) {
			page.post(
				'frame',
				`${time.frame}|${time.now.toFixed(6)}|${dt.toFixed(6)}|${input.isDown('KeyW') ? 1 : 0}|${first.toFixed(6)}`,
			);
			box.setRotationEuler(0, time.now + first, 0);
			box.setPosition(0, input.isDown('KeyW') ? 0.5 : 0, 0);
		},
	};
});

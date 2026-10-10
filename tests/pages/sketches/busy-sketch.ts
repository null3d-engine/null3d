// A scene with enough parallel work for the job workers: groups of many boxes that turn in every
// frame, so the engine updates the transforms of every box in every frame. ?boxes= sets the count.
import { defineSketch } from '@null3d/engine';

/** The boxes, from the sketch module's ?boxes= switch. */
const BOXES = Number(new URL(import.meta.url).searchParams.get('boxes') ?? '64000');
/** Boxes that each frame adds until the scene has them all. */
const BOXES_PER_FRAME = 16000;
/** Groups that the boxes share, each turning on its own. */
const GROUPS = 16;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 200,
		position: [0, 30, 60],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const box = geometry.box({ width: 0.2, height: 0.2, depth: 0.2 });
	const material = materials.unlit({ color: '#4a8cff' });
	const groups = Array.from({ length: GROUPS }, (_, g) =>
		scene.createGroup({
			position: [(g % 4) * 12 - 18, 0, Math.floor(g / 4) * 12 - 18],
			dynamic: true,
		}),
	);
	// The boxes come over several frames: one frame's changes have room for fewer.
	let made = 0;
	let angle = 0;
	return {
		onUpdate(dt) {
			for (const end = Math.min(BOXES, made + BOXES_PER_FRAME); made < end; made++)
				scene.createMesh({
					mesh: box,
					material,
					parent: groups[made % GROUPS],
					position: [Math.sin(made) * 5, Math.cos(made * 0.7) * 5, Math.sin(made * 1.3) * 5],
				});
			angle += dt;
			for (let g = 0; g < GROUPS; g++) {
				const half = (angle + g) / 2;
				groups[g]?.setRotation(0, Math.sin(half), 0, Math.cos(half));
			}
		},
	};
});

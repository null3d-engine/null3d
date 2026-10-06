// 100,000 sprites of one dynamic batch, which every frame moves: a field of small opaque squares
// seen from above at a slant, each with its own size, rotation and color. The sprites scene tests
// blending and sorting, where CI's software GPU draws a frame in seconds; a blended field of this
// size there takes a minute. A row of sprites sized in pixels stands just past the view's left and
// right edges, so only the halves that reach into the view show: culling must keep them, as their
// size in the world depends on their distance.
import { defineSketch } from '@null3d/engine';
import { mulberry32 } from '../../../bench/scenes/spec';

/** The field's sprites, and the half width of the square they cover, in meters. */
const COUNT = 100_000;
const HALF = 60;

export default defineSketch(async ({ scene, time }) => {
	scene.setBackground('#101418');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 45, 70], target: [0, 0, 5] }),
	);

	const field = await scene.createSprites({ count: COUNT, dynamic: true, alphaMode: 'opaque' });
	const random = mulberry32(7);
	const home = new Float32Array(COUNT * 2);
	const sizes = field.sizes;
	const rotations = field.rotations;
	const colors = field.colors;
	for (let k = 0; k < COUNT; k++) {
		home[k * 2] = (random() * 2 - 1) * HALF;
		home[k * 2 + 1] = (random() * 2 - 1) * HALF;
		const side = 0.25 + random() * 0.5;
		sizes[k * 2] = side;
		sizes[k * 2 + 1] = side * (0.5 + random());
		rotations[k] = random() * Math.PI;
		colors.set([0.2 + 0.8 * random(), 0.2 + 0.8 * random(), 0.2 + 0.8 * random(), 1], k * 4);
	}

	// Sprites 90 pixels wide, whose centers lie 4 m past the view's left and right edges, about 20
	// pixels: the camera looks down the unit vector `forward`, so a point's depth is its distance
	// along it, and the half width of the view at a depth follows the field of view and the image's
	// shape.
	const edges = await scene.createSprites({
		count: 8,
		alphaMode: 'opaque',
	});
	const forward = [-45 / Math.hypot(45, 65), -65 / Math.hypot(45, 65)];
	const halfWidth = (depth: number) => depth * Math.tan((25 * Math.PI) / 180) * (320 / 180);
	for (let k = 0; k < 8; k++) {
		const side = k < 4 ? -1 : 1;
		const z = -20 + (k % 4) * 10;
		const depth = (forward[0] ?? 0) * -45 + (forward[1] ?? 0) * (z - 70);
		edges.positions.set([side * (halfWidth(depth) + 4), 0, z], k * 3);
		edges.sizes.set([2, 1], k * 2);
		edges.colors.set(k < 4 ? [1, 0.4, 0.1, 1] : [0.1, 0.8, 1, 1], k * 4);
	}

	return {
		onUpdate() {
			const positions = field.positions;
			const t = time.now;
			for (let k = 0; k < COUNT; k++) {
				const x = home[k * 2] as number;
				const z = home[k * 2 + 1] as number;
				positions[k * 3] = x;
				positions[k * 3 + 1] = 0.5 + 0.5 * Math.sin(t * 2 + x * 0.3 + z * 0.2);
				positions[k * 3 + 2] = z;
			}
		},
	};
});

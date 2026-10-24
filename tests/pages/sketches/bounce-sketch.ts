// Screen-space bounce light: a neutral floor and a white column beside a red wall, under the sky
// and a sun. ?bounce turns the bounce on, at half the render size or at ?bouncescale=0.25, with
// ?steps= steps per ray. Without it, the floor takes only the lights' direct light and the
// environment, so it shows almost no red. ?wide gives the light a longer reach, ?scale= draws at
// that render scale, with a range that reaches down to 0.5. On the page's 'bounce' message it turns
// the bounce on, waits until its pipelines are built, and posts the frames and milliseconds that
// took as 'settled'. The 'bounce-off' message turns it off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const BOUNCE = params.has('bounce');
const WIDE = params.has('wide');
const SCALE = params.get('scale');
const STEPS = Number(params.get('steps') ?? 12);
const COUNT = Number(params.get('count') ?? 0);
const BOUNCE_SCALE = params.get('bouncescale') === '0.25' ? 0.25 : 0.5;

/** The bounce's settings, which the tests measure and the cost page turns on and off. */
const SETTINGS = WIDE
	? { intensity: 1, distance: 24, thickness: 1.5 }
	: { intensity: 1, distance: 12, thickness: 1 };

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	quality.set({ bounceScale: BOUNCE_SCALE, bounceSteps: STEPS });
	if (BOUNCE) post.set({ bounce: SETTINGS });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: Math.min(scale, 0.5), maxRenderScale: scale, governor: false });
	}
	scene.setBackground('#9fb4cc');
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [-2.6, 2.4, 5.2],
		target: [0.6, 0.8, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#dfe8f5', intensity: 0.6 });
	scene.createDirectionalLight({ direction: [-0.7, -1, -0.5], intensity: 2.4 });

	const neutral = materials.standard({ color: '#c8c8c4', roughness: 0.9 });
	const white = materials.standard({ color: '#e8e8e4', roughness: 0.8 });
	const red = materials.standard({ color: '#c01818', roughness: 0.85 });

	// The floor and the two walls that meet it, so the corner shows light that the walls share.
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 16, height: 16 }),
		material: neutral,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	scene.createMesh({
		mesh: geometry.box({ width: 0.3, height: 4, depth: 8 }),
		material: red,
		position: [2.2, 2, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 8, height: 4, depth: 0.3 }),
		material: white,
		position: [0, 2, -3.4],
	});
	// A column in front of the wall, whose side away from the wall stays neutral.
	scene.createMesh({
		mesh: geometry.box({ width: 0.7, height: 2.4, depth: 0.7 }),
		material: white,
		position: [0.6, 1.2, 0.2],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.55 }),
		material: white,
		position: [-1.4, 0.55, 0.6],
	});
	// ?count= fills the floor with boxes, for the cost page's busy scene.
	const side = Math.ceil(Math.sqrt(COUNT));
	for (let i = 0; i < COUNT; i++) {
		const x = ((i % side) / Math.max(1, side - 1) - 0.5) * 6;
		const z = (Math.floor(i / side) / Math.max(1, side - 1) - 0.5) * 5;
		scene.createMesh({
			mesh: geometry.box({ width: 0.22, height: 0.22, depth: 0.22 }),
			material: i % 3 === 0 ? red : neutral,
			position: [x, 0.11, z],
		});
	}

	page.onMessage((message) => {
		if (message === 'bounce-off') post.set({ bounce: false });
		if (message !== 'bounce') return;
		const frame = time.frame;
		const start = performance.now();
		post.set({ bounce: SETTINGS });
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
});

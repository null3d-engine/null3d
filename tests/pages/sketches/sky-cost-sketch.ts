// The physical sky's cost scene: a ground of boxes that recede toward the horizon under a low sun,
// with clouds, so the background covers the top of the view and the aerial perspective covers the
// boxes. It starts with three.js's analytic sky, or with only a color with ?base=none. On the
// page's 'sky' message it draws the physical sky with the same sun, waits until its pipelines are
// built, and posts the frames and milliseconds that took as 'settled'. The 'sky-off' message goes
// back to the first background. With ?moving, the sun moves in every frame, so the physical sky
// draws its sky view table in every frame, and the analytic sky's values change as often. ?scale=
// draws at that render scale; with ?fixed the range holds that scale alone, and the governor is
// off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const MOVING = params.has('moving');
const NONE = params.get('base') === 'none';
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch(({ scene, materials, geometry, quality, time, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		far: 20000,
		position: [0, 6, 20],
		target: [0, 8, -100],
	});
	scene.setActiveCamera(camera);
	const sun = [0.4, 0.15, -1];
	const analytic = { sky: { sunPosition: sun, cloudCoverage: 0.35, time: 0 } };
	const physical = { atmosphere: { sunPosition: sun, cloudCoverage: 0.35, aerialPerspective: 3 } };
	scene.createDirectionalLight({ direction: [-0.4, -0.15, 1], color: '#ffd2a8', intensity: 3 });
	scene.createAmbientLight({ color: '#9db4ff', intensity: 0.3 });
	scene.createMesh({
		mesh: geometry.plane({ width: 20000, height: 20000 }),
		material: materials.standard({ color: '#6f7a5a', roughness: 0.9 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const box = geometry.box();
	const stone = materials.standard({ color: '#c8c0b0', roughness: 0.8 });
	for (let k = 0; k < 200; k++) {
		const distance = 10 * 1.03 ** k;
		const size = 1 + distance * 0.02;
		const position = [Math.sin(k * 2.4) * distance * 0.6, size, -distance];
		scene.createMesh({ mesh: box, material: stone, position, scale: [size, size * 2, size] });
	}
	let drawn = false;
	const show = () => {
		if (drawn) scene.setBackground(physical);
		else if (NONE) scene.setBackground('#7f9fc8');
		else scene.setBackground(analytic);
	};
	show();
	page.onMessage((message) => {
		if (message === 'sky-off') {
			drawn = false;
			show();
		}
		if (message !== 'sky') return;
		const frame = time.frame;
		const start = performance.now();
		drawn = true;
		show();
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
	return {
		onUpdate() {
			if (!MOVING) return;
			// The sun sweeps from 4 to 20 degrees up and back every 8 seconds.
			sun[1] = 0.21 - 0.14 * Math.cos(time.now * 0.785);
			analytic.sky.time = time.now;
			show();
		},
	};
});

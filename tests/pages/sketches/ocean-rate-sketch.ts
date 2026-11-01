// The ocean's three states for a rate measurement: its transform and its surface drawn, its surface
// drawn with the transform off, and its transform run with no surface drawn. The page asks for a
// state and the sketch posts 'settled' once a frame drew it, so each state is timed after it draws.
// ?scale= draws at that render scale, and ?fixed holds it with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createOcean } from '@null3d/water';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
/** A reflection cadence for every preset, so a run can hold the reflection on each frame. */
const EVERY = params.get('every');

export default defineSketch((ctx) => {
	const { scene, page, quality, time } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#87a6c4');
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 2.5 });
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 4000,
		position: [0, 12, 48],
		target: [0, 1, 0],
	});
	scene.setActiveCamera(camera);
	const ocean = createOcean(
		ctx,
		EVERY === null
			? { camera }
			: {
					camera,
					reflectionEvery: {
						low: Number(EVERY),
						medium: Number(EVERY),
						high: Number(EVERY),
						ultra: Number(EVERY),
					},
				},
	);
	let settle: (() => void) | undefined;
	page.onMessage((type) => {
		if (type === 'on') {
			ocean.setTransformEnabled(true);
			ocean.setSurfaceDrawn(true);
		} else if (type === 'off') {
			ocean.setTransformEnabled(false);
			ocean.setSurfaceDrawn(true);
		} else if (type === 'sim') {
			ocean.setTransformEnabled(true);
			ocean.setSurfaceDrawn(false);
		} else {
			return;
		}
		settle = () => page.post('settled');
	});
	return {
		onUpdate() {
			const angle = time.now * 0.15;
			camera.setPosition(Math.cos(angle) * 48, 12, Math.sin(angle) * 48);
			camera.lookAt(0, 1, 0);
			ocean.update();
			if (settle) {
				const report = settle;
				settle = undefined;
				report();
			}
		},
	};
});

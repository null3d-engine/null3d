// The ocean's transform, for the effect cost page: an open sea whose bands a chain of compute
// passes transforms every frame, and whose surface reads them. The 'ocean' message turns the
// transform's passes on and posts 'settled' once a frame drew them; 'ocean-off' turns them off and
// leaves the surface reading the last heights, so the two sides differ by the transform alone.
// ?scale= draws at that render scale, and ?fixed holds it with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createOcean } from '@null3d/water';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
/**
 * ?reflection=off draws the reflection at the longest cadence, so its cost does not hide the
 * transform's. The reflection draws the whole scene again, and its cost varies with the camera.
 */
const REFLECTION = params.get('reflection');

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
	const ocean = createOcean(ctx, {
		camera,
		...(REFLECTION === 'off' && {
			reflectionEvery: { low: 16, medium: 16, high: 16, ultra: 16 },
		}),
	});
	let settle: (() => void) | undefined;
	page.onMessage((type) => {
		if (type === 'ocean') {
			ocean.setTransformEnabled(true);
			settle = () => page.post('settled');
		} else if (type === 'ocean-off') {
			ocean.setTransformEnabled(false);
			settle = () => page.post('settled');
		}
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

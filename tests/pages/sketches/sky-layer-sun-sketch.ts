// A sky whose sun disc stands at the middle of a narrow view, and a layer that covers nothing but
// takes a share of the sun. The page reports the brightness of the disc's middle and of the plain
// sky beside it, over three stretches: before any layer, with a layer that hides the whole sun, and
// after it is removed. Only the disc may change.
import { defineFeature, defineSketch } from '@null3d/engine';
import layer from './sky-layer-sun.wgsl';

const DESCRIPTION = defineFeature({
	name: 'test-sun-layer',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

/** The direction of the sun, which the camera looks along so that its disc fills the middle. */
const SUN: [number, number, number] = [0, 0.1, 1];

export default defineSketch(({ scene, post, page, quality }) => {
	quality.set({ minRenderScale: 1 });
	// The disc is about half a degree across, and the sky beside it far dimmer. A low exposure keeps
	// both inside the frame's range: the disc clips to white, and the sky around it lands in levels
	// that a capture can tell apart.
	post.set({ toneMapping: 'none', exposure: 0.01 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 20, position: [0, 0, 0], target: SUN }),
	);
	scene.setBackground({
		sky: {
			sunPosition: SUN,
			cloudCoverage: 0,
			mieCoefficient: 0.005,
		},
	});
	let installed = false;
	page.onMessage((name) => {
		if (name === 'hide' && !installed) {
			// The layer covers nothing, and hides the whole of the sun's disc.
			scene.setSkyLayer(DESCRIPTION, { wgsl: layer, sun: 1 });
			installed = true;
		} else if (name === 'show' && installed) {
			scene.clearSkyLayer();
			installed = false;
		}
	});
	return {};
});

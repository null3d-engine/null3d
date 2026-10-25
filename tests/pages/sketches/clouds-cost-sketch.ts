// The sky's volumetric cloud tier against the flat layer: the same sky, with `cloudSteps` above 0
// and at 0 in turns. ?steps= sets the tier's step count, 32 by default, and ?scale= draws at that
// render scale with the governor off, as the effect cost page asks. The scene is the whole view of
// the sky, so the cost follows the clouds' pixels.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const steps = Number(params.get('steps') ?? '32');
const scale = Number(params.get('scale') ?? '1');

/** A broken deck of cloud above the camera, with a low sun toward the view. */
const SKY = {
	sunPosition: [0.4, 0.18, -0.9] as [number, number, number],
	turbidity: 6,
	rayleigh: 2,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.75,
	cloudCoverage: 0.55,
	cloudDensity: 0.5,
	cloudElevation: 0.45,
	cloudScale: 0.0002,
	cloudSpeed: 0,
	time: 12,
};

export default defineSketch(({ scene, quality, page, time }) => {
	quality.set({
		cloudSteps: steps,
		minRenderScale: scale,
		maxRenderScale: scale,
		governor: false,
	});
	scene.setBackground({ sky: SKY });
	scene.createPerspectiveCamera({
		fov: 70,
		near: 0.1,
		far: 100,
		position: [0, 0, 0],
		target: [0, 0.3, -1],
	});
	// The change applies at the next frame that the core records, so the page waits for two frames
	// beyond it before the measurement starts, and for the pipelines of the first turn.
	let settleAt = -1;
	const turn = (on: boolean) => {
		quality.set({ cloudSteps: on ? steps : 0 });
		settleAt = time.frame + 2;
	};
	page.onMessage((message) => {
		if (message === 'clouds') turn(true);
		if (message === 'clouds-off') turn(false);
	});
	return {
		onUpdate() {
			if (settleAt < 0 || time.frame < settleAt) return;
			settleAt = -1;
			page.post('settled', {});
		},
	};
});

// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
// The `blend` switch makes the boxes see through, for the allocation sample of the transparent pass.
// The `animated` switch adds that many animated characters, for the allocation sample of the
// animator. The `grading` switch loads a color grading table and turns the vignette on, then
// changes the table's intensity and the vignette every frame, for the allocation sample of
// post.set and the final pass's grading.
import { defineSketch } from '@null3d/engine';
import { GRADING_LUTS } from '../../scenes/grading';
import { s1Camera } from '../../scenes/spec';
import { createAnimatedCrowd, readAnimated } from './crowd';
import { followPath, readCount, setUpView } from './sketch-common';
import { createSwarm } from './swarm';

export default defineSketch((context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1Camera);
	const blend = new URL(import.meta.url).searchParams.has('blend');
	const swarm = createSwarm(context, readCount(import.meta.url), true, undefined, blend);
	const animate = createAnimatedCrowd(context, readAnimated(import.meta.url));
	const grading = new URL(import.meta.url).searchParams.has('grading');
	// One settings object, changed in place, so the sketch's own code allocates nothing per frame.
	const vignette = { offset: 1, darkness: 1 };
	const settings = { lutIntensity: 1, vignette };
	if (grading)
		void context.assets.loadLut(GRADING_LUTS.warm).then((lut) => context.post.set({ lut }));
	const pose = (t: number) => {
		swarm.pose(t);
		moveCamera(t);
		animate(t);
		if (!grading) return;
		settings.lutIntensity = 0.5 + 0.5 * Math.sin(t);
		vignette.offset = 1 + 0.25 * Math.cos(t);
		context.post.set(settings);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
		},
	};
});

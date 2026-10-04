// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
// The `blend` switch makes the boxes see through, for the allocation sample of the transparent pass.
// The `animated` switch adds that many animated characters, for the allocation sample of the
// animator. The `grading` switch loads a color grading table and turns the vignette on, then
// changes the table's intensity and the vignette every frame, for the allocation sample of
// post.set and the final pass's grading. The `sprites` switch draws the swarm as blended sprites
// instead of boxes, for the allocation sample of sprite batches.
import { defineSketch } from '@null3d/engine';
import { GRADING_LUTS } from '../../scenes/grading';
import { s1Camera } from '../../scenes/spec';
import { createAnimatedCrowd, readAnimated } from './crowd';
import { followPath, readCount, setUpView } from './sketch-common';
import { createSpriteSwarm, createSwarm } from './swarm';

export default defineSketch(async (context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1Camera);
	const switches = new URL(import.meta.url).searchParams;
	const count = readCount(import.meta.url);
	const poseSwarm = switches.has('sprites')
		? await createSpriteSwarm(context, count)
		: createSwarm(context, count, true, undefined, switches.has('blend')).pose;
	const animate = createAnimatedCrowd(context, readAnimated(import.meta.url));
	const grading = switches.has('grading');
	// One settings object, changed in place, so the sketch's own code allocates nothing per frame.
	const vignette = { offset: 1, darkness: 1 };
	const settings = { lutIntensity: 1, vignette };
	if (grading)
		void context.assets.loadLut(GRADING_LUTS.warm).then((lut) => context.post.set({ lut }));
	const pose = (t: number) => {
		poseSwarm(t);
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

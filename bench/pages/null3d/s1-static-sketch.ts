// The null3d version of S1-static: S1's instances, set once at time 0 and never updated, while
// the camera flies through them. The page's `shadows=<n>` gives the sun shadows in that many
// cascades, and the `batchShadows` switch makes the instances cast and receive them.
import { defineSketch } from '@null3d/engine';
import { BACKGROUND, s1StaticCamera, VIEW_LIGHTS } from '../../scenes/spec';
import { followPath, readCount, readShadows, setUpView } from './sketch-common';
import { createSwarm } from './swarm';

export default defineSketch((context) => {
	const { time } = context;
	const cascades = readShadows(import.meta.url);
	const moveCamera = followPath(
		setUpView(context, VIEW_LIGHTS, BACKGROUND, { cascades }),
		s1StaticCamera,
	);
	const shadows = new URL(import.meta.url).searchParams.has('batchShadows');
	const swarm = createSwarm(context, readCount(import.meta.url), false, undefined, false, {
		shadows,
	});
	swarm.pose(0);
	swarm.batch.markDirty();
	moveCamera(time.now);
	return {
		onUpdate() {
			moveCamera(time.now);
		},
	};
});

// The null3d version of S1-static: S1's instances, set once at time 0 and never updated, while
// the camera flies through them.
import { defineSketch } from '@null3d/engine';
import { s1StaticCamera } from '../../scenes/spec';
import { followPath, readCount, setUpView } from './sketch-common';
import { createSwarm } from './swarm';

export default defineSketch((context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1StaticCamera);
	const swarm = createSwarm(context, readCount(import.meta.url), false);
	swarm.pose(0);
	swarm.batch.markDirty();
	moveCamera(time.now);
	return {
		onUpdate() {
			moveCamera(time.now);
		},
	};
});

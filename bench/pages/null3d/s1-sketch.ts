// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
import { defineSketch } from '@null3d/engine';
import { s1Camera } from '../../scenes/spec';
import { followPath, readCount, setUpView } from './sketch-common';
import { createSwarm } from './swarm';

export default defineSketch((context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1Camera);
	const swarm = createSwarm(context, readCount(import.meta.url), true);
	const pose = (t: number) => {
		swarm.pose(t);
		moveCamera(t);
	};
	pose(time.now);
	return {
		onUpdate() {
			pose(time.now);
		},
	};
});

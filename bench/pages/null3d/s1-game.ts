// The null3d version of S1, the swarm: every instance moves every frame, and the camera orbits.
import { defineGame } from '@null3d/engine';
import { s1Camera } from '../../scenes/spec';
import { followPath, readGameOptions, sceneTime, setUpView } from './game-common';
import { createSwarm } from './swarm';

export default defineGame((context) => {
	const options = readGameOptions(import.meta.url);
	const moveCamera = followPath(setUpView(context), s1Camera);
	const swarm = createSwarm(context, options.count, true);
	const pose = (t: number) => {
		swarm.pose(t);
		moveCamera(t);
	};
	pose(sceneTime(options, context));
	return {
		onUpdate() {
			pose(sceneTime(options, context));
		},
	};
});

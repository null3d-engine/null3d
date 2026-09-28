// The null3d version of S1-static: S1's instances, set once at time 0 and never updated, while
// the camera flies through them.
import { defineGame } from '@null3d/engine';
import { s1StaticCamera } from '../../scenes/spec';
import { followPath, readGameOptions, sceneTime, setUpView } from './game-common';
import { createSwarm } from './swarm';

export default defineGame((context) => {
	const options = readGameOptions(import.meta.url);
	const moveCamera = followPath(setUpView(context), s1StaticCamera);
	const swarm = createSwarm(context, options.count, false);
	swarm.pose(0);
	swarm.batch.markDirty();
	moveCamera(sceneTime(options, context));
	return {
		onUpdate() {
			moveCamera(sceneTime(options, context));
		},
	};
});

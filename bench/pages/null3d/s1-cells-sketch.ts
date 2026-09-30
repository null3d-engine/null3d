// The null3d version of S1-cells: S1-static's boxes spread over 8 x 8 grid cells, set once and
// never updated, while the camera flies low over them.
import { defineSketch } from '@null3d/engine';
import { s1CellsCamera, s1CellsInstanceAt } from '../../scenes/spec';
import { followPath, readCount, setUpView } from './sketch-common';
import { createSwarm } from './swarm';

export default defineSketch((context) => {
	const { time } = context;
	const moveCamera = followPath(setUpView(context), s1CellsCamera);
	const swarm = createSwarm(context, readCount(import.meta.url), false, s1CellsInstanceAt);
	swarm.pose(0);
	swarm.batch.markDirty();
	moveCamera(time.now);
	return {
		onUpdate() {
			moveCamera(time.now);
		},
	};
});

// The three.js twin of S1-static: S1's instances, set once at time 0 and never updated, while the
// camera flies through them.
import { S1_DEFAULT_COUNT, s1StaticCamera } from '../../scenes/spec';
import { runThreePage } from './harness';
import { createSwarm } from './swarm';

runThreePage('s1-static', (three, scene, { count }) => {
	const swarm = createSwarm(three, count ?? S1_DEFAULT_COUNT, false);
	scene.add(swarm.mesh);
	return { n: swarm.mesh.count, camera: s1StaticCamera };
});

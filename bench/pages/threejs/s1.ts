// The three.js twin of S1, the swarm: every instance moves every frame, and the camera orbits.
import { S1_DEFAULT_COUNT, s1Camera } from '../../scenes/spec';
import { runThreePage } from './harness';
import { createSwarm } from './swarm';

runThreePage('s1', (three, scene, { count }) => {
	const swarm = createSwarm(three, count ?? S1_DEFAULT_COUNT, true);
	scene.add(swarm.mesh);
	return { n: swarm.mesh.count, update: swarm.setMatrices, camera: s1Camera };
});

// The three.js twin of S1-cells: S1-static's boxes spread over 8 x 8 grid cells in one
// InstancedMesh, set once and never updated, while the camera flies low over them.
import { S1_DEFAULT_COUNT, s1CellsCamera, s1CellsInstanceAt } from '../../scenes/spec';
import { runThreePage } from './harness';
import { createSwarm } from './swarm';

runThreePage('s1-cells', (three, scene, { count }) => {
	const swarm = createSwarm(three, count ?? S1_DEFAULT_COUNT, false, s1CellsInstanceAt);
	scene.add(swarm.mesh);
	return { n: swarm.mesh.count, camera: s1CellsCamera };
});

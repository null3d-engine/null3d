// S1's instances as one three.js InstancedMesh, the best practice in three.js for many copies of
// one mesh: one draw call, with one matrix per instance in a buffer that the GPU reads.
import type * as ThreeModule from 'three';
import { createS1, S1_BOB_HEIGHT, S1_BOX_SIZE, S1_COLOR, s1InstanceAt } from '../../scenes/spec';
import type { Three } from './harness';

export interface Swarm {
	mesh: ThreeModule.InstancedMesh;
	/** Writes every instance's matrix for time t and marks the buffer for upload. It allocates nothing. */
	setMatrices(t: number): void;
}

/**
 * Makes S1's instances with their matrices at time 0, each placed at a time by `instanceAt`: S1's
 * own by default. Set `moving` when the matrices change every frame: it marks the matrix buffer
 * for frequent updates.
 */
export function createSwarm(
	three: Three,
	count: number,
	moving: boolean,
	instanceAt = s1InstanceAt,
): Swarm {
	const data = createS1(count);
	const mesh = new three.InstancedMesh(
		new three.BoxGeometry(S1_BOX_SIZE, S1_BOX_SIZE, S1_BOX_SIZE),
		new three.MeshStandardMaterial({ color: S1_COLOR }),
		count,
	);
	if (moving) mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);

	const positionOut = new Float64Array(3);
	const quaternionOut = new Float64Array(4);
	const position = new three.Vector3();
	const quaternion = new three.Quaternion();
	const scale = new three.Vector3(1, 1, 1);
	const matrix = new three.Matrix4();
	const setMatrices = (t: number): void => {
		for (let i = 0; i < count; i++) {
			instanceAt(data, i, t, positionOut, quaternionOut);
			position.fromArray(positionOut);
			quaternion.fromArray(quaternionOut);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(i, matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	};
	setMatrices(0);

	// Frustum culling tests one sphere around all the instances. Each instance stays within twice
	// its bob height of where it is at time 0, so a sphere grown by that much holds every frame.
	mesh.computeBoundingSphere();
	if (moving && mesh.boundingSphere) mesh.boundingSphere.radius += 2 * S1_BOB_HEIGHT;
	return { mesh, setMatrices };
}

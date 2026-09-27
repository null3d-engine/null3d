// S1's instances as one sokko3d instance batch. The game writes each row's position and rotation
// straight into the batch's arrays; the engine computes the matrices on its job workers.
import type { GameContext, InstanceBatch } from '@sokko3d/engine';
import { createS1, S1_BOX_SIZE, S1_COLOR, s1InstanceAt } from '../../scenes/spec';

export interface Swarm {
	batch: InstanceBatch;
	/** Writes every row for time t. It allocates nothing. */
	pose(t: number): void;
}

export function createSwarm(
	{ scene, materials, geometry }: GameContext,
	count: number,
	dynamic: boolean,
): Swarm {
	const data = createS1(count);
	const batch = scene.createInstances(
		geometry.box({ width: S1_BOX_SIZE, height: S1_BOX_SIZE, depth: S1_BOX_SIZE }),
		count,
		{ material: materials.standard({ color: S1_COLOR }), dynamic },
	);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const pose = (t: number): void => {
		const positions = batch.positions;
		const rotations = batch.rotations;
		for (let i = 0; i < count; i++) {
			s1InstanceAt(data, i, t, position, rotation);
			positions[i * 3] = position[0] as number;
			positions[i * 3 + 1] = position[1] as number;
			positions[i * 3 + 2] = position[2] as number;
			rotations[i * 4] = rotation[0] as number;
			rotations[i * 4 + 1] = rotation[1] as number;
			rotations[i * 4 + 2] = rotation[2] as number;
			rotations[i * 4 + 3] = rotation[3] as number;
		}
	};
	return { batch, pose };
}

// S1's instances as one null3d instance batch. The sketch writes each row's position and rotation
// straight into the batch's arrays; the engine computes the matrices on its job workers.
import type { InstanceBatch, SketchContext } from '@null3d/engine';
import { createS1, S1_BOX_SIZE, S1_COLOR, s1InstanceAt } from '../../scenes/spec';

export interface Swarm {
	batch: InstanceBatch;
	/** Writes every row for time t. It allocates nothing. */
	pose(t: number): void;
}

/** The opacity of S1's boxes when they blend, so the transparent pass sorts every row. */
const BLENDED_OPACITY = 0.6;

/**
 * Makes S1's instances as one batch, each placed at a time by `instanceAt`: S1's own by default.
 * With `blend`, the boxes see through, so each frame sorts every visible row back to front. With
 * `shadows`, every row casts and receives shadows.
 */
export function createSwarm(
	{ scene, materials, geometry }: SketchContext,
	count: number,
	dynamic: boolean,
	instanceAt = s1InstanceAt,
	blend = false,
	{ shadows = false }: { shadows?: boolean } = {},
): Swarm {
	const data = createS1(count);
	const material = blend
		? materials.standard({ color: S1_COLOR, opacity: BLENDED_OPACITY, alphaMode: 'blend' })
		: materials.standard({ color: S1_COLOR });
	const batch = scene.createInstances(
		geometry.box({ width: S1_BOX_SIZE, height: S1_BOX_SIZE, depth: S1_BOX_SIZE }),
		count,
		{ material, dynamic, castShadows: shadows, receiveShadows: shadows },
	);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	const pose = (t: number): void => {
		const positions = batch.positions;
		const rotations = batch.rotations;
		for (let i = 0; i < count; i++) {
			instanceAt(data, i, t, position, rotation);
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

/**
 * Makes S1's instances as one dynamic batch of dashed line segments: each runs through an instance's
 * place, at a time by S1's own placement, along its rotation's axis. Its pose writes every point for
 * time t and moves the dashes, and allocates nothing.
 */
export async function createLineSwarm(
	{ scene }: SketchContext,
	count: number,
): Promise<(t: number) => void> {
	const data = createS1(count);
	const lines = await scene.createLines({
		positions: new Float32Array(count * 6),
		mode: 'segments',
		color: S1_COLOR,
		width: 3,
		dashed: true,
		dashSize: 0.2,
		gapSize: 0.1,
		dynamic: true,
	});
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	// The dash offset moves in whole steps: a whole number in an object property makes no heap
	// number in any browser.
	const dashes = { dashOffset: 0 };
	return (t) => {
		const points = lines.positions;
		for (let i = 0; i < count; i++) {
			s1InstanceAt(data, i, t, position, rotation);
			for (let k = 0; k < 3; k++) {
				const middle = position[k] as number;
				const axis = (rotation[k] as number) * S1_BOX_SIZE;
				points[i * 6 + k] = middle - axis;
				points[i * 6 + 3 + k] = middle + axis;
			}
		}
		dashes.dashOffset = Math.floor(t * 10) % 10;
		lines.material.set(dashes);
	};
}

/**
 * Makes S1's instances as one dynamic batch of blended sprites, each placed at a time by S1's own
 * placement and turned by its rotation's first component. Each frame sorts every visible sprite
 * back to front. Its pose writes every sprite for time t, and allocates nothing.
 */
export async function createSpriteSwarm(
	{ scene }: SketchContext,
	count: number,
): Promise<(t: number) => void> {
	const data = createS1(count);
	const sprites = await scene.createSprites({ count, color: S1_COLOR, dynamic: true });
	sprites.sizes.fill(S1_BOX_SIZE);
	const position = new Float64Array(3);
	const rotation = new Float64Array(4);
	return (t) => {
		const positions = sprites.positions;
		const rotations = sprites.rotations;
		for (let i = 0; i < count; i++) {
			s1InstanceAt(data, i, t, position, rotation);
			positions[i * 3] = position[0] as number;
			positions[i * 3 + 1] = position[1] as number;
			positions[i * 3 + 2] = position[2] as number;
			rotations[i] = (rotation[0] as number) * Math.PI;
		}
	};
}

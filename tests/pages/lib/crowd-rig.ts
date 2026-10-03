// The animation page's generated character as the rig data that the engine's internal rig call
// reads, for the animator test page and the allocation check. It imports the engine's types, so it
// stays apart from `animation.ts`, which the runner and the unit tests load outside a browser.
import type { RigData } from '@null3d/engine/internal';
import { crowdCharacter, NO_PARENT } from './animation';

/** The names of a crowd character's clips, in order. */
export const CROWD_CLIPS = ['walk', 'run'] as const;

/** The channel names of the engine's rig data, by channel number. */
const CHANNEL_NAMES = ['translation', 'rotation', 'scale'] as const;

/**
 * A generated character as the rig data that the engine's internal rig call reads: joints named
 * `joint0` up, and its clips named walk and run. The walk has a 'left' event at 0.25 s and a
 * 'right' one at 0.75 s.
 */
export function crowdRig(joints: number): RigData {
	const character = crowdCharacter(joints);
	return {
		joints: character.parents.map((parent, j) => {
			const at = (k: number) => character.rest[j * 10 + k] ?? 0;
			return {
				name: `joint${j}`,
				parent: parent === NO_PARENT ? -1 : parent,
				translation: [at(0), at(1), at(2)],
				rotation: [at(3), at(4), at(5), at(6)],
				scale: [at(7), at(8), at(9)],
				inverseBind: character.inverseBind.slice(j * 12, j * 12 + 12),
			};
		}),
		clips: character.clips.map((tracks, c) => ({
			name: CROWD_CLIPS[c] ?? `clip${c}`,
			tracks: tracks.map((t) => ({
				joint: t.joint,
				channel: CHANNEL_NAMES[t.channel] ?? 'rotation',
				times: t.times,
				values: t.values,
			})),
			events:
				c === 0
					? [
							{ time: 0.25, name: 'left' },
							{ time: 0.75, name: 'right' },
						]
					: [],
		})),
	};
}

/** The arrays of a crowd character's skinned mesh, as `geometry.fromArrays` takes them. */
export interface CrowdMesh {
	positions: Float32Array;
	normals: Float32Array;
	joints: Uint16Array;
	weights: Float32Array;
	indices: Uint16Array;
}

/** Half the edge of the box at each joint of a crowd character's mesh, in meters. */
const BOX = 0.06;

/**
 * A skinned mesh for a generated character of `joints` joints: a small box at each joint's place
 * at rest, which that joint alone moves, so the mesh follows every joint of the pose.
 */
export function crowdMesh(joints: number): CrowdMesh {
	const character = crowdCharacter(joints);
	const corners = [-BOX, BOX];
	const faces: [number, number][] = [
		[0, -1],
		[0, 1],
		[1, -1],
		[1, 1],
		[2, -1],
		[2, 1],
	];
	const positions: number[] = [];
	const normals: number[] = [];
	const jointIds: number[] = [];
	const weights: number[] = [];
	const indices: number[] = [];
	for (let j = 0; j < joints; j++) {
		// The inverse bind matrix of a joint at rest moves it down to the origin by its height.
		const y = -(character.inverseBind[j * 12 + 7] ?? 0);
		for (const [axis, side] of faces) {
			const first = positions.length / 3;
			const u = (axis + 1) % 3;
			const v = (axis + 2) % 3;
			for (const a of corners)
				for (const b of corners) {
					const p = [0, 0, 0];
					p[axis] = side * BOX;
					p[u] = a;
					p[v] = b * side;
					positions.push(p[0] as number, (p[1] as number) + y, p[2] as number);
					const n = [0, 0, 0];
					n[axis] = side;
					normals.push(...n);
					jointIds.push(j, 0, 0, 0);
					weights.push(1, 0, 0, 0);
				}
			indices.push(first, first + 1, first + 3, first, first + 3, first + 2);
		}
	}
	return {
		positions: Float32Array.from(positions),
		normals: Float32Array.from(normals),
		joints: Uint16Array.from(jointIds),
		weights: Float32Array.from(weights),
		indices: Uint16Array.from(indices),
	};
}

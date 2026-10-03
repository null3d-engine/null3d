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

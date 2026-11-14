// The weighted demo's controls HUD: the two blends that the page offers, and the group that shows
// them. A pick posts the group's name and the option's id to the sketch, which sets the same blend
// that the S key does. The tips name what each blend does, with no input device, as HudOption asks.
import { type HudGroup, type HudOption, radioGroup } from '../lib/controls';

/** The two blends, with the key badge on the one that S chooses first. */
const BLENDS: readonly HudOption[] = [
	{
		id: 'Weighted',
		label: 'Weighted',
		tip: 'Blend the crossing panes and the smoke in any order.',
	},
	{
		id: 'Sorted',
		label: 'Sorted',
		tip: 'Sort the panes and the smoke by object, with normal blending.',
		key: 'S',
	},
];

/** The HUD's Blending group, with the blend on show chosen. */
export const blendGroup = (sorted: boolean): HudGroup =>
	radioGroup('blend', 'Blending', BLENDS, sorted ? 'Sorted' : 'Weighted');

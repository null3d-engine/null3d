// The hand-over from a batch of near meshes to their far cards: each draws over its own range of
// distance, and the two dithered edges never overlap, so no pixel drops out of both. A plant's rows
// may hand over in groups, whose switches spread a little either side of the plant's distance, so a
// frame takes the cards of one group rather than every tree in the scene.
import type { InstanceBatch } from '@null3d/engine';

/**
 * The share of a draw range's edge distance over which the engine dithers that edge. The dither's
 * phase comes from each copy's own source. The mesh and the card are different sources, so their
 * phases differ: a card that faded in while the mesh faded out would drop the pixels that both left
 * out, and the background would show through the crown.
 *
 * @category api/impostors
 */
export const EDGE_BAND = 0.08;

/**
 * The groups that a plant's trees hand over in, and how far either side of the plant's switch
 * distance the groups' switches spread, as a share of it. The groups are what keeps one frame from
 * taking every tree's mesh at once: a tree's own swap is as it was, but the trees around it swap a
 * little before or after it, so a view loses one group's cards a frame instead of all of them.
 *
 * @category api/impostors
 */
export const HAND_OVER_GROUPS = 4;
/**
 * The share of the hand-over distance that the groups' switches spread either side of it, so the
 * first group swaps a little early and the last a little late and the change is spread over a
 * short stretch of travel rather than landing in one frame.
 *
 * @category api/impostors
 */
export const HAND_OVER_SPREAD = 0.06;

/**
 * The switch distances of `count` groups, spread evenly either side of `switchDistance`: the first
 * group hands over earliest and the last latest, and their mean is the switch distance itself. A
 * group draws its meshes up to its own distance, so a camera crossing the plant's hand-over meets
 * one group's switch after another.
 *
 * @category api/impostors
 */
export function handOverSwitches(
	switchDistance: number,
	count = HAND_OVER_GROUPS,
	spread = HAND_OVER_SPREAD,
): number[] {
	if (!(switchDistance > 0))
		throw new RangeError(
			`handOverSwitches() got ${switchDistance} as the switch distance, not a number above 0.`,
		);
	if (!Number.isInteger(count) || count < 1)
		throw new RangeError(
			`handOverSwitches() got ${count} groups, not a whole number of 1 or more.`,
		);
	if (!(spread >= 0 && spread < 1))
		throw new RangeError(
			`handOverSwitches() got ${spread} as the spread, not a share from 0 below 1 of the switch distance.`,
		);
	const switches: number[] = [];
	for (let k = 0; k < count; k++) {
		// At one group the switch is the plant's own distance; more groups straddle it evenly.
		const share = count === 1 ? 0 : (k / (count - 1)) * 2 - 1;
		switches.push(switchDistance * (1 + spread * share));
	}
	return switches;
}

/**
 * Where a batch of cards starts so that each stands at full coverage before its mesh's edge begins
 * to thin. A draw range measures to a bound's nearest point, and a card's bound sits at the card's
 * middle and reaches its corners, so a large tree's card takes its distance nearer than the tree's
 * foot. Its start allows for the corner of the largest card.
 */
function cardsStart(cards: InstanceBatch, switchDistance: number): number {
	let reach = 0;
	const { scales } = cards;
	for (let k = 0; k < scales.length; k += 3)
		reach = Math.max(reach, Math.hypot((scales[k] as number) / 2, (scales[k + 1] as number) / 2));
	return Math.max(0, (switchDistance / (1 + EDGE_BAND) - reach) / (1 + EDGE_BAND));
}

/** The far edge that a card batch draws to, in meters: farther than any camera's far plane. */
const FAR = 1e9;

/**
 * Draws a group of near meshes from `start` up to its switch distance, where the engine dithers the
 * range's far edge out.
 *
 * @category api/impostors
 */
export function handOverMeshes(meshes: InstanceBatch, switchDistance: number, start = 0): void {
	if (!(switchDistance > 0))
		throw new RangeError(
			`handOverMeshes() got ${switchDistance} as the switch distance, not a number above 0.`,
		);
	if (!(start >= 0 && start < switchDistance))
		throw new RangeError(
			`handOverMeshes() got ${start} as the start, not a number from 0 below the switch distance.`,
		);
	meshes.setDrawRange(start, switchDistance);
}

/**
 * Starts a batch of cards early enough that they stand at full coverage before the earliest mesh
 * group that hands over to them begins to thin. Write the cards' turns and sizes before this call.
 *
 * @category api/impostors
 */
export function handOverCards(cards: InstanceBatch, earliestSwitch: number): void {
	if (!(earliestSwitch > 0))
		throw new RangeError(
			`handOverCards() got ${earliestSwitch} as the switch distance, not a number above 0.`,
		);
	cards.setDrawRange(cardsStart(cards, earliestSwitch), FAR);
}

/**
 * Hands one group of near meshes over to its far cards. The meshes draw up to `switchDistance`, and
 * the cards start early enough that their own dithered edge ends before the meshes' edge begins to
 * thin. So each pixel that a mesh drops shows its card at full coverage, and the background never
 * shows through. Write the cards' turns and sizes before this call, and call it at setup.
 *
 * A plant that hands over in groups calls `handOverCards` once with the earliest group's switch, so
 * the cards stand behind every group, and `handOverMeshes` once for each group's own distance.
 *
 * @param meshes The batch of near meshes, whose rows stand at the same places as the cards' rows.
 * @param cards The card batch, such as `ImpostorBatch.batch`.
 * @param switchDistance The distance from the camera at which these trees hand over, in meters.
 * @param start The distance from which the meshes draw, in meters: 0 for a batch that draws from
 *   the camera out, or the start of a coarser level's own band.
 * @category api/impostors
 */
export function handOverToCards(
	meshes: InstanceBatch,
	cards: InstanceBatch,
	switchDistance: number,
	start = 0,
): void {
	handOverMeshes(meshes, switchDistance, start);
	handOverCards(cards, switchDistance);
}

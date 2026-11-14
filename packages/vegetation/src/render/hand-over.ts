// The hand-over from a band of near meshes to their far cards: each draws over its own range of
// distance, and the two dithered edges never overlap, so no pixel of a crown drops out of both.
import type { InstanceBatch } from '@null3d/engine';

/**
 * The share of a draw range's edge distance over which the engine dithers that edge. The dither's
 * phase comes from each copy's own source. The mesh and the card are different sources, so their
 * phases differ: a card that faded in while the mesh faded out would drop the pixels that both left
 * out, and the background would show through the crown.
 */
export const EDGE_BAND = 0.08;

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
 * Hands a band of trees from their meshes to their cards. The meshes draw up to
 * `switchDistance`, and the engine dithers their last few per cent of that range out. The cards
 * start far enough before it that their own dithered edge finishes before the mesh's edge begins to
 * thin: each dropped mesh pixel shows its card at full coverage, one dither moves the tree from its
 * mesh to its card, and the background never shows through the crown. Write the cards' turns and
 * sizes before this call, and call it at setup.
 *
 * @param meshes The batch of near meshes, whose rows stand at the same trees.
 * @param cards The card batch, such as `ImpostorBatch.batch`.
 * @param switchDistance The distance from the camera at which a tree hands over, in meters.
 * @param start The distance from which the meshes draw, in meters: 0 for a batch that draws from
 *   the tree out, or the start of a coarser level's own band.
 * @category api/vegetation
 */
export function handOverToCards(
	meshes: InstanceBatch,
	cards: InstanceBatch,
	switchDistance: number,
	start = 0,
): void {
	if (!(switchDistance > 0))
		throw new RangeError(
			`handOverToCards() got ${switchDistance} as the switch distance, not a number above 0.`,
		);
	if (!(start >= 0 && start < switchDistance))
		throw new RangeError(
			`handOverToCards() got ${start} as the start, not a number from 0 below the switch distance.`,
		);
	meshes.setDrawRange(start, switchDistance);
	cards.setDrawRange(cardsStart(cards, switchDistance), FAR);
}

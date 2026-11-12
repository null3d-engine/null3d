// The connected body of one mesh level: its drawn wood from the root, and the cards joined to it. A
// level thins the wood by its orders and the cards by their share; every card whose branch went is
// dropped, so the level's plant is one body reaching the root.
import { AXIS_LIMB, AXIS_STEM, AXIS_STIPE } from '../core/graph';
import type { MeshInput, MeshLevel } from '../stages';
import { connectedCards } from './cards';

/** One level's plant: its connected components, and whether the stem's root is one of them. */
export interface ConnectedBody {
	/** The components of the drawn wood, from its roots. The drawn cards are joined by rule. */
	readonly components: number;
	/** Whether a stem of the plant is drawn at this level, so the body reaches the root. */
	readonly reachesRoot: boolean;
	/** The cards or shoots the level draws, all joined to the body. */
	readonly cards: number;
}

/**
 * Counts a level's connected body: its drawn wood is one component per root, and every drawn card is
 * joined to it by the card rule, so a card whose branch went is not drawn.
 *
 * @param input The dressed variant.
 * @param level The mesh level.
 * @returns The level's components, root and drawn cards.
 * @category api/vegetation
 */
export function connectedBody(input: MeshInput, level: MeshLevel): ConnectedBody {
	const { axes } = input.skeleton;
	const keep = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	let components = 0;
	let reachesRoot = false;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) > keep) continue;
		const parent = axes.parent[a] as number;
		const kind = axes.kind[a] as number;
		const wood = parent >= 0 || kind === AXIS_STEM || kind === AXIS_STIPE || kind === AXIS_LIMB;
		if (!wood) continue;
		if (parent < 0) components++;
		if (kind === AXIS_STEM && (axes.order[a] as number) === 0) reachesRoot = true;
	}
	let cards = 0;
	if (level > 0) {
		const flags = connectedCards(input, level as 1 | 2);
		for (let r = 0; r < flags.length; r++) if (flags[r] === 1) cards++;
	}
	return { components, reachesRoot, cards };
}

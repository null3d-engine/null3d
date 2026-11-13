// The scene's budget of real pieces. Near the eye a plant's first card level would draw its cards
// larger than their texels, so the plants nearest the eye draw their real pieces instead, inside one
// budget of triangles for the whole scene. The nearest copies draw their pieces to their switch while
// the budget lasts; what is left lets the nearest draw them on to the range where their cards' cells
// draw at their own texels. The first copy that does not fit ends the hand-out, and it and every
// copy past it keep their cards. A copy's cost is its own count drawn at once from its worst stated
// eye, the same wherever the scene's eye stands, so the budget holds from any eye and a copy's grant
// moves only when the order of distances does: as the eye walks towards a copy, the copies nearer
// than it only drop out, so its grant only rises, and past it only falls. A copy that holds a grant
// keeps it while the scene stays within the budget, and a new grant must fit a twentieth inside it,
// so two copies at nearly one distance do not trade a grant back and forth.

import type { PlantAsset, SpeciesKitData } from '../asset';
import { log } from '../core/math';
import { drawnAtOnce, type PlantView } from '../lod/drawn';
import { firstCardStart, texelStart } from '../lod/levels';

/** A copy draws no real pieces: its cards draw from the eye out. */
export const GRANT_NONE = 0;
/** A copy draws its real pieces to its switch. */
export const GRANT_SWITCH = 1;
/** A copy draws its real pieces to the range where its cards' cells draw at their own texels. */
export const GRANT_TEXEL = 2;

/** The share of the budget that a new grant must fit inside. */
const NEW_GRANT_SHARE = 0.95;

/** One copy that may draw real pieces, as the eye sees it. */
export interface BudgetCandidate {
	/** Metres from the eye to the copy. */
	readonly distance: number;
	/** The triangles its real pieces draw at once when they draw to its switch, from its worst eye. */
	readonly toSwitch: number;
	/** The same when they draw to its texel range, at least the first. */
	readonly toTexel: number;
}

/**
 * Hands out a scene's budget of real pieces, nearest copy first. Copies are ordered by their distance
 * to the whole metre, then by their place in the list, so two copies at nearly one distance do not
 * trade places at every step of the eye.
 *
 * @param candidates The copies that may draw real pieces.
 * @param budget The scene's triangles for real pieces.
 * @param last The grants of the last hand-out, one per copy in the same order, if any.
 * @returns One grant per copy: none, to the switch or to the texel range.
 */
export function handOut(
	candidates: readonly BudgetCandidate[],
	budget: number,
	last?: Uint8Array,
): Uint8Array {
	if (!Number.isFinite(budget) || budget < 0)
		throw new Error(`@null3d/vegetation: a pieces budget of ${budget} is no count of triangles.`);
	const order = candidates.map((_, i) => i);
	order.sort((a, b) => {
		const da = Math.floor((candidates[a] as BudgetCandidate).distance);
		const db = Math.floor((candidates[b] as BudgetCandidate).distance);
		return da - db || a - b;
	});
	const grants = new Uint8Array(candidates.length);
	// A grant the copy held is kept to the whole budget; a new one must fit a twentieth inside it.
	const limit = (i: number, grant: number) =>
		(last?.[i] ?? GRANT_NONE) >= grant ? budget : budget * NEW_GRANT_SHARE;
	let spent = 0;
	// Every copy to its switch, nearest first, until the first that does not fit.
	for (const i of order) {
		const cost = (candidates[i] as BudgetCandidate).toSwitch;
		if (cost <= 0) continue;
		if (spent + cost > limit(i, GRANT_SWITCH)) break;
		spent += cost;
		grants[i] = GRANT_SWITCH;
	}
	// Then on to the texel range, nearest first, with what is left.
	for (const i of order) {
		if (grants[i] !== GRANT_SWITCH) continue;
		const c = candidates[i] as BudgetCandidate;
		const more = c.toTexel - c.toSwitch;
		if (spent + more > limit(i, GRANT_TEXEL)) break;
		spent += more;
		grants[i] = GRANT_TEXEL;
	}
	return grants;
}

/**
 * A variant's costs in the scene's budget at a page's view: the triangles one copy draws at once
 * from its worst stated eye when its pieces draw to its switch, and when they draw on to its texel
 * range, by the shared drawn-at-once count with the switch moved out by the range's factor.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param view The page's render height, lens and switch bias.
 * @returns The two costs, the second at least the first.
 */
export function pieceCosts(
	kit: SpeciesKitData,
	asset: PlantAsset,
	view: PlantView,
): { readonly toSwitch: number; readonly toTexel: number } {
	const toSwitch = drawnAtOnce(kit, asset, view).triangles;
	const factor = texelStart(kit, view) / firstCardStart(kit, view);
	if (factor <= 1) return { toSwitch, toTexel: toSwitch };
	const further = { ...view, switchBias: (view.switchBias ?? 0) - log(factor) / log(2) };
	return { toSwitch, toTexel: Math.max(toSwitch, drawnAtOnce(kit, asset, further).triangles) };
}

// The planned fill's scale, from one source: an order's piece length and radius are the record's
// measured piece figures, and its socket pitch is the spacing the record's own frame measures
// between sockets. Nothing here invents a figure: a field the record leaves unmeasured stays
// absent, and a case can then name the species rather than read a made-up size.
import type { FillFigures } from '../core/graph';
import type { Planned, Species } from '../core/record';
import { spreadMean } from '../core/types';
import type { FramePatch } from './frame';

/** The closest spacing in metres that a plan's patches state between two sockets. */
function statedPitch(patches: readonly FramePatch[]): number | undefined {
	let least = Number.POSITIVE_INFINITY;
	for (const patch of patches) {
		const spacing = patch.sockets?.every ?? patch.fill?.pitch;
		if (spacing !== undefined && spacing > 0 && spacing < least) least = spacing;
	}
	return Number.isFinite(least) ? least : undefined;
}

/**
 * The figures one fill order reads from its record: its piece's stem length and foot radius, and
 * the closest socket spacing the record's frame states. The same pitch serves every order, since
 * the frame measures the spacing of its sockets, not of the plan's orders.
 *
 * @param record The species record whose pieces the order names.
 * @param order The order, which names its piece.
 * @param pitch The closest spacing the record's frame states, where it states one.
 * @returns The order's figures; a field is absent where the record does not measure it.
 * @category api/vegetation
 */
export function orderFigures(
	record: Species,
	order: { readonly piece: string },
	pitch: number | undefined,
): FillFigures {
	const rule = record.pieces?.find((piece) => piece.name === order.piece);
	const length = rule ? spreadMean(rule.stem.length) : undefined;
	const radius = rule?.stem.radius[0];
	return {
		piece: order.piece,
		...(length !== undefined && Number.isFinite(length) ? { length } : {}),
		...(radius !== undefined && Number.isFinite(radius) ? { radius } : {}),
		...(pitch !== undefined ? { pitch } : {}),
	};
}

/**
 * The measured figures of every fill order of a planned species, read from its record and the
 * frame's own socket spacing. Another growth model has no fill orders and reads no figures.
 *
 * @param record The species record.
 * @param patches The plan's foliage patches, whose socket spacing the record measured.
 * @returns One figure set per fill order, in the record's order; empty on another model.
 * @category api/vegetation
 */
export function resolveFillFigures(
	record: Species,
	patches: readonly FramePatch[],
): readonly FillFigures[] {
	const growth = record.growth;
	if (growth.model !== 'planned') return [];
	const planned = growth as Planned;
	const pitch = statedPitch(patches);
	return planned.orders.map((order) => orderFigures(record, order, pitch));
}

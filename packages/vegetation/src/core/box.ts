// The species box: one box per species, larger than any of its variants, that every part's 16-bit
// positions are quantised against. One box means one transform per copy row for every part, and the
// plant shader reads it from the records texture's header. It comes from the record alone, so a
// variant grown on its own knows the box that its siblings share.
import type { Species } from './record';
import { spreadMax, type Vec3 } from './types';

/**
 * The box a species' quantised positions span, in plant-space metres.
 *
 * @category api/vegetation
 */
export interface SpeciesBox {
	/** The box's lowest corner. */
	readonly min: Vec3;
	/** The box's highest corner. */
	readonly max: Vec3;
}

/** The longest main stem among the record's pieces, in metres: a crown's longest frond. */
function longestPiece(record: Species): number {
	let longest = 0;
	for (const piece of record.pieces ?? [])
		longest = Math.max(longest, spreadMax(piece.stem.length));
	return longest;
}

/** The tallest a plant of the record can grow, before the box's margin. */
function tallest(record: Species): number {
	const growth = record.growth;
	let height = spreadMax(record.size.height);
	switch (growth.model) {
		case 'crown-rosette':
			height = Math.max(height, spreadMax(growth.stem.height) + spreadMax(growth.frond.length));
			break;
		case 'frond-crown':
			height = Math.max(height, growth.trunk.height + longestPiece(record));
			break;
		case 'culm':
			height = Math.max(height, spreadMax(growth.height));
			break;
		case 'column':
			height = Math.max(height, spreadMax(growth.height));
			break;
		default:
			break;
	}
	return height;
}

/** The widest radius over height that the record's envelope allows, or 0 without one. */
function envelopeReach(record: Species): number {
	const envelope = record.envelope;
	if (envelope?.kind !== 'radial') return 0;
	let widest = 0;
	for (const radius of envelope.radii) {
		const values = typeof radius === 'number' ? [radius] : radius;
		for (const value of values) widest = Math.max(widest, value);
	}
	return widest;
}

/**
 * The box of a species: its tallest plant, a crown as wide as its aspect or its envelope allows,
 * room for roots below the ground, and a margin all round.
 *
 * @param record The species record.
 * @returns The box.
 * @category api/vegetation
 */
export function speciesBox(record: Species): SpeciesBox {
	const height = tallest(record);
	const growth = record.growth;
	// Fronds reach out from a palm's crown, and from a colony's rhizome as far as it runs.
	const fronds =
		growth.model === 'crown-rosette'
			? spreadMax(growth.frond.length)
			: growth.model === 'frond-crown'
				? longestPiece(record)
				: growth.model === 'frond-colony'
					? growth.rhizome.length + spreadMax(growth.frond.length)
					: 0;
	const reach = Math.max(
		Math.max(0.5 * record.size.aspect, envelopeReach(record), 0.25) * height,
		fronds,
	);
	const half = reach * 1.5 + 0.5;
	const top = height * 1.2 + 0.5;
	const bottom = -(height * 0.15 + 0.25);
	return { min: [-half, bottom, -half], max: [half, top, half] };
}

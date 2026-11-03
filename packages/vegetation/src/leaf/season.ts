// Seasons on the shoots. A deciduous species' kit holds a leafless twin of each shoot prototype:
// the same stems and the same buds, which winter rows draw, so a bare tree shows its winter buds on
// its real twigs. In winter a marcescent species (young beech) keeps its dead leaves on the lower
// crown, which the shader colours by the season. In blossom, the record's share of rows is in
// leaf; the rest are bare twigs that carry the flowers. Summer and autumn rows are in leaf; autumn
// turns their colour in the shader.
import type { Species } from '../core/record';
import type { Season } from '../core/types';

/** The share of the crown's height, from its base, below which a marcescent crown keeps its leaves. */
const MARCESCENT_BELOW = 0.45;

/**
 * Whether a species' kit holds leafless twins of its shoot prototypes.
 *
 * @param record The species record.
 * @returns True for a deciduous species with leaves on its shoots.
 * @category api/vegetation
 */
export function hasBareTwins(record: Species): boolean {
	return record.seasons.deciduous && record.shoots !== undefined && record.foliage.kind !== 'none';
}

/**
 * Whether a shoot row is in leaf in a season.
 *
 * @param record The species record.
 * @param season The variant's season.
 * @param height The row's height in the crown, 0 at the crown's base and 1 at its top.
 * @param unit A choice between 0 and 1 of the row's own.
 * @returns True when the row draws its leafy prototype.
 * @category api/vegetation
 */
export function inLeaf(record: Species, season: Season, height: number, unit: number): boolean {
	const seasons = record.seasons;
	if (!seasons.deciduous) return true;
	switch (season) {
		case 'summer':
		case 'autumn':
			return true;
		case 'winter':
			if (seasons.winter === 'evergreen') return true;
			if (seasons.winter === 'marcescent') return height < MARCESCENT_BELOW;
			return false;
		case 'blossom':
			return unit < (seasons.blossom?.leaves ?? 1);
	}
}

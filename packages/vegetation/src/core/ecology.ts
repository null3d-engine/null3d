// The scatter's rule of a species, from its record: the record's own ecology, with its id, its
// variants and the radius of its crown, so a scene places a species by the numbers its folder holds.
import type { EcoRule } from '../ecology/ecology';
import type { Species } from './record';
import { spreadMean } from './types';

/**
 * The radius a plant of a species keeps to itself at scale 1, in metres: half its crown's width.
 *
 * @param record The species record.
 * @returns The radius.
 * @category api/vegetation
 */
export function crownRadius(record: Species): number {
	return 0.5 * record.size.aspect * spreadMean(record.size.height);
}

/**
 * The scatter's rule that places a species, from its record's ecology, or undefined when the
 * record has none.
 *
 * @param record The species record.
 * @param variants The variants a copy may take; the record's by default.
 * @returns The rule.
 * @category api/vegetation
 */
export function speciesRule(record: Species, variants = record.variants): EcoRule | undefined {
	const ecology = record.ecology;
	if (!ecology) return undefined;
	return {
		...ecology,
		species: record.id,
		variants,
		radius: ecology.radius ?? crownRadius(record),
	};
}

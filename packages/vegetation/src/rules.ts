// The rules that place the built-in species: where each one grows, from the water's edge to the
// dry slopes above. A record holds numbers only, so a themed pack writes rules of its own and the
// package grows no plants differently.
import type { EcoRule, ToleranceCurve } from './ecology';
import type { Species } from './species';

/**
 * A rough crown radius of a species, in meters, for the room that its rule keeps. A page that has
 * grown the species' assets passes the real radius instead, which its crown holds.
 *
 * @param species The species record.
 * @param scale The scale of the copy.
 * @returns The radius, in meters.
 * @category api/vegetation
 */
export function speciesCrownRadius(species: Species, scale = 1): number {
	const spread = species.rosette ? species.rosette.length * 0.8 : species.height * 0.4;
	const card = species.leaf ? Math.max(species.leaf.width, species.leaf.height) : 0;
	return (spread + card) * scale;
}

/** One curve, for a record that names it in the shortest form. */
function curve(
	input: ToleranceCurve['input'],
	min: number,
	best: number,
	worst: number,
	max: number,
): ToleranceCurve {
	return { input, min, best, worst, max };
}

/**
 * The fields of a rule that its species record fills.
 *
 * @category api/vegetation
 */
export type SpeciesRuleFields = Omit<EcoRule, 'species' | 'variants' | 'scale' | 'radius'> & {
	/** The room that the plant keeps, in meters. The species' rough crown radius by default. */
	readonly radius?: number;
};

/**
 * A rule for one of the built-in species, with the species' id, its variants and its sizes taken
 * from its record.
 *
 * @param species The species record.
 * @param fields The layer, the spacing, the tolerances and the rest.
 * @returns The rule.
 * @category api/vegetation
 */
export function speciesRule(species: Species, fields: SpeciesRuleFields): EcoRule {
	return {
		species: species.id,
		variants: species.variants,
		scale: species.size,
		radius: fields.radius ?? speciesCrownRadius(species),
		layer: fields.layer,
		spacing: fields.spacing,
		tolerances: fields.tolerances,
		...(fields.threshold !== undefined ? { threshold: fields.threshold } : {}),
		...(fields.cluster ? { cluster: fields.cluster } : {}),
		...(fields.clump ? { clump: fields.clump } : {}),
		...(fields.overlaps ? { overlaps: fields.overlaps } : {}),
	};
}

/**
 * The rules that place the built-in species in a valley that has water at zero.
 *
 * @param species The species records to place, which may be a subset of the built-in set.
 * @returns The rules, in the order that the layers meet them.
 * @category api/vegetation
 */
export function builtinRules(species: readonly Species[]): EcoRule[] {
	const byId = new Map(species.map((record) => [record.id, record]));
	const rules: EcoRule[] = [];
	const add = (id: string, fields: SpeciesRuleFields) => {
		const record = byId.get(id);
		if (record) rules.push(speciesRule(record, fields));
	};

	// The water's edge: rushes stand in the shallows, with sedges just behind them.
	add('rush', {
		layer: 'ground',
		spacing: 1.2,
		tolerances: [
			curve('heightAboveWater', -0.75, -0.4, 0.05, 0.55),
			curve('distanceToWater', 0, 0, 2.5, 4.5),
			curve('wetness', 0.15, 0.4, 1, 1.01),
		],
		clump: [0.2, 1],
	});
	add('sedge', {
		layer: 'ground',
		spacing: 1.4,
		tolerances: [
			curve('heightAboveWater', -0.5, -0.1, 0.5, 1.1),
			curve('distanceToWater', 0, 0.5, 3.5, 6),
			curve('wetness', 0.1, 0.3, 1, 1.01),
		],
		clump: [0.2, 1],
	});

	// The banks: willows at the water and alders behind them.
	add('willow', {
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			curve('heightAboveWater', 0.05, 0.3, 1.5, 3),
			curve('distanceToWater', 0.5, 1.5, 6, 10),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('slope', 0, 0, 0.5, 0.85),
		],
		clump: [0.25, 1],
	});
	add('alder', {
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			curve('heightAboveWater', 0.15, 0.5, 2.2, 5),
			curve('distanceToWater', 1.5, 4, 10, 18),
			curve('wetness', 0.04, 0.15, 1, 1.01),
		],
		clump: [0.25, 1],
	});

	// The flat and the dry slopes, the larger trees first so they claim the room and the smaller
	// ones fill the gaps between them: oaks face the sun and beeches the shade.
	add('oak', {
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			curve('heightAboveWater', 0.6, 1.8, 11, 20),
			curve('slope', 0, 0.15, 0.55, 0.95),
			curve('northness', -1, -1, 0.15, 1.01),
		],
		clump: [0.25, 1],
	});
	add('beech', {
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			curve('heightAboveWater', 0.6, 1.8, 10, 18),
			curve('northness', -0.3, 0.25, 1, 1.01),
			curve('wetness', 0.02, 0.1, 1, 1.01),
		],
		clump: [0.25, 1],
	});
	add('birch', {
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			curve('heightAboveWater', 0.4, 1.2, 8, 14),
			curve('distanceToWater', 4, 9, 40, 70),
			curve('openness', 0.05, 0.35, 1, 1.01),
		],
		clump: [0.25, 1],
	});
	add('conifer', {
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			curve('heightAboveWater', 3, 7, 22, 40),
			curve('slope', 0.18, 0.3, 1.4, 2.2),
			curve('northness', -0.6, 0, 1, 1.01),
		],
		clump: [0.2, 1],
	});
	add('broadleaf', {
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			curve('heightAboveWater', 0.6, 1.8, 13, 26),
			curve('distanceToWater', 2, 6, 70, 140),
		],
		clump: [0.25, 1],
	});

	// The saplings: the trees' own young, gathered under the adults that tolerate their shade.
	add('oak', {
		layer: 'young',
		spacing: 4,
		radius: 1.2,
		overlaps: ['young'],
		cluster: { species: ['oak', 'beech', 'broadleaf'], radius: 7, min: 1, max: 3 },
		tolerances: [curve('heightAboveWater', 0.4, 1.8, 11, 20), curve('slope', 0, 0.2, 0.7, 1.2)],
	});
	add('birch', {
		layer: 'young',
		spacing: 4,
		radius: 1.1,
		overlaps: ['young'],
		cluster: { species: ['birch', 'willow', 'alder'], radius: 6, min: 1, max: 3 },
		tolerances: [
			curve('heightAboveWater', 0.3, 1.2, 8, 14),
			curve('openness', 0.02, 0.25, 1, 1.01),
		],
	});
	add('alder', {
		layer: 'young',
		spacing: 4,
		radius: 1,
		overlaps: ['young'],
		cluster: { species: ['alder', 'willow'], radius: 6, min: 1, max: 2 },
		tolerances: [curve('heightAboveWater', 0.15, 0.5, 2.2, 5)],
	});

	// The shade: ferns under the crowns, hostas where the ground stays moist.
	add('fern', {
		layer: 'understory',
		spacing: 1.8,
		overlaps: ['understory'],
		tolerances: [
			curve('canopy', 0.08, 0.3, 1, 1.01),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('heightAboveWater', 0.15, 0.5, 6, 12),
		],
		clump: [0.25, 1],
	});
	add('hosta', {
		layer: 'ground',
		spacing: 2.4,
		overlaps: ['ground'],
		tolerances: [
			curve('canopy', 0.06, 0.25, 1, 1.01),
			curve('wetness', 0.05, 0.2, 1, 1.01),
			curve('distanceToWater', 0.4, 1.5, 14, 26),
		],
		clump: [0.3, 1],
	});
	add('meadow-grass', {
		layer: 'ground',
		spacing: 1,
		overlaps: ['ground'],
		tolerances: [
			curve('openness', 0.3, 0.6, 1, 1.01),
			curve('slope', 0, 0, 0.6, 1.1),
			curve('heightAboveWater', 0, 0.3, 11, 20),
		],
		clump: [0.25, 1],
	});

	// The thickets: shrubs thickest where the wood meets the meadow.
	add('shrub', {
		layer: 'shrub',
		spacing: 2.6,
		overlaps: ['shrub'],
		tolerances: [
			curve('edge', 0.1, 0.4, 1, 1.01),
			curve('heightAboveWater', 0.2, 0.5, 8, 15),
			curve('slope', 0, 0, 0.6, 1.1),
		],
		clump: [0.2, 1],
	});

	// The dead wood nobody cleared: fallen lengths on the floor of the wood.
	rules.push({
		species: 'deadwood',
		layer: 'deadwood',
		spacing: 11,
		radius: 2.5,
		overlaps: ['deadwood'],
		tolerances: [curve('canopy', 0.2, 0.5, 1, 1.01), curve('slope', 0, 0, 0.4, 0.8)],
		clump: [0.3, 1],
	});

	return rules;
}

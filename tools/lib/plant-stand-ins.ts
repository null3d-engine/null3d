// The plant core's guard set of stand-ins: the species, looks, seeds and variant counts that the demo
// scenes grew through the vegetation add-on before they drew their own plants. The demos no longer
// read them, and the set stays fixed, so `bun tools/plant-mesh-hash.ts --standins` keeps hashing the
// same plants and a change to the plant core can still be proved inert for every stand-in it grew.

/**
 * The sparse level the guard set grows at: the sparsest form each species allows, as the scenes
 * grew their stand-ins.
 */
export const GUARD_SPARSENESS = 1;

/** One of Creek's species as its stand-in was grown: its height and crown reach, and its colours. */
interface CreekSpecies {
	readonly id: string;
	readonly height: number;
	readonly crown: number;
	readonly leaf: readonly [number, number, number];
	readonly bark: readonly [number, number, number];
}

const CREEK_SPECIES: readonly CreekSpecies[] = [
	{
		id: 'pedunculate-oak',
		height: 13,
		crown: 5.7,
		leaf: [0.09, 0.19, 0.045],
		bark: [0.18, 0.15, 0.12],
	},
	{
		id: 'european-beech',
		height: 14,
		crown: 6,
		leaf: [0.14, 0.28, 0.07],
		bark: [0.32, 0.3, 0.27],
	},
	{
		id: 'silver-birch',
		height: 12,
		crown: 5.5,
		leaf: [0.2, 0.34, 0.1],
		bark: [0.62, 0.6, 0.55],
	},
	{
		id: 'weeping-willow',
		height: 10,
		crown: 4.42,
		leaf: [0.18, 0.3, 0.1],
		bark: [0.25, 0.21, 0.15],
	},
	{
		id: 'common-alder',
		height: 9.5,
		crown: 4.1,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.22, 0.2, 0.17],
	},
	{
		id: 'norway-spruce',
		height: 15,
		crown: 7.1,
		leaf: [0.08, 0.2, 0.09],
		bark: [0.26, 0.18, 0.13],
	},
	{
		id: 'hosta',
		height: 0.6,
		crown: 0.44,
		leaf: [0.12, 0.3, 0.09],
		bark: [0.2, 0.18, 0.12],
	},
	{
		id: 'sedge',
		height: 0.85,
		crown: 0.64,
		leaf: [0.2, 0.32, 0.1],
		bark: [0.22, 0.2, 0.12],
	},
	{
		id: 'rush',
		height: 1.15,
		crown: 0.88,
		leaf: [0.16, 0.3, 0.09],
		bark: [0.2, 0.19, 0.13],
	},
	{
		id: 'wildflower',
		height: 0.4,
		crown: 0.272,
		leaf: [0.14, 0.3, 0.08],
		bark: [0.2, 0.18, 0.12],
	},
	{
		id: 'hawthorn-shrub',
		height: 2.4,
		crown: 1.16,
		leaf: [0.15, 0.3, 0.1],
		bark: [0.22, 0.18, 0.13],
	},
	{
		id: 'bracken',
		height: 0.9,
		crown: 0.72,
		leaf: [0.11, 0.26, 0.06],
		bark: [0.2, 0.16, 0.1],
	},
];

/**
 * The size and colours a stand-in is grown at, shaped as the plant core's `StandInOptions` takes
 * them. It is declared here rather than imported so this module stays free of the add-on's index,
 * which loads the engine.
 */
export interface StandInLook {
	readonly height?: number | { readonly mean: number; readonly spread: number };
	readonly aspect?: number;
	readonly dbh?: number;
	readonly leaf?: readonly [number, number, number];
	readonly bark?: readonly [number, number, number];
	readonly variants?: number;
}

/** One plant of the guard set: the species id and its stand-in look. */
export interface GuardPlant {
	readonly id: string;
	readonly standIn: StandInLook;
}

/** A group of the guard set: the scene it came from, its seed, and its variant count where it names one. */
export interface GuardSet {
	readonly scene: string;
	readonly seed: number;
	readonly variants?: number;
	readonly plants: readonly GuardPlant[];
}

/** The contact-shadows garden's pine: a Scots pine, dark against the sky above the wall. */
export const CONTACT_SHADOWS_PINE: GuardPlant = {
	id: 'scots-pine',
	standIn: { height: 15, aspect: 0.45, leaf: [0.06, 0.17, 0.07], bark: [0.26, 0.18, 0.13] },
};
/** The contact-shadows garden's grass: meadow grass, about a hand high at scale 1. */
export const CONTACT_SHADOWS_GRASS: GuardPlant = {
	id: 'meadow-grass',
	standIn: { height: 0.5, aspect: 0.4, leaf: [0.24, 0.4, 0.1], bark: [0.2, 0.18, 0.1] },
};
/** The light shafts wood's pine: a tall Norway spruce on a bare trunk. */
export const LIGHT_SHAFTS_SPRUCE: GuardPlant = {
	id: 'norway-spruce',
	standIn: { height: 18, aspect: 0.3, leaf: [0.1, 0.24, 0.1], bark: [0.26, 0.18, 0.13] },
};
/** The atmosphere valley's pine: a Norway spruce with its crown a little under half as wide as tall. */
export const ATMOSPHERE_SPRUCE: GuardPlant = {
	id: 'norway-spruce',
	standIn: { height: 15, aspect: 0.45, leaf: [0.08, 0.2, 0.09], bark: [0.26, 0.18, 0.13] },
};
/** The island's umbrella pine: a tall bare red trunk under a wide flat dark crown. */
export const ISLAND_STONE_PINE: GuardPlant = {
	id: 'stone-pine',
	standIn: { height: 13, aspect: 1, leaf: [0.035, 0.085, 0.03], bark: [0.3, 0.14, 0.08] },
};
/** The island's olive: a short gnarled trunk under fine silver-green leaves. */
export const ISLAND_OLIVE: GuardPlant = {
	id: 'olive',
	standIn: { height: 6, aspect: 1, leaf: [0.13, 0.17, 0.1], bark: [0.22, 0.18, 0.14] },
};
/** The island's holm oak: a round dark crown, full to the ground. */
export const ISLAND_HOLM_OAK: GuardPlant = {
	id: 'holm-oak',
	standIn: { height: 11, aspect: 0.8, leaf: [0.04, 0.085, 0.028], bark: [0.14, 0.11, 0.08] },
};
/** The island's oleander: a low rounded lane shrub. */
export const ISLAND_OLEANDER: GuardPlant = {
	id: 'oleander',
	standIn: { height: 1.5, aspect: 1, leaf: [0.15, 0.3, 0.1], bark: [0.22, 0.18, 0.13] },
};
/** The stand-in Creek grew a species at: its height, its crown's width about its trunk, and its colours. */
export function creekStandIn(species: CreekSpecies): StandInLook {
	return {
		height: species.height,
		aspect: (2 * species.crown) / species.height,
		leaf: species.leaf,
		bark: species.bark,
	};
}

/** Creek's species as stand-ins, each at its own size and in its own colours. */
export const CREEK_STAND_INS: readonly GuardPlant[] = CREEK_SPECIES.map((species) => ({
	id: species.id,
	standIn: creekStandIn(species),
}));

/** The guard set, one entry per scene and seed. */
export const GUARD_STAND_INS: readonly GuardSet[] = [
	{ scene: 'contact-shadows', seed: 5, plants: [CONTACT_SHADOWS_PINE, CONTACT_SHADOWS_GRASS] },
	{ scene: 'light-shafts', seed: 11, plants: [LIGHT_SHAFTS_SPRUCE] },
	{ scene: 'atmosphere', seed: 11, variants: 3, plants: [ATMOSPHERE_SPRUCE] },
	{
		scene: 'island',
		seed: 17,
		plants: [ISLAND_STONE_PINE, ISLAND_OLIVE, ISLAND_HOLM_OAK],
	},
	{ scene: 'island', seed: 23, plants: [ISLAND_OLEANDER] },
	{ scene: 'creek', seed: 7, variants: 4, plants: CREEK_STAND_INS },
];

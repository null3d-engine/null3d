// The stand-ins that the demo pages plant, as each page passes them to the plant core. A page
// imports its own entry from here, so the mesh-hash guard builds exactly the plants the page draws
// and the two cannot drift apart. The seeds are the pages' own.
import {
	SEED as CREEK_SEED,
	SPECIES as CREEK_SPECIES,
	VARIANTS as CREEK_VARIANTS,
	type CreekSpecies,
} from '../showcase/creek/species';

/**
 * The sparse level that the demos growing plants through the add-on pass unless they set their
 * own: they open at the sparsest form the species allows, on every device, so a scene loads light
 * and a reader adds density from there. The ruling is not the device rule — a desktop opens sparse
 * too. A page that grows its own plants passes this beside the other options.
 */
export const DEMO_SPARSENESS = 1;

/**
 * The size and colours a stand-in is grown at, shaped as the plant core's `StandInOptions` takes
 * them. It is declared here rather than imported so this module stays free of the add-on's index,
 * which loads the engine; a page's call to `plantSpecies` checks the same shape against the core.
 */
export interface StandInLook {
	readonly height?: number | { readonly mean: number; readonly spread: number };
	readonly aspect?: number;
	readonly dbh?: number;
	readonly leaf?: readonly [number, number, number];
	readonly bark?: readonly [number, number, number];
	readonly variants?: number;
}

/** One plant a page stands: the species id and the stand-in the page names. */
export interface PagePlantStandIn {
	readonly id: string;
	readonly standIn: StandInLook;
}

/** One page's planted stand-ins, the seed it grows them with, and its variant count where it names one. */
export interface PageStandIns {
	readonly page: string;
	readonly seed: number;
	readonly variants?: number;
	readonly plants: readonly PagePlantStandIn[];
}

/** The island's umbrella pine: a tall bare red trunk under a wide flat dark crown. */
export const ISLAND_STONE_PINE: PagePlantStandIn = {
	id: 'stone-pine',
	standIn: { height: 13, aspect: 1, leaf: [0.035, 0.085, 0.03], bark: [0.3, 0.14, 0.08] },
};
/** The island's olive: a short gnarled trunk under fine silver-green leaves. */
export const ISLAND_OLIVE: PagePlantStandIn = {
	id: 'olive',
	standIn: { height: 6, aspect: 1, leaf: [0.13, 0.17, 0.1], bark: [0.22, 0.18, 0.14] },
};
/** The island's holm oak: a round dark crown, full to the ground. */
export const ISLAND_HOLM_OAK: PagePlantStandIn = {
	id: 'holm-oak',
	standIn: { height: 11, aspect: 0.8, leaf: [0.04, 0.085, 0.028], bark: [0.14, 0.11, 0.08] },
};
/** The island's oleander: a low rounded lane shrub. */
export const ISLAND_OLEANDER: PagePlantStandIn = {
	id: 'oleander',
	standIn: { height: 1.5, aspect: 1, leaf: [0.15, 0.3, 0.1], bark: [0.22, 0.18, 0.13] },
};
/** The stand-in the valley grows a species at: its height, its crown's width about its trunk, and its colours. */
export function creekStandIn(species: CreekSpecies): StandInLook {
	return {
		height: species.height,
		aspect: (2 * species.crown) / species.height,
		leaf: species.leaf,
		bark: species.bark,
	};
}

/** Creek's species as stand-ins, each at its own size and in its own colours. */
export const CREEK_STAND_INS: readonly PagePlantStandIn[] = CREEK_SPECIES.map((species) => ({
	id: species.id,
	standIn: creekStandIn(species),
}));

/** Every page's stand-ins, one entry per seed the page grows them with. */
export const PAGE_STAND_INS: readonly PageStandIns[] = [
	{
		page: 'island',
		seed: 17,
		plants: [ISLAND_STONE_PINE, ISLAND_OLIVE, ISLAND_HOLM_OAK],
	},
	{ page: 'island', seed: 23, plants: [ISLAND_OLEANDER] },
	{ page: 'creek', seed: CREEK_SEED, variants: CREEK_VARIANTS, plants: CREEK_STAND_INS },
];

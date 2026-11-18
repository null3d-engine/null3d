// The stand-ins that the demo pages plant, as each page passes them to the plant core. A page
// imports its own entry from here, so the mesh-hash guard builds exactly the plants the page draws
// and the two cannot drift apart. The seeds are the pages' own.

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

/** Every page's stand-ins, one entry per seed the page grows them with. */
export const PAGE_STAND_INS: readonly PageStandIns[] = [];

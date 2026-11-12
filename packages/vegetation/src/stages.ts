// The contracts between the generator's stages: what each stage function takes and gives. The
// orchestrator in generate.ts calls the stages in order, and each module fills its own stage behind
// these types: the growers (grow/), the shoot instancer and the crown light (leaf/, crown/), the wind
// records (wind/), the meshers and the card levels (wood/, lod/) and the far bake (lod/impostor.ts).
import type { MeshArrays, ShootRows, SpeciesKitData } from './asset';
import type { MacroSkeleton } from './core/graph';
import type { Species } from './core/record';
import type { Detail, Season, Vec3 } from './core/types';

/**
 * What a grower takes: the record, the seed, the variant and the season.
 *
 * @category api/vegetation
 */
export interface GrowInput {
	/** The species record. */
	readonly record: Species;
	/** The scene's seed. */
	readonly seed: number;
	/** The variant's index. */
	readonly variant: number;
	/** The season the plant grows for. */
	readonly season: Season;
}

/**
 * The crown's light after the shoots attach: a grid of sky visibility that the shoot rows and the
 * wood's vertices read.
 *
 * @category api/vegetation
 */
export interface CrownLight {
	/** Cells along x, y and z. */
	readonly cells: readonly [number, number, number];
	/** The grid's lowest corner in plant space. */
	readonly min: Vec3;
	/** A cell's edge in metres. */
	readonly cell: number;
	/** Sky visibility per cell, 0 to 1: x fastest, then y, then z. */
	readonly sky: Float32Array;
}

/**
 * What the dressing stages take: the grown skeleton and the kit.
 *
 * @category api/vegetation
 */
export interface DressInput extends GrowInput {
	/** The species' kit. */
	readonly kit: SpeciesKitData;
	/** The grown skeleton. */
	readonly skeleton: MacroSkeleton;
	/**
	 * How much simpler than grown the plant is, from 0 to 1: fewer and larger shoot rows, and wood
	 * of fewer rings and sides. 0 when not given. The skeleton is already pruned for it.
	 */
	readonly coarseness?: number;
	/**
	 * How far the wood's own sections are thinned, from 0 to 1: 0 is the level's own rings and
	 * sides, and 1 a few flat-sided runs with square ends. Absent or 0 meshes as the level does.
	 * It changes no vertex's place along its axis, only how many rings and sides the axis draws.
	 */
	readonly sections?: number;
	/**
	 * The share of a card level's own card rows to keep, from 0.05 to 1: 1 keeps the level's own
	 * rows and the cards' own size, and below 1 thins the rows by the level's rule, so the kept
	 * cards grow to hold the crown. A review redraw uses it to measure what the cards buy.
	 */
	readonly cards?: number;
	/**
	 * The light of the crown as grown, which a sky-prune line reads at every coarseness, so a
	 * coarser plant prunes the shoots its full crown leaves in the dark and the light is found once.
	 * Absent, the prune lights the crown of the rows it is given.
	 */
	readonly pruneLight?: CrownLight;
}

/**
 * What the meshing stages take: the dressed variant.
 *
 * @category api/vegetation
 */
export interface MeshInput extends DressInput {
	/** The shoot rows. */
	readonly rows: ShootRows;
	/** The crown's light. */
	readonly crown: CrownLight;
	/** The mesh tier. */
	readonly detail: Detail;
}

/**
 * A level that a mesher builds: 0 for real geometry, 1 and 2 for the card levels.
 *
 * @category api/vegetation
 */
export type MeshLevel = 0 | 1 | 2;

/**
 * The card atlas that the kit stage bakes from the shoot prototypes on the CPU.
 *
 * @category api/vegetation
 */
export interface CardAtlas {
	/** Texels a side. */
	readonly size: number;
	/** Colour with coverage in alpha, two layers of size by size texels: front faces, then back faces. */
	readonly color: Uint8Array;
	/** Normal, depth and thickness, in the same two layers. */
	readonly surface: Uint8Array;
}

/**
 * What the far bake makes in a job worker: the impostor atlases of one variant, from its first card
 * level, ready for the impostors add-on's cards.
 *
 * @category api/vegetation
 */
export interface FarBake {
	/** Views across the octahedral grid. */
	readonly views: number;
	/** Texels a view. */
	readonly texels: number;
	/** The colour atlas, sRGB with coverage in alpha, four bytes a texel. */
	readonly color: Uint8Array;
	/** The surface atlas: normal, depth and coverage, four bytes a texel. */
	readonly surface: Uint8Array;
	/** The card's width and height at scale 1, in metres. */
	readonly size: readonly [number, number];
	/** How many times taller a view's picture is than the card's height. */
	readonly room: number;
	/** The plant's depth along a view, in metres. */
	readonly depth: number;
}

/** The grown parts that the mesh stage hands on, before quantisation. */
export type LevelMeshes = Partial<Record<'wood' | 'foliage' | 'cards' | 'extras', MeshArrays>>;

// The contracts between the generator's stages: what each stage function takes and gives. The
// orchestrator in generate.ts calls the stages in order, and each module fills its own stage behind
// these types: the growers (grow/), the shoot instancer and the crown light (leaf/, crown/), the wind
// records (wind/), the meshers and the card levels (wood/, lod/) and the far bake (lod/impostor.ts).
import type { MeshArrays, ShootRows, SpeciesKitData } from './asset';
import type { MacroSkeleton } from './core/graph';
import type { Species } from './core/record';
import type { Detail, Season, Vec3 } from './core/types';
import type { CuttingOptions } from './cutting';

/**
 * What a growth is asked for, apart from its seed, its variant and its season: the three options a
 * page sets on every species, each at its default when the page leaves it out.
 *
 * @category api/vegetation
 */
export interface GrowRequest {
	/** How far the plant has grown, from 0 to 1: 0 grows nothing, 1 the full-grown plant. */
	readonly maturity: number;
	/** How much foliage and how many branches the plant gives up, from 0 to 1. */
	readonly sparse: number;
	/** The most triangles one copy of the plant may draw, or absent for the record's own levels. */
	readonly maxTriangles?: number;
}

/**
 * The form a plan draws the foliage of one level in.
 *
 * @category api/vegetation
 */
export type FoliageForm = 'piece' | 'cards' | 'clump-card';

/**
 * What one growth's requested state costs, worked out as numbers before any geometry: the plan a
 * grower builds only what the plan allows, so nothing is grown and then cut.
 *
 * @category api/vegetation
 */
export interface DetailPlan {
	/** The plant's age in model years: maturity × the record's full age. */
	readonly age: number;
	/** The deepest wood order the plant grows. */
	readonly finestOrder: number;
	/** The expected elements of each order at this age and sparseness. */
	readonly expected: readonly number[];
	/** The sides each order's wood tube draws, the floors stepping down with the maximum. */
	readonly tubeSides: readonly number[];
	/** The foliage form of each level, and the share of it this plan draws, blended over a band. */
	readonly foliage: readonly { readonly form: FoliageForm; readonly blend: number }[];
	/** The triangles priced to each part. */
	readonly triangles: Readonly<
		Record<'trunk' | 'limbs' | 'branches' | 'twigs' | 'foliage' | 'fruit', number>
	>;
	/** How far the acorns have come, 0 to 1, from the record's fruiting maturity. */
	readonly fruit: number;
	/** How far the catkins have come, 0 to 1, in the flowering season. */
	readonly flowers: number;
	/** The rank cut of each order: an element whose keyed rank is under it is kept. */
	readonly rankCut: readonly number[];
}

/**
 * What a grower takes: the record, the seed, the variant and the season, and the request and plan a
 * species that grows straight to the asked state reads.
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
	/**
	 * What the growth is asked for. The generator passes it to every grower; a model that grows to
	 * its record alone ignores it.
	 */
	readonly request?: GrowRequest;
	/** The plan the growth builds to. A model that plans as it builds leaves it out. */
	readonly plan?: DetailPlan;
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
	 * How finely the wood is drawn, from 0 to 1: it takes longer edges, so fewer rings and sides.
	 * The skeleton and the shoot rows stay as grown. 0 when not given.
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
	 * How a card joins the plant when its branch is not drawn at the level: `remove` drops the card,
	 * `branch` draws the branch every card stands on, and `twig` keeps the card and draws it a twig
	 * to the nearest drawn branch. Absent, the level keeps every card and draws the branch under each
	 * card that reaches neither drawn wood nor a joined card.
	 */
	readonly cardJoin?: 'remove' | 'branch' | 'twig';
	/**
	 * The light of the crown as grown, which a sky-prune line reads at every coarseness, so a
	 * coarser plant prunes the shoots its full crown leaves in the dark and the light is found once.
	 * Absent, the prune lights the crown of the rows it is given.
	 */
	readonly pruneLight?: CrownLight;
	/** The cutting this variant is, where it is a piece rather than a whole plant. */
	readonly cutting?: CuttingOptions;
	/**
	 * The plant as grown, on a plant that sparseness took foliage from: its skeleton and its rows
	 * before the thinning. They keep the number each site and stem had as grown, so a choice keyed
	 * on one falls the same way on the sparser plant. Absent on a plant as grown.
	 */
	readonly grown?: { readonly skeleton: MacroSkeleton; readonly rows: ShootRows };
	/**
	 * The share of each extra's sites that draws it, from 0 to 1, where a triangle maximum thins the
	 * extras. A site that draws at a share draws at every larger one. Every site when absent.
	 */
	readonly extrasShare?: number;
	/**
	 * The planned model's fruiting ramp, from 0 to 1: the share of the fruit's own sites that draws a
	 * fruit or a cone, from a plan read below the maturity it fruits at to none, and all of it at the
	 * ramp's end. A site that draws at a share draws at every larger one. Absent on a record that does
	 * not plan its growth, which draws its extras by season and site alone.
	 */
	readonly fruitShare?: number;
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

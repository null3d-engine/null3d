// What the generator returns: one plant's parts at each detail level, its wind data, the crown's
// shape and bounds, and the source that an impostor bake draws. The asset holds arrays and a small
// record, so it crosses to a worker, becomes engine meshes and feeds a bake without a copy of its
// own.
import type { PartArrays } from './builder';
import type { CrownData } from './crown';
import type { Species } from './species';

/**
 * The name of a part, which tells a material what it draws.
 * @category api/vegetation
 */
export type PartName = 'wood' | 'leaves' | 'frond' | 'blade' | 'flower';

/**
 * One part of one level: its name and the arrays that the engine's `geometry.fromArrays` reads.
 * @category api/vegetation
 */
export interface PlantPart {
	/** What the part is. */
	readonly name: PartName;
	/** The part's vertex arrays. */
	readonly arrays: PartArrays;
}

/**
 * One detail level: its parts, and the distance that its surface misses the base by.
 * @category api/vegetation
 */
export interface PlantLevel {
	/** The level's parts, most detailed first. */
	readonly parts: readonly PlantPart[];
	/** The largest distance that this level's surface lies from the base level's, in meters. */
	readonly error: number;
	/** The level's triangles, over every part. */
	readonly triangles: number;
	/** The level's vertices, over every part. */
	readonly vertices: number;
	/** The level's bytes of vertex arrays. */
	readonly bytes: number;
}

/**
 * The wind data: one record for each branch, which the leaf and bark materials read. A record holds
 * a pivot, an axis, the parent's index, the branch's stiffness, its flutter and its length. The
 * vertex colors name a record with 8 bits, so a plant keeps at most 255.
 * @category api/vegetation
 */
export interface WindData {
	/**
	 * The branch records, 16 floats each: the pivot's x, y and z, the axis's x, y and z, the
	 * parent's index, the stiffness, the flutter amplitude, the flutter frequency, the branch level,
	 * the branch's length, and four floats that wait for a later use.
	 */
	readonly pivots: Float32Array;
	/** The floats that one branch record holds. */
	readonly stride: number;
	/** The records that the array holds. */
	readonly branches: number;
}

/**
 * What an impostor bake draws for this plant, and what the card shows at the hand-over.
 * @category api/vegetation
 */
export interface ImpostorSource {
	/** The level's index that the bake draws. */
	readonly level: number;
	/** The bounds of the drawn level. */
	readonly bounds: CrownData;
	/** The height that the card turns about, in meters. */
	readonly pivot: number;
	/** The leaf tint that the bake writes into the views, linear 0 to 1. */
	readonly tint: readonly [number, number, number];
}

/**
 * What the plant costs, for the budgets and the stats overlay.
 * @category api/vegetation
 */
export interface PlantStats {
	/** The vertices of every level. */
	readonly vertices: number;
	/** The triangles of every level. */
	readonly triangles: number;
	/** The bytes of every level's vertex arrays. */
	readonly bytes: number;
	/** How long the plant took to grow, in milliseconds. */
	readonly milliseconds: number;
}

/**
 * One grown plant: every detail level, the wind data, the crown, and the source that a far card
 * bakes from. The same species, seed and variant give the same asset on every device.
 *
 * @category api/vegetation
 */
export interface PlantAsset {
	/** The record that grew the plant. */
	readonly species: Species;
	/** The variant's index. */
	readonly variant: number;
	/** The detail levels, most detailed first. The first level's error is 0. */
	readonly levels: readonly PlantLevel[];
	/** The branch records that the wind reads. */
	readonly wind: WindData;
	/** The crown's shape and bounds. */
	readonly crown: CrownData;
	/** What a far card bakes from. */
	readonly impostorSource: ImpostorSource;
	/** The plant's cost. */
	readonly stats: PlantStats;
}

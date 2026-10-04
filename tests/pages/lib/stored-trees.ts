// What the stored trees sketch posts, for the sketch, its page and the test that reads it.

/** How the hits of seeded rays compared between a model without stored trees and one with them. */
export interface StoredTreeResults {
	rays: number;
	/** The hits of every ray, through the copy without stored trees. */
	hits: number;
	/** Rays whose hits differ between the copies. */
	mismatches: number;
	/** The first rays whose hits differ, described. */
	examples: string[];
}

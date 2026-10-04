// What the raycast sketch posts, for the sketch, its page and the test that reads it.

/** How null3D's queries compared with three.js's Raycaster over the sketch's seeded rays. */
export interface RaycastResults {
	rays: number;
	closestHits: number;
	allHits: number;
	mismatches: number;
	/** The first mismatches, described. */
	examples: string[];
	overlapChecks: number;
	overlapMisses: number;
	batchRays: number;
	batchHits: number;
	batchMismatches: number;
	/** Hit points in front of the camera that went to the screen and back as a ray. */
	projections: number;
	/** The farthest such a ray passed from its point, in meters. */
	projectionError: number;
}

// Land made in code for any demo: rings about the middle that widen with distance, so the ground is
// fine where the camera stands and coarse at the horizon. The demo gives each point's height and
// color.
const TURN = Math.PI * 2;

/** How a demo shapes its land: the reach, the grid, and each point's height and color. */
export interface RingLand {
	/** How far out the land reaches, in meters. */
	readonly far: number;
	/** The rings from the middle out, and the points around each ring. */
	readonly rings: number;
	readonly around: number;
	/** The power that spaces the rings: above 1 packs them toward the middle. */
	readonly spacing: number;
	/** The meters that one repeat of the ground's texture covers. */
	readonly tile: number;
	/** The land's height at a point. */
	readonly height: (x: number, z: number) => number;
	/** The land's linear color at a point that lies `d` meters from the middle. */
	readonly color: (x: number, z: number, d: number) => readonly [number, number, number];
}

/** The land's arrays for geometry.fromArrays, with its triangles facing up. */
export function ringLandArrays(land: RingLand) {
	const { far, rings, around, spacing, tile, height, color } = land;
	const positions: number[] = [];
	const colors: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rings; r++)
		for (let c = 0; c <= around; c++) {
			const [a, d] = [(c / around) * TURN, far * (r / rings) ** spacing];
			const [x, z] = [Math.cos(a) * d, Math.sin(a) * d];
			positions.push(x, height(x, z), z);
			uvs.push(x / tile, z / tile);
			colors.push(...color(x, z, d));
			const i = r * (around + 1) + c;
			if (r < rings && c < around)
				indices.push(i, i + 1, i + around + 1, i + 1, i + around + 2, i + around + 1);
		}
	return { positions, colors, uvs, indices, computeNormals: true };
}

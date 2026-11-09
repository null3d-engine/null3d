// Test helpers for leaf coverage: a coverage mask read from the runs of covered texels that the
// textures tool writes beside a manifest, and the overlap of a mesh's texture footprint with the
// mask. Only the leaf tests import this file.

/** A square coverage mask, row 0 at v = 0. */
export interface CoverageMask {
	readonly size: number;
	readonly covered: Uint8Array;
}

/** Runs of covered texels per row, end exclusive, as the textures tool writes them. */
export interface CoverageRuns {
	readonly size: number;
	readonly rows: readonly (readonly number[])[];
}

/**
 * A mask from runs of covered texels.
 *
 * @param runs The runs.
 * @returns The mask.
 */
export function maskFromRuns(runs: CoverageRuns): CoverageMask {
	const covered = new Uint8Array(runs.size * runs.size);
	runs.rows.forEach((row, r) => {
		for (let i = 0; i < row.length; i += 2)
			covered.fill(1, r * runs.size + (row[i] as number), r * runs.size + (row[i + 1] as number));
	});
	return { size: runs.size, covered };
}

/**
 * Covered texels of a set of triangles in texture coordinates, sampled at texel centres.
 *
 * @param size Texels a side.
 * @param uvs Two per vertex.
 * @param indices Three per triangle.
 * @returns The mask.
 */
export function rasteriseTriangles(
	size: number,
	uvs: ArrayLike<number>,
	indices: ArrayLike<number>,
): CoverageMask {
	const covered = new Uint8Array(size * size);
	for (let t = 0; t < indices.length; t += 3) {
		const a = indices[t] as number;
		const b = indices[t + 1] as number;
		const c = indices[t + 2] as number;
		const ax = (uvs[a * 2] as number) * size;
		const ay = (uvs[a * 2 + 1] as number) * size;
		const bx = (uvs[b * 2] as number) * size;
		const by = (uvs[b * 2 + 1] as number) * size;
		const cx = (uvs[c * 2] as number) * size;
		const cy = (uvs[c * 2 + 1] as number) * size;
		const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		if (area === 0) continue;
		const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
		const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
		const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
		const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5;
				const py = y + 0.5;
				const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
				const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
				const w2 = 1 - w0 - w1;
				if (w0 >= 0 && w1 >= 0 && w2 >= 0) covered[y * size + x] = 1;
			}
	}
	return { size, covered };
}

/**
 * Intersection over union of two masks of one size.
 *
 * @param a The first mask.
 * @param b The second mask.
 * @returns Their overlap, 0 to 1.
 */
export function intersectionOverUnion(a: CoverageMask, b: CoverageMask): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.covered.length; i++) {
		const x = a.covered[i] as number;
		const y = b.covered[i] as number;
		both += x & y;
		either += x | y;
	}
	return either === 0 ? 1 : both / either;
}

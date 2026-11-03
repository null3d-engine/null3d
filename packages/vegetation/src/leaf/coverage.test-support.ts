// Test helpers for leaf coverage: a coverage mask read from runs of covered texels, its contour
// traced and simplified as the textures tool writes a manifest's outline, and the overlap of a
// mesh's texture footprint with the mask. Only the leaf and card tests import this file.

/** A square coverage mask, row 0 at v = 0. */
export interface CoverageMask {
	readonly size: number;
	readonly covered: Uint8Array;
}

/** Runs of covered texels per row, as the fixtures hold them. */
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

/** The perpendicular distance of point p from the line through a and b. */
function lineDistance(
	pu: number,
	pv: number,
	au: number,
	av: number,
	bu: number,
	bv: number,
): number {
	const du = bu - au;
	const dv = bv - av;
	const length = Math.sqrt(du * du + dv * dv);
	if (length === 0) return Math.sqrt((pu - au) ** 2 + (pv - av) ** 2);
	return Math.abs(du * (av - pv) - dv * (au - pu)) / length;
}

/** Douglas-Peucker on an open chain, keeping both ends. */
function simplifyChain(points: readonly number[], tolerance: number): number[] {
	const n = points.length / 2;
	const keep = new Uint8Array(n);
	keep[0] = 1;
	keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length > 0) {
		const [a, b] = stack.pop() as [number, number];
		let worst = -1;
		let far = 0;
		for (let i = a + 1; i < b; i++) {
			const d = lineDistance(
				points[i * 2] as number,
				points[i * 2 + 1] as number,
				points[a * 2] as number,
				points[a * 2 + 1] as number,
				points[b * 2] as number,
				points[b * 2 + 1] as number,
			);
			if (d > far) {
				far = d;
				worst = i;
			}
		}
		if (worst >= 0 && far > tolerance) {
			keep[worst] = 1;
			stack.push([a, worst], [worst, b]);
		}
	}
	const out: number[] = [];
	for (let i = 0; i < n; i++)
		if (keep[i]) out.push(points[i * 2] as number, points[i * 2 + 1] as number);
	return out;
}

/**
 * The mask's largest contour in texture coordinates, counter-clockwise, simplified to at most
 * `limit` points by raising the Douglas-Peucker tolerance: what the textures tool writes as a
 * manifest's outline.
 *
 * @param mask The mask.
 * @param limit The most points to keep.
 * @returns The outline, u then v.
 */
export function traceOutline(mask: CoverageMask, limit: number): number[] {
	const { size, covered } = mask;
	const at = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < size && y < size ? (covered[y * size + x] as number) : 0;
	// Directed boundary edges between texel corners, interior on the left, keyed by their start.
	const next = new Map<number, number[]>();
	const key = (x: number, y: number) => y * (size + 1) + x;
	const add = (x0: number, y0: number, x1: number, y1: number) => {
		const list = next.get(key(x0, y0)) ?? [];
		list.push(key(x1, y1));
		next.set(key(x0, y0), list);
	};
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			if (!at(x, y)) continue;
			if (!at(x, y - 1)) add(x, y, x + 1, y);
			if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
			if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
			if (!at(x - 1, y)) add(x, y + 1, x, y);
		}
	let best: number[] = [];
	while (next.size > 0) {
		const start = next.keys().next().value as number;
		const loop: number[] = [];
		let current = start;
		for (;;) {
			const list = next.get(current);
			if (!list || list.length === 0) break;
			const to = list.pop() as number;
			if (list.length === 0) next.delete(current);
			loop.push(current % (size + 1), Math.floor(current / (size + 1)));
			current = to;
			if (current === start) break;
		}
		if (loop.length > best.length) best = loop;
	}
	// Corner points to texture coordinates; then the chain split at its far point and simplified.
	const points = best.map((value) => value / size);
	let tolerance = 0.25 / size;
	for (;;) {
		const n = points.length / 2;
		const half = Math.floor(n / 2);
		const first = simplifyChain(points.slice(0, half * 2 + 2), tolerance);
		const second = simplifyChain(
			[...points.slice(half * 2), points[0] as number, points[1] as number],
			tolerance,
		);
		const joined = [...first.slice(0, -2), ...second.slice(0, -2)];
		if (joined.length / 2 <= limit) return joined;
		tolerance *= 1.15;
	}
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

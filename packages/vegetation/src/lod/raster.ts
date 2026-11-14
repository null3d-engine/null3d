// A small CPU rasteriser for the card bake: triangles already projected to a target's pixels, each
// pixel's centre tested against the triangle, depth tested, its attributes interpolated, and a
// fragment function that keeps or discards it. It uses only the four operations, so a bake gives
// the same pixels on every device. Rows count up from the bottom, as a texture's v does.

/**
 * A raster target: its size, and a depth per pixel that starts far.
 *
 * @category api/vegetation
 */
export interface RasterTarget {
	readonly width: number;
	readonly height: number;
	/** Depth per pixel; smaller is nearer. */
	readonly depth: Float32Array;
}

/**
 * A target of a size, every pixel far.
 *
 * @param width Pixels across.
 * @param height Pixels up.
 * @returns The target.
 * @category api/vegetation
 */
export function rasterTarget(width: number, height: number): RasterTarget {
	return { width, height, depth: new Float32Array(width * height).fill(Infinity) };
}

/**
 * The fragment of a pixel that a triangle covers: the triangle, its pixel, its depth and the
 * weights of its three corners.
 *
 * @category api/vegetation
 */
export interface Fragment {
	triangle: number;
	x: number;
	y: number;
	depth: number;
	/** Weights of the triangle's first, second and third corners, summing to 1. */
	w0: number;
	w1: number;
	w2: number;
}

/**
 * Draws triangles into a target. Each corner holds x and y in pixels (the centre of pixel i at
 * i + 0.5) and a depth. A pixel whose centre the triangle covers, nearer than what the pixel holds,
 * calls `shade`; a fragment that `shade` keeps (returns true) writes its depth. Shared edges follow
 * the top-left rule, so two triangles never both draw one pixel.
 *
 * @param target The target.
 * @param points Three per corner: x, y, depth.
 * @param indices Three per triangle.
 * @param shade Keeps or discards a fragment, and writes its other values.
 * @category api/vegetation
 */
export function rasterise(
	target: RasterTarget,
	points: ArrayLike<number>,
	indices: ArrayLike<number>,
	shade: (fragment: Fragment) => boolean,
): void {
	const { width, height, depth } = target;
	const fragment: Fragment = { triangle: 0, x: 0, y: 0, depth: 0, w0: 0, w1: 0, w2: 0 };
	for (let t = 0; t < indices.length; t += 3) {
		const a = (indices[t] as number) * 3;
		let b = (indices[t + 1] as number) * 3;
		let c = (indices[t + 2] as number) * 3;
		const ax = points[a] as number;
		const ay = points[a + 1] as number;
		let bx = points[b] as number;
		let by = points[b + 1] as number;
		let cx = points[c] as number;
		let cy = points[c + 1] as number;
		let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		if (area === 0 || !Number.isFinite(area)) continue;
		// Wind every triangle one way, so one edge rule serves both faces.
		let swapped = false;
		if (area < 0) {
			[b, c] = [c, b];
			[bx, cx] = [cx, bx];
			[by, cy] = [cy, by];
			area = -area;
			swapped = true;
		}
		const az = points[a + 2] as number;
		const bz = points[b + 2] as number;
		const cz = points[c + 2] as number;
		const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
		const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
		const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
		const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
		// The top-left rule: a pixel on an edge belongs to the triangle only for a top or left edge.
		const bias0 = edgeBias(bx, by, cx, cy);
		const bias1 = edgeBias(cx, cy, ax, ay);
		const bias2 = edgeBias(ax, ay, bx, by);
		// Each edge's sum steps by a constant from one pixel to the next along a row.
		const step0 = -(cy - by);
		const step1 = -(ay - cy);
		const step2 = -(by - ay);
		for (let y = y0; y <= y1; y++) {
			const py = y + 0.5;
			const px0 = x0 + 0.5;
			let e0 = (cx - bx) * (py - by) - (cy - by) * (px0 - bx);
			let e1 = (ax - cx) * (py - cy) - (ay - cy) * (px0 - cx);
			let e2 = (bx - ax) * (py - ay) - (by - ay) * (px0 - ax);
			for (let x = x0; x <= x1; x++, e0 += step0, e1 += step1, e2 += step2) {
				if (e0 < bias0 || e1 < bias1 || e2 < bias2) continue;
				const w0 = e0 / area;
				const w1 = e1 / area;
				const w2 = 1 - w0 - w1;
				const z = w0 * az + w1 * bz + w2 * cz;
				const at = y * width + x;
				if (z >= (depth[at] as number)) continue;
				fragment.triangle = t / 3;
				fragment.x = x;
				fragment.y = y;
				fragment.depth = z;
				fragment.w0 = w0;
				fragment.w1 = swapped ? w2 : w1;
				fragment.w2 = swapped ? w1 : w2;
				if (shade(fragment)) depth[at] = z;
			}
		}
	}
}

/** Zero for an edge that owns its pixels (top or left of a counter-clockwise triangle), else the smallest step past it. */
function edgeBias(x0: number, y0: number, x1: number, y1: number): number {
	const top = y0 === y1 && x1 < x0;
	const left = y1 < y0;
	return top || left ? 0 : Number.MIN_VALUE;
}

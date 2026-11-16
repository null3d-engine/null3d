// The outline of a cut-out: the line where its coverage crosses a level, traced by marching
// squares between texel centres, then thinned to a few dozen points that keep its shape.
import type { Plane } from './image.ts';

/** A point in texels: x right, y down, texel centres at .5. */
export type Point = readonly [number, number];

/**
 * The closed loops where `coverage` crosses `level`, each a list of points. A ring of empty texels
 * round the plane closes every loop.
 */
export function traceLoops(coverage: Plane, level: number): Point[][] {
	const { width: w, height: h, data } = coverage;
	// Samples on a grid one texel larger on each side, so the border reads as empty.
	const gw = w + 2;
	const gh = h + 2;
	const value = (gx: number, gy: number) => {
		const x = gx - 1;
		const y = gy - 1;
		if (x < 0 || y < 0 || x >= w || y >= h) return 0;
		return data[y * w + x] as number;
	};
	// Each crossing sits on a grid edge: horizontal edges keyed 2·(gy·gw + gx), vertical edges +1.
	const point = (key: number): Point => {
		const id = key >> 1;
		const gx = id % gw;
		const gy = (id - gx) / gw;
		const a = value(gx, gy);
		const b = key & 1 ? value(gx, gy + 1) : value(gx + 1, gy);
		const t = (level - a) / (b - a);
		const x = key & 1 ? gx : gx + t;
		const y = key & 1 ? gy + t : gy;
		// Grid sample (gx, gy) is texel (gx − 1, gy − 1), whose centre is at gx − 0.5.
		return [x - 0.5, y - 0.5];
	};
	const next = new Map<number, number>();
	for (let gy = 0; gy < gh - 1; gy++)
		for (let gx = 0; gx < gw - 1; gx++) {
			const tl = value(gx, gy) >= level ? 1 : 0;
			const tr = value(gx + 1, gy) >= level ? 1 : 0;
			const br = value(gx + 1, gy + 1) >= level ? 1 : 0;
			const bl = value(gx, gy + 1) >= level ? 1 : 0;
			const code = tl | (tr << 1) | (br << 2) | (bl << 3);
			if (code === 0 || code === 15) continue;
			const top = 2 * (gy * gw + gx);
			const bottom = 2 * ((gy + 1) * gw + gx);
			const left = 2 * (gy * gw + gx) + 1;
			const right = 2 * (gy * gw + gx + 1) + 1;
			// Segments run with the covered side on the left as the picture shows it (y down), so
			// every loop turns the same way.
			const link = (from: number, to: number) => next.set(from, to);
			switch (code) {
				case 1:
					link(left, top);
					break;
				case 2:
					link(top, right);
					break;
				case 3:
					link(left, right);
					break;
				case 4:
					link(right, bottom);
					break;
				case 5: {
					const centre =
						(value(gx, gy) + value(gx + 1, gy) + value(gx + 1, gy + 1) + value(gx, gy + 1)) / 4;
					if (centre >= level) {
						link(left, bottom);
						link(right, top);
					} else {
						link(left, top);
						link(right, bottom);
					}
					break;
				}
				case 6:
					link(top, bottom);
					break;
				case 7:
					link(left, bottom);
					break;
				case 8:
					link(bottom, left);
					break;
				case 9:
					link(bottom, top);
					break;
				case 10: {
					const centre =
						(value(gx, gy) + value(gx + 1, gy) + value(gx + 1, gy + 1) + value(gx, gy + 1)) / 4;
					if (centre >= level) {
						link(top, left);
						link(bottom, right);
					} else {
						link(top, right);
						link(bottom, left);
					}
					break;
				}
				case 11:
					link(bottom, right);
					break;
				case 12:
					link(right, left);
					break;
				case 13:
					link(right, top);
					break;
				case 14:
					link(top, left);
					break;
			}
		}
	const loops: Point[][] = [];
	const seen = new Set<number>();
	for (const start of [...next.keys()].sort((a, b) => a - b)) {
		if (seen.has(start)) continue;
		const loop: Point[] = [];
		let key: number | undefined = start;
		while (key !== undefined && !seen.has(key)) {
			seen.add(key);
			loop.push(point(key));
			key = next.get(key);
		}
		if (loop.length >= 3) loops.push(loop);
	}
	return loops;
}

/** Twice the signed area of a loop, positive when it turns counter-clockwise with y up. */
export function signedArea(loop: readonly Point[]): number {
	let sum = 0;
	for (let i = 0; i < loop.length; i++) {
		const [x0, y0] = loop[i] as Point;
		const [x1, y1] = loop[(i + 1) % loop.length] as Point;
		sum += x0 * y1 - x1 * y0;
	}
	return sum;
}

/** The distance from a point to a segment. */
function segmentDistance(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = dx * dx + dy * dy;
	let t = length > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length : 0;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const x = a[0] + t * dx - p[0];
	const y = a[1] + t * dy - p[1];
	return Math.sqrt(x * x + y * y);
}

/** The indices that Douglas and Peucker's method keeps of an open line, within `tolerance`. */
function keep(
	points: readonly Point[],
	first: number,
	last: number,
	tolerance: number,
	out: Set<number>,
) {
	let worst = -1;
	let far = 0;
	for (let i = first + 1; i < last; i++) {
		const d = segmentDistance(points[i] as Point, points[first] as Point, points[last] as Point);
		if (d > far) {
			far = d;
			worst = i;
		}
	}
	if (worst < 0 || far <= tolerance) return;
	out.add(worst);
	keep(points, first, worst, tolerance, out);
	keep(points, worst, last, tolerance, out);
}

/** A closed loop thinned within `tolerance`, split at its first point and the point farthest from it. */
export function simplifyLoop(loop: readonly Point[], tolerance: number): Point[] {
	const start = loop[0] as Point;
	let far = 0;
	let split = 0;
	loop.forEach((p, i) => {
		const dx = p[0] - start[0];
		const dy = p[1] - start[1];
		const d = dx * dx + dy * dy;
		if (d > far) {
			far = d;
			split = i;
		}
	});
	const closed = [...loop, start];
	const kept = new Set<number>([0, split]);
	keep(closed, 0, split, tolerance, kept);
	keep(closed, split, loop.length, tolerance, kept);
	return [...kept].sort((a, b) => a - b).map((i) => loop[i] as Point);
}

/**
 * The loop thinned to at most `most` points, with the smallest tolerance that reaches it, and at
 * least `least` points where the loop holds that many.
 */
export function simplifyTo(loop: readonly Point[], least: number, most: number): Point[] {
	let low = 0;
	let high = 64;
	let best = simplifyLoop(loop, high);
	for (let step = 0; step < 40; step++) {
		const mid = (low + high) / 2;
		const thinned = simplifyLoop(loop, mid);
		if (thinned.length > most) low = mid;
		else {
			high = mid;
			best = thinned;
		}
	}
	if (best.length < least && loop.length >= least) {
		// Too coarse: thin less, keeping the most points within the cap.
		best = simplifyLoop(loop, low);
	}
	return best;
}

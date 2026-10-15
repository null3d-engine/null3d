// A check that a scene's own geometry does not overlap (owner, 14 October 2026): a demo builds its
// pieces so they meet exactly or leave a deliberate gap, never crossing or lying coplanar over one
// another, which z-fights and shimmers. `findOverlaps` tests every pair of triangles of the parts it
// is given: a crossing or a coplanar overlap is a fault, a shared edge or vertex is not.
//
// A deliberate intersection, such as a chimney sunk through a roof, is left out by naming the parts
// in `ignore`, so the check stays meaningful.
/** One built part: its triangles, as positions and an optional index list. */
export interface OverlapPart {
	name: string;
	positions: readonly number[];
	indices?: readonly number[];
}

/** One fault that the check found. */
export interface Overlap {
	a: string;
	b: string;
	at: [number, number, number];
	kind: 'cross' | 'coplanar';
}

export interface OverlapOptions {
	/** How close two surfaces may come before they count as touching, in meters. The default is 1e-4. */
	tolerance?: number;
	/** Pairs of part names that may touch on purpose, as `name|name`, either order. */
	ignore?: readonly string[];
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

interface Triangle {
	part: string;
	a: V3;
	b: V3;
	c: V3;
	min: V3;
	max: V3;
	normal: V3;
	plane: number;
}

/** The triangles of a part, from its positions and its indices or its plain triangle list. */
function trianglesOf(part: OverlapPart): Triangle[] {
	const p = part.positions;
	const at = (index: number): V3 => [
		p[index * 3] as number,
		p[index * 3 + 1] as number,
		p[index * 3 + 2] as number,
	];
	const indices =
		part.indices ?? p.map((_, index) => Math.floor(index / 3)).filter((_, i) => i % 3 === 0);
	const out: Triangle[] = [];
	for (let k = 0; k + 2 < indices.length; k += 3) {
		const a = at(indices[k] as number);
		const b = at(indices[k + 1] as number);
		const c = at(indices[k + 2] as number);
		const normal = cross(sub(b, a), sub(c, a));
		const size = length(normal);
		out.push({
			part: part.name,
			a,
			b,
			c,
			min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
			max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
			normal: size > 0 ? [normal[0] / size, normal[1] / size, normal[2] / size] : [0, 1, 0],
			plane: size > 0 ? dot([normal[0] / size, normal[1] / size, normal[2] / size], a) : 0,
		});
	}
	return out;
}

/** True when a segment from p0 to p1 crosses the triangle (a, b, c) strictly inside it. */
function segmentCrosses(p0: V3, p1: V3, a: V3, b: V3, c: V3, eps: number): boolean {
	const e1 = sub(b, a);
	const e2 = sub(c, a);
	const d = sub(p1, p0);
	const h = cross(d, e2);
	const det = dot(e1, h);
	if (Math.abs(det) < 1e-12) return false;
	const inv = 1 / det;
	const s = sub(p0, a);
	const u = dot(s, h) * inv;
	if (u <= eps || u >= 1 - eps) return false;
	const q = cross(s, e1);
	const v = dot(d, q) * inv;
	if (v <= eps || u + v >= 1 - eps) return false;
	const t = dot(e2, q) * inv;
	return t > eps && t < 1 - eps;
}

/** True when two coplanar triangles overlap over an area, not just along an edge or a point. */
function coplanarOverlap(x: Triangle, y: Triangle, eps: number): boolean {
	// Project to the plane's two widest axes, so the areas keep their size.
	const n = x.normal;
	const drop =
		Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2])
			? 0
			: Math.abs(n[1]) >= Math.abs(n[2])
				? 1
				: 2;
	const flat = (v: V3): [number, number] =>
		drop === 0 ? [v[1], v[2]] : drop === 1 ? [v[0], v[2]] : [v[0], v[1]];
	const one = [flat(x.a), flat(x.b), flat(x.c)];
	const two = [flat(y.a), flat(y.b), flat(y.c)];
	// The separating axis test over both triangles' edge normals: any axis with a gap means no
	// overlap. A shared edge gives a gap of zero, which does not count.
	for (const polygon of [one, two]) {
		for (let k = 0; k < 3; k++) {
			const p = polygon[k] as [number, number];
			const q = polygon[(k + 1) % 3] as [number, number];
			const axis: [number, number] = [-(q[1] - p[1]), q[0] - p[0]];
			const range = (points: [number, number][]): [number, number] => {
				let low = Infinity;
				let high = -Infinity;
				for (const point of points) {
					const value = axis[0] * point[0] + axis[1] * point[1];
					low = Math.min(low, value);
					high = Math.max(high, value);
				}
				return [low, high];
			};
			const [lo1, hi1] = range(one);
			const [lo2, hi2] = range(two);
			const overlap = Math.min(hi1, hi2) - Math.max(lo1, lo2);
			const scale = length([axis[0], axis[1], 0]) || 1;
			if (overlap <= eps * scale) return false;
		}
	}
	return true;
}

/**
 * Finds the overlapping triangles of the parts: a crossing pair, or a coplanar pair that shares an
 * area. A shared edge or vertex, which a seam has, is not an overlap. Part pairs named in `ignore`
 * may touch on purpose.
 */
export function findOverlaps(
	parts: readonly OverlapPart[],
	options: OverlapOptions = {},
): Overlap[] {
	const tol = options.tolerance ?? 1e-4;
	const ignore = new Set(
		(options.ignore ?? []).flatMap((pair) => [pair, pair.split('|').reverse().join('|')]),
	);
	const triangles = parts.flatMap(trianglesOf);
	const found: Overlap[] = [];
	for (let i = 0; i < triangles.length; i++) {
		const first = triangles[i] as Triangle;
		for (let j = i + 1; j < triangles.length; j++) {
			const second = triangles[j] as Triangle;
			if (ignore.has(`${first.part}|${second.part}`)) continue;
			// The broad phase: boxes that do not overlap cannot hold crossing triangles.
			if (
				first.max[0] <= second.min[0] - tol ||
				second.max[0] <= first.min[0] - tol ||
				first.max[1] <= second.min[1] - tol ||
				second.max[1] <= first.min[1] - tol ||
				first.max[2] <= second.min[2] - tol ||
				second.max[2] <= first.min[2] - tol
			)
				continue;
			const parallel = Math.abs(dot(first.normal, second.normal)) > 1 - 1e-6;
			if (parallel) {
				// Two faces on the one plane that look opposite ways have planes `d` and `-d`, so the
				// second plane is measured with its own normal's sign.
				const facing = dot(first.normal, second.normal) < 0 ? -1 : 1;
				if (Math.abs(first.plane - facing * second.plane) > tol) continue;
				if (coplanarOverlap(first, second, tol))
					found.push({ a: first.part, b: second.part, at: first.a, kind: 'coplanar' });
				continue;
			}
			const crosses =
				segmentCrosses(first.a, first.b, second.a, second.b, second.c, tol) ||
				segmentCrosses(first.b, first.c, second.a, second.b, second.c, tol) ||
				segmentCrosses(first.c, first.a, second.a, second.b, second.c, tol) ||
				segmentCrosses(second.a, second.b, first.a, first.b, first.c, tol) ||
				segmentCrosses(second.b, second.c, first.a, first.b, first.c, tol) ||
				segmentCrosses(second.c, second.a, first.a, first.b, first.c, tol);
			if (crosses) found.push({ a: first.part, b: second.part, at: first.a, kind: 'cross' });
		}
	}
	return found;
}

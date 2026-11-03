// Measures of the wood mesher's output for its tests: how far a child's first ring stands from its
// parent's triangles, how its `v` there differs from the parent's, and how far each ring's bark
// density strays from the record's. They read the written mesh, not the mesher's own sums, so a
// fault in the mesher's reasoning cannot hide in the measure.
import type { MeshArrays } from '../asset';
import type { WoodReport } from './wood-mesh';

/** The nearest point of a triangle to a point, and its barycentric weights. */
function nearestOnTriangle(
	p: readonly number[],
	a: readonly number[],
	b: readonly number[],
	c: readonly number[],
): { distance: number; wa: number; wb: number; wc: number } {
	// Ericson, Real-Time Collision Detection, 5.1.5.
	const sub = (x: readonly number[], y: readonly number[]) => [
		(x[0] as number) - (y[0] as number),
		(x[1] as number) - (y[1] as number),
		(x[2] as number) - (y[2] as number),
	];
	const dot = (x: readonly number[], y: readonly number[]) =>
		(x[0] as number) * (y[0] as number) +
		(x[1] as number) * (y[1] as number) +
		(x[2] as number) * (y[2] as number);
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	let wa = 1;
	let wb = 0;
	let wc = 0;
	const bp = sub(p, b);
	const d3 = dot(ab, bp);
	const d4 = dot(ac, bp);
	const cp = sub(p, c);
	const d5 = dot(ab, cp);
	const d6 = dot(ac, cp);
	const vc = d1 * d4 - d3 * d2;
	const vb = d5 * d2 - d1 * d6;
	const va = d3 * d6 - d5 * d4;
	if (d1 <= 0 && d2 <= 0) [wa, wb, wc] = [1, 0, 0];
	else if (d3 >= 0 && d4 <= d3) [wa, wb, wc] = [0, 1, 0];
	else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		[wa, wb, wc] = [1 - v, v, 0];
	} else if (d6 >= 0 && d5 <= d6) [wa, wb, wc] = [0, 0, 1];
	else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		[wa, wb, wc] = [1 - w, 0, w];
	} else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		[wa, wb, wc] = [0, 1 - w, w];
	} else {
		const denom = 1 / (va + vb + vc);
		wb = vb * denom;
		wc = vc * denom;
		wa = 1 - wb - wc;
	}
	const q = [0, 1, 2].map(
		(k) => wa * (a[k] as number) + wb * (b[k] as number) + wc * (c[k] as number),
	);
	const d = sub(p, q);
	return { distance: Math.sqrt(dot(d, d)), wa, wb, wc };
}

/** One weld's measures. */
export interface WeldMeasure {
	readonly child: number;
	/** The largest distance of a first-ring vertex from the parent's triangles, in metres. */
	readonly gap: number;
	/** The largest difference of `v` from the parent's at the same place, in metres of bark. */
	readonly vJump: number;
}

/** A vertex's position. */
function position(mesh: MeshArrays, i: number): number[] {
	return [
		mesh.positions[i * 3] as number,
		mesh.positions[i * 3 + 1] as number,
		mesh.positions[i * 3 + 2] as number,
	];
}

/**
 * Measures every weld: each child's first ring against its parent's triangles.
 *
 * @param report The mesher's report.
 * @returns One measure per child.
 */
export function measureWelds(report: WoodReport): WeldMeasure[] {
	const { mesh, welds, parents } = report;
	const triangles = mesh.indices;
	const measures: WeldMeasure[] = [];
	for (let w = 0; w < welds.child.length; w++) {
		const child = welds.child[w] as number;
		const parent = parents.get(child) ?? -1;
		const range = welds.axisFirst.get(parent);
		if (!range) continue;
		const [from, count] = range;
		const to = from + count;
		const first = welds.first[w] as number;
		// Only the parent's triangles that come within a centimetre of the weld ring's box can hold
		// its nearest points: a weld vertex off by more fails the measure anyway.
		const low = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
		const high = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
		for (let i = first; i < first + (welds.vertices[w] as number); i++)
			for (let k = 0; k < 3; k++) {
				const value = mesh.positions[i * 3 + k] as number;
				low[k] = Math.min(low[k] as number, value - 0.01);
				high[k] = Math.max(high[k] as number, value + 0.01);
			}
		const parentTriangles: number[] = [];
		for (let t = 0; t < triangles.length; t += 3) {
			const a = triangles[t] as number;
			if (a < from || a >= to) continue;
			let apart = false;
			for (let k = 0; k < 3 && !apart; k++) {
				let least = Number.POSITIVE_INFINITY;
				let most = Number.NEGATIVE_INFINITY;
				for (let c = 0; c < 3; c++) {
					const value = mesh.positions[(triangles[t + c] as number) * 3 + k] as number;
					least = Math.min(least, value);
					most = Math.max(most, value);
				}
				apart = most < (low[k] as number) || least > (high[k] as number);
			}
			if (!apart) parentTriangles.push(t);
		}
		let gap = parentTriangles.length > 0 ? 0 : Number.POSITIVE_INFINITY;
		let vJump = 0;
		for (let i = first; i < first + (welds.vertices[w] as number); i++) {
			const p = position(mesh, i);
			let best = { distance: Number.POSITIVE_INFINITY, v: 0 };
			for (const t of parentTriangles) {
				const ia = triangles[t] as number;
				const ib = triangles[t + 1] as number;
				const ic = triangles[t + 2] as number;
				const hit = nearestOnTriangle(
					p,
					position(mesh, ia),
					position(mesh, ib),
					position(mesh, ic),
				);
				if (hit.distance < best.distance) {
					best = {
						distance: hit.distance,
						v:
							hit.wa * (mesh.uvs[ia * 2 + 1] as number) +
							hit.wb * (mesh.uvs[ib * 2 + 1] as number) +
							hit.wc * (mesh.uvs[ic * 2 + 1] as number),
					};
				}
			}
			gap = Math.max(gap, best.distance);
			vJump = Math.max(vJump, Math.abs(best.v - (mesh.uvs[i * 2 + 1] as number)));
		}
		measures.push({ child, gap, vJump });
	}
	return measures;
}

/** The bark density's worst errors over a mesh's rings. */
export interface DensityMeasure {
	/** Rings measured. */
	readonly rings: number;
	/** The largest share by which a ring's density round the stem strays from the target. */
	readonly around: number;
	/** The same along the axis, between neighbouring plain rings. */
	readonly along: number;
}

/**
 * Measures the bark's texel density on every ring against the target, one tile per tile width of
 * bark: round the ring from its `u` span over its perimeter, along the axis from the rise of `v`
 * between rings. Both are given in the record's girth scale, so 1 is on target.
 *
 * @param report The mesher's report.
 * @returns The worst errors.
 */
export function measureDensity(report: WoodReport): DensityMeasure {
	const r = report.rings;
	let around = 0;
	let along = 0;
	for (let k = 0; k < r.axis.length; k++) {
		const scale = r.scale[k] as number;
		const density = ((r.span[k] as number) * scale) / (r.perimeter[k] as number);
		around = Math.max(around, Math.abs(density - 1));
		const next = k + 1;
		if (next < r.axis.length && r.axis[next] === r.axis[k] && !r.weld[k] && !r.weld[next]) {
			const ds = (r.arc[next] as number) - (r.arc[k] as number);
			if (ds > 1e-6) {
				const mean = ((r.scale[k] as number) + (r.scale[next] as number)) / 2;
				const rise = (((r.v[next] as number) - (r.v[k] as number)) / ds) * mean;
				along = Math.max(along, Math.abs(rise - 1));
			}
		}
	}
	return { rings: r.axis.length, around, along };
}

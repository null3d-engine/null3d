// Measures of the wood mesher's output for its tests: how far a child's first ring stands from its
// parent's triangles, how its `v` there differs from the parent's, and how far each ring's bark
// density strays from the record's. They read the written mesh, not the mesher's own sums, so a
// fault in the mesher's reasoning cannot hide in the measure.
import type { MeshArrays } from '../asset';
import { nearestOnTriangle } from './junction';
import type { WoodReport } from './wood-mesh';

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

/** How a fork's leader takes its parent's last ring: the worst difference, over the ring. */
export interface LeaderMeasure {
	readonly child: number;
	readonly parent: number;
	/** The largest distance between matching vertices, in metres. */
	readonly gap: number;
	/** The largest angle between matching vertex normals, as a cosine difference. */
	readonly normal: number;
	/** The largest difference of the bark's `u`, in metres. */
	readonly u: number;
	/** The largest difference of the bark's `v`, in metres, modulo the bark's repeat. */
	readonly v: number;
}

/**
 * Measures each fork leader's first ring against the parent's last ring, which it takes as its
 * own: the two must agree in position, normal and bark coordinates, so the joint draws as one
 * surface with no crease or bark seam.
 *
 * @param report The mesher's report.
 * @returns One measure per leader.
 */
export function measureLeaders(report: WoodReport): LeaderMeasure[] {
	const { mesh, welds, parents, axisRings } = report;
	const measures: LeaderMeasure[] = [];
	for (const [child, rings] of axisRings) {
		if (!rings.shared) continue;
		const parent = parents.get(child) ?? -1;
		const run = welds.axisFirst.get(child);
		const parentRun = welds.axisFirst.get(parent);
		if (parent < 0 || !run || !parentRun) continue;
		const sides = rings.sides[0] as number;
		const first = run[0];
		// The parent's ring that the leader copied: it holds the leader's first vertex.
		let match = -1;
		let nearest = Number.POSITIVE_INFINITY;
		for (let i = parentRun[0]; i < parentRun[0] + parentRun[1]; i++) {
			const d = Math.hypot(
				(mesh.positions[i * 3] as number) - (mesh.positions[first * 3] as number),
				(mesh.positions[i * 3 + 1] as number) - (mesh.positions[first * 3 + 1] as number),
				(mesh.positions[i * 3 + 2] as number) - (mesh.positions[first * 3 + 2] as number),
			);
			if (d < nearest) {
				nearest = d;
				match = i;
			}
		}
		if (match < 0) continue;
		let gap = 0;
		let normal = 0;
		let u = 0;
		let v = 0;
		for (let j = 0; j <= sides; j++) {
			const a = first + j;
			const b = match + j;
			gap = Math.max(
				gap,
				Math.hypot(
					(mesh.positions[a * 3] as number) - (mesh.positions[b * 3] as number),
					(mesh.positions[a * 3 + 1] as number) - (mesh.positions[b * 3 + 1] as number),
					(mesh.positions[a * 3 + 2] as number) - (mesh.positions[b * 3 + 2] as number),
				),
			);
			normal = Math.max(
				normal,
				Math.hypot(
					(mesh.normals[a * 3] as number) - (mesh.normals[b * 3] as number),
					(mesh.normals[a * 3 + 1] as number) - (mesh.normals[b * 3 + 1] as number),
					(mesh.normals[a * 3 + 2] as number) - (mesh.normals[b * 3 + 2] as number),
				),
			);
			u = Math.max(u, Math.abs((mesh.uvs[a * 2] as number) - (mesh.uvs[b * 2] as number)));
			const dv = Math.abs((mesh.uvs[a * 2 + 1] as number) - (mesh.uvs[b * 2 + 1] as number));
			v = Math.max(v, Math.abs(dv - Math.round(dv / report.vPeriod) * report.vPeriod));
		}
		measures.push({ child, parent, gap, normal, u, v });
	}
	return measures;
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
	// Each axis's triangles follow its vertices and one another, so one pass finds each axis's run.
	const ranges = [...welds.axisFirst.values()].sort((x, y) => x[0] - y[0]);
	const runs = new Map<number, [number, number]>();
	let r = 0;
	for (let t = 0; t < triangles.length; t += 3) {
		const a = triangles[t] as number;
		while (
			r < ranges.length &&
			a >= (ranges[r] as [number, number])[0] + (ranges[r] as [number, number])[1]
		)
			r++;
		const range = ranges[r];
		if (!range) break;
		const run = runs.get(range[0]);
		if (run) run[1] = t + 3;
		else runs.set(range[0], [t, t + 3]);
	}
	for (let w = 0; w < welds.child.length; w++) {
		const child = welds.child[w] as number;
		const parent = parents.get(child) ?? -1;
		const range = welds.axisFirst.get(parent);
		if (!range) continue;
		const from = range[0];
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
		const [runFrom, runTo] = runs.get(from) ?? [0, 0];
		for (let t = runFrom; t < runTo; t += 3) {
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
			// A child's v may run whole repeats of the bark lower than its parent's.
			const jump = best.v - (mesh.uvs[i * 2 + 1] as number);
			vJump = Math.max(vJump, Math.abs(jump - Math.round(jump / report.vPeriod) * report.vPeriod));
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
	/**
	 * The largest share by which a ring on a stem's foot strays round the stem: the foot keeps the
	 * plain stem's tile count, so its plates widen with the flare.
	 */
	readonly foot: number;
}

/**
 * Measures the bark's texel density on every ring against the target, one tile per tile width of
 * bark: round the ring from its `u` span over its perimeter, along the axis from the rise of `v`
 * between rings. Both are given in the record's girth scale, so 1 is on target. Rings on a stem's
 * foot are measured round apart, since their plates widen with the flare.
 *
 * @param report The mesher's report.
 * @returns The worst errors.
 */
export function measureDensity(report: WoodReport): DensityMeasure {
	const r = report.rings;
	let around = 0;
	let along = 0;
	let foot = 0;
	for (let k = 0; k < r.axis.length; k++) {
		const scale = r.scale[k] as number;
		const density = ((r.span[k] as number) * scale) / (r.perimeter[k] as number);
		if (r.foot[k]) foot = Math.max(foot, Math.abs(density - 1));
		else around = Math.max(around, Math.abs(density - 1));
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
	return { rings: r.axis.length, around, along, foot };
}

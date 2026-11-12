// A quick count of the wood's triangles at a level, for choosing a coarseness that meets a triangle
// target before the wood is meshed. It places each axis's rings as the mesher does, with the side
// counts its girth asks for, and counts the strips between them, the blend rings of each weld, the
// bend rings of each fork's leaders and each tip's cap. It builds no vertex, no weld and no stem
// foot, so it runs in a small share of the mesher's time and comes within a few per cent of its
// count at the nearest level, where a triangle target is read.
import { AXIS_STEM, type MacroSkeleton } from '../core/graph';
import { acos, PI } from '../core/math';
import type { MeshInput, MeshLevel } from '../stages';
import { axisPath, KINK_BEND, type PathSample, roundKinks, sampleAt } from './frames';
import {
	bendRings,
	CODOMINANT,
	heldSides,
	LEADER_SHARE,
	ringArcs,
	sidesFor,
	THIN,
	type TubeDetail,
	tubeDetail,
} from './tube';
import { cappedAxes } from './wood-mesh';

/** Blend rings of a weld, as the mesher gives them: thin wood, wood under 2 cm, and the rest. */
const BLEND_THIN = 2;
const BLEND_SMALL = 3;
const BLEND_WIDE = 4;

/** Rings that a tip's rounded cap takes, past the axis's last plain ring. */
const TIP_RINGS = 1;

/**
 * About how many triangles the wood of a level holds.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @returns The count.
 */
export function woodTriangles(
	input: Pick<MeshInput, 'skeleton' | 'record' | 'detail' | 'coarseness' | 'sections'>,
	level: MeshLevel,
): number {
	const { skeleton } = input;
	const tube = tubeDetail(level, input.detail, input.coarseness ?? 0, input.sections ?? 0);
	const keep = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	const capped = cappedAxes(skeleton, keep, level, input.sections ?? 0);
	const sample: PathSample = { radius: 0, height: 0 };
	const axes = skeleton.axes;
	const meshed = new Uint8Array(axes.count);
	let triangles = 0;
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if ((axes.order[a] as number) > keep) continue;
		if (capped?.[a] === 1) continue;
		if (parent < 0 ? axes.kind[a] !== AXIS_STEM : !meshed[parent]) continue;
		const path = pathOf(skeleton, a);
		if (!path) continue;
		meshed[a] = 1;
		const arcs = ringArcs(
			path,
			0,
			(s) => sampleAt(path, s, sample).radius,
			tube,
			() => false,
		);
		let sides = 0;
		let before = 0;
		for (const s of arcs) {
			const r = sampleAt(path, s, sample).radius;
			sides = heldSides(sidesFor(2 * PI * r, r, tube), sides);
			if (before > 0) triangles += before + sides;
			before = sides;
		}
		const r0 = path.radius[0] as number;
		const first = sidesFor(2 * PI * r0, r0, tube);
		if (parent >= 0) {
			const full = r0 < THIN ? BLEND_THIN : r0 < 2.5 * THIN ? BLEND_SMALL : BLEND_WIDE;
			const blend = Math.max(1, Math.round(full - (full - 1) * tube.sections));
			triangles += 2 * first * blend + forkBend(skeleton, a, tube);
		}
		triangles += 2 * sides * TIP_RINGS;
	}
	return triangles;
}

/**
 * The triangles of the bend of a fork's leader, as the mesher draws it, or none when the axis is no
 * leader and welds on its parent's side. A child leads where it leaves its parent's last node with
 * half its girth, or leaves short of the end with a codominant share, where the parent's wood runs
 * on past the fork as a leader too.
 */
function forkBend(skeleton: MacroSkeleton, a: number, tube: TubeDetail): number {
	const { axes, radius } = skeleton;
	const parent = axes.parent[a] as number;
	const node = axes.parentNode[a] as number;
	const last = axes.last[parent] as number;
	const girth = radius[node] as number;
	const share = (radius[axes.first[a] as number] as number) / girth;
	const atEnd = node === last;
	const codominant = !atEnd && share >= CODOMINANT && (axes.parentT[a] as number) <= 1e-6;
	if (!(atEnd && share >= LEADER_SHARE) && !codominant) return 0;
	const before =
		node > (axes.first[parent] as number) ? node - 1 : (axes.parentNode[parent] as number);
	const sides = sidesFor(2 * PI * girth, girth, tube);
	const bend = (to: number) =>
		before < 0 ? 0 : 2 * sides * bendRings(turnAt(skeleton, before, node, to), girth, tube);
	// The parent's own wood runs on past a codominant child as a second leader.
	return bend(axes.first[a] as number) + (codominant ? bend(node + 1) : 0);
}

/** Radians between the internode into a node and the one out of it to another node. */
function turnAt(skeleton: MacroSkeleton, from: number, node: number, to: number): number {
	const p = skeleton.position;
	let dot = 0;
	let a = 0;
	let b = 0;
	for (let k = 0; k < 3; k++) {
		const u = (p[node * 3 + k] as number) - (p[from * 3 + k] as number);
		const v = (p[to * 3 + k] as number) - (p[node * 3 + k] as number);
		dot += u * v;
		a += u * u;
		b += v * v;
	}
	const length = Math.sqrt(a * b);
	return length > 0 ? acos(Math.max(-1, Math.min(1, dot / length))) : 0;
}

/** The curve through an axis's nodes, from its junction on its parent; none for a lone node. */
function pathOf(skeleton: MacroSkeleton, a: number): ReturnType<typeof axisPath> | undefined {
	const { axes, position: p } = skeleton;
	const first = axes.first[a] as number;
	const last = axes.last[a] as number;
	const parentNode = axes.parentNode[a] as number;
	const from = parentNode >= 0 ? parentNode : first;
	const count = last - first + 1 + (parentNode >= 0 ? 1 : 0);
	if (count < 2) return undefined;
	const points = new Float64Array(count * 3);
	const radii = new Float64Array(count);
	let k = 0;
	if (parentNode >= 0) {
		points.set(p.subarray(from * 3, from * 3 + 3), 0);
		radii[0] = skeleton.radius[first] as number;
		k = 1;
	}
	for (let n = first; n <= last; n++, k++) {
		points.set(p.subarray(n * 3, n * 3 + 3), k * 3);
		radii[k] = skeleton.radius[n] as number;
	}
	const rounded = roundKinks(points, radii, count, KINK_BEND);
	return axisPath(rounded.points, rounded.radii, rounded.count, [1, 0, 0]);
}

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
	const tube = tubeDetail(level, input.detail, input.coarseness ?? 0, input.sections ?? 0);
	const counts = woodPartTriangles(input, level, undefined, [tube, tube, tube]);
	return counts[0] + counts[1] + counts[2];
}

/**
 * About how many triangles each part of a level's wood holds: its trunk, its great limbs and its
 * branches, each at a detail of its own.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @param parts The part of each skeleton axis: 0 its trunk, 1 a great limb, 2 a branch; all
 *   branches when absent.
 * @param tubes The detail of each part's wood, or `null` for a part that is not drawn.
 * @param keep Per axis, 1 for a limb or branch that is drawn; all of them when absent.
 * @returns The three counts.
 */
export function woodPartTriangles(
	input: Pick<MeshInput, 'skeleton' | 'record'>,
	level: MeshLevel,
	parts: Uint8Array | undefined,
	tubes: readonly (TubeDetail | null)[],
	keep?: Uint8Array,
): [number, number, number] {
	return woodLadderTriangles(input, level, parts, [tubes], keep)[0] as [number, number, number];
}

/**
 * About how many triangles each part of a level's wood holds at each of several details: one walk
 * of the axes, each axis's curve made once and its rings counted at every detail.
 *
 * @param input The dressed variant.
 * @param level The level.
 * @param parts The part of each skeleton axis: 0 its trunk, 1 a great limb, 2 a branch; all
 *   branches when absent.
 * @param ladder For each detail, the tube of each part's wood, or `null` for a part not drawn.
 * @param keep Per axis, 1 for a limb or branch that is drawn; all of them when absent.
 * @returns For each detail, the three counts.
 */
export function woodLadderTriangles(
	input: Pick<MeshInput, 'skeleton' | 'record'>,
	level: MeshLevel,
	parts: Uint8Array | undefined,
	ladder: readonly (readonly (TubeDetail | null)[])[],
	keep?: Uint8Array,
): [number, number, number][] {
	const { skeleton } = input;
	const orders = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	const sample: PathSample = { radius: 0, height: 0 };
	const axes = skeleton.axes;
	// Per detail, whether each axis is meshed there: a child needs its parent.
	const meshed = ladder.map(() => new Uint8Array(axes.count));
	const out = ladder.map((): [number, number, number] => [0, 0, 0]);
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		const part = parts?.[a] ?? 2;
		if ((axes.order[a] as number) > orders) continue;
		if (part !== 0 && keep && keep[a] !== 1) continue;
		if (parent < 0 && axes.kind[a] !== AXIS_STEM) continue;
		let path: ReturnType<typeof pathOf> | null = null;
		for (let step = 0; step < ladder.length; step++) {
			const tube = (ladder[step] as readonly (TubeDetail | null)[])[part];
			if (!tube || (parent >= 0 && !(meshed[step] as Uint8Array)[parent])) continue;
			if (path === null) path = pathOf(skeleton, a);
			if (!path) break;
			const curve = path;
			(meshed[step] as Uint8Array)[a] = 1;
			const arcs = ringArcs(
				curve,
				0,
				(s) => sampleAt(curve, s, sample).radius,
				tube,
				() => false,
			);
			let triangles = 0;
			let sides = 0;
			let before = 0;
			for (const s of arcs) {
				const r = sampleAt(curve, s, sample).radius;
				sides = heldSides(sidesFor(2 * PI * r, r, tube), sides);
				if (before > 0) triangles += before + sides;
				before = sides;
			}
			const r0 = curve.radius[0] as number;
			const first = sidesFor(2 * PI * r0, r0, tube);
			if (parent >= 0) {
				const full = r0 < THIN ? BLEND_THIN : r0 < 2.5 * THIN ? BLEND_SMALL : BLEND_WIDE;
				const blend =
					tube.sections >= 1 ? 0 : Math.max(1, Math.round(full - (full - 1) * tube.sections));
				triangles += 2 * first * blend + forkBend(skeleton, a, tube);
			}
			if (tube.sections < 1) triangles += 2 * sides * TIP_RINGS;
			const counts = out[step] as [number, number, number];
			counts[part] = (counts[part] as number) + triangles;
		}
	}
	return out;
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

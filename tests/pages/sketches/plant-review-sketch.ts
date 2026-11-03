// One review plant in one view, drawn to be laid beside a reference picture: the whole plant, its
// crown from outside, from below and from inside, its wood alone, its silhouette, its trunk and
// bark, one leaf from either face, and a cut branch, sub-branch or leaf cluster. The query contract
// lives in `../lib/plant-review.ts`, which the review tools share; the page reads nothing else.
// The sketch posts what it measured of the plant and where its camera stood as the `plant-review`
// message, so a tool records the frame's facts beside its pixels.
import { defineSketch } from '@null3d/engine';
import {
	bakePlantAtlases,
	barkCellFor,
	generatePlant,
	leafCellFor,
	MAX_BRANCHES,
	type PartArrays,
	type PlantAsset,
	type PlantPart,
	plantMaterial,
	plantWind,
	type Species,
	setWindLayer,
	WIND_STRIDE,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import {
	BACKGROUND_COLOURS,
	defaultBackground,
	defaultFov,
	type PlantView,
	readPlantReviewQuery,
	type ScreenFraming,
	standCamera,
	WHOLE_VIEWS,
} from '../lib/plant-review';
import { REVIEW_TREES, reviewTree } from '../lib/tree-corpus';

type V3 = [number, number, number];
/** A point or direction that a helper reads and does not change. */
type In3 = readonly [number, number, number];

const QUERY = readPlantReviewQuery(new URL(import.meta.url).searchParams);
const SPECIES: Species | undefined =
	reviewTree(QUERY.species) ?? REVIEW_TREES[Number(QUERY.species)];
const VIEW: PlantView = QUERY.view ?? 'whole';
const TURN = ((QUERY.turn ?? 0) * Math.PI) / 180;
const FOV = QUERY.fov ?? defaultFov(VIEW);
const ASPECT = QUERY.aspect ?? 0.75;
const DISTANCE = QUERY.distance ?? 1;
const BACKGROUND = QUERY.background ?? defaultBackground(VIEW);
/** The quaternion that lays a plane, which faces +Z, flat on the ground. */
const FLAT: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** The height of a standing person's eye, where a camera on the ground stands, in metres. */
const EYE = 1.6;

function add(a: In3, b: In3): V3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a: In3, b: In3): V3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: In3, s: number): V3 {
	return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: In3, b: In3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: In3, b: In3): V3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: In3): V3 {
	const length = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / length, a[1] / length, a[2] / length];
}
function vertexOf(positions: Float32Array, index: number): V3 {
	return [
		positions[index * 3] as number,
		positions[index * 3 + 1] as number,
		positions[index * 3 + 2] as number,
	];
}

/** The horizontal direction that a turn faces: turn 0 stands the camera on the +Z side. */
function facing(turn: number): V3 {
	return [Math.sin(turn), 0, Math.cos(turn)];
}

/** A camera on a sphere round a target: `elevation` degrees up, seen from the target. */
function orbit(target: V3, distance: number, elevation: number, turn = TURN): View {
	const e = (elevation * Math.PI) / 180;
	const out = facing(turn);
	const direction: V3 = [out[0] * Math.cos(e), Math.sin(e), out[2] * Math.cos(e)];
	return { position: add(target, scale(direction, distance * DISTANCE)), target, fov: FOV };
}

/** Where the camera stands and what it looks at. */
interface View {
	readonly position: V3;
	readonly target: V3;
	readonly fov: number;
	/** The near plane, when the view clears what stands close to the camera. */
	readonly near?: number;
}

/** The trunk's axis at the ground and its radius, from the trunk's own wood near the ground. */
interface Trunk {
	readonly axis: V3;
	readonly radius: number;
}

/** The wood part of the finest level, or undefined for a plant that has none. */
function woodOf(asset: PlantAsset): PlantPart | undefined {
	return asset.levels[0]?.parts.find((part) => part.name === 'wood');
}

/** The first trunk's axis and radius, read from the wood whose vertices name the trunk's record. */
function trunkOf(asset: PlantAsset): Trunk {
	const wood = woodOf(asset);
	const centre = asset.crown.center;
	if (!wood) return { axis: [centre[0], 0, centre[2]], radius: 0.25 };
	const { positions, colors } = wood.arrays;
	let sx = 0;
	let sz = 0;
	let n = 0;
	for (let v = 0; v < positions.length / 3; v++) {
		if (colors[v * 4] !== 0 || (positions[v * 3 + 1] as number) > 0.6) continue;
		sx += positions[v * 3] as number;
		sz += positions[v * 3 + 2] as number;
		n += 1;
	}
	const axis: V3 = n > 0 ? [sx / n, 0, sz / n] : [centre[0], 0, centre[2]];
	const distances: number[] = [];
	for (let v = 0; v < positions.length / 3; v++) {
		const y = positions[v * 3 + 1] as number;
		if (colors[v * 4] !== 0 || y < 0.3 || y > 1.6) continue;
		distances.push(
			Math.hypot(
				(positions[v * 3] as number) - axis[0],
				(positions[v * 3 + 2] as number) - axis[2],
			),
		);
	}
	distances.sort((a, b) => a - b);
	const radius = distances[Math.floor(distances.length / 2)] ?? 0.25;
	return { axis, radius: Math.max(0.04, radius) };
}

/** The widest horizontal reach of the plant from its trunk's axis, in metres. */
function reachOf(asset: PlantAsset, axis: V3): number {
	const { min, max } = asset.crown;
	return Math.max(
		Math.abs(min[0] - axis[0]),
		Math.abs(max[0] - axis[0]),
		Math.abs(min[2] - axis[2]),
		Math.abs(max[2] - axis[2]),
		0.2,
	);
}

/** One branch of the wind table: where it starts, which way it runs, and how far. */
interface Branch {
	readonly pivot: V3;
	readonly axis: V3;
	readonly parent: number;
	readonly level: number;
	readonly length: number;
}

/** Every branch that the wind table records, in the generator's order: parents come first. */
function branchesOf(asset: PlantAsset): Branch[] {
	const { pivots, branches } = asset.wind;
	const out: Branch[] = [];
	for (let i = 0; i < branches; i++) {
		const at = i * WIND_STRIDE;
		out.push({
			pivot: [pivots[at] as number, pivots[at + 1] as number, pivots[at + 2] as number],
			axis: [pivots[at + 3] as number, pivots[at + 4] as number, pivots[at + 5] as number],
			parent: pivots[at + 6] as number,
			level: pivots[at + 10] as number,
			length: pivots[at + 11] as number,
		});
	}
	return out;
}

/** The point at the far end of a branch, along its axis. */
function tipOf(branch: Branch): V3 {
	return add(branch.pivot, scale(branch.axis, branch.length));
}

/** The distance from a point to a branch's straight run. */
function distanceToBranch(point: V3, branch: Branch): number {
	const along = Math.min(branch.length, Math.max(0, dot(sub(point, branch.pivot), branch.axis)));
	const nearest = add(branch.pivot, scale(branch.axis, along));
	return Math.hypot(point[0] - nearest[0], point[1] - nearest[1], point[2] - nearest[2]);
}

/**
 * The branch that each vertex of a part belongs to. A vertex names its branch in one byte, so a
 * plant with more branches than the byte holds names some of them ambiguously: wood beyond the
 * wind table's width names its nearest recorded ancestor, and a leaf card's byte wraps. Each
 * vertex takes the nearest of the branches its byte can name.
 */
function ownersOf(part: PlantPart, branches: readonly Branch[], named: number[][]): Int32Array {
	const { positions, colors } = part.arrays;
	const count = positions.length / 3;
	const owners = new Int32Array(count);
	for (let v = 0; v < count; v++) {
		const byte = colors[v * 4] as number;
		const candidates = named[byte] ?? [byte];
		if (candidates.length === 1) {
			owners[v] = candidates[0] as number;
			continue;
		}
		const point = vertexOf(positions, v);
		let best = candidates[0] as number;
		let nearest = Number.POSITIVE_INFINITY;
		for (const candidate of candidates) {
			const branch = branches[candidate];
			if (!branch) continue;
			const d = distanceToBranch(point, branch);
			if (d < nearest) {
				nearest = d;
				best = candidate;
			}
		}
		owners[v] = best;
	}
	return owners;
}

/** For each byte a vertex can hold, the branches that the byte may name. */
function namedBranches(branches: readonly Branch[]): number[][] {
	const named: number[][] = Array.from({ length: 256 }, () => []);
	const record = new Int32Array(branches.length);
	for (const [i, branch] of branches.entries()) {
		// A branch past the table's width shares its nearest recorded ancestor's byte.
		record[i] = i < MAX_BRANCHES ? i : (record[branch.parent] ?? 0);
		(named[record[i] as number] as number[]).push(i);
		// A leaf card names its own branch's index in a byte, which wraps past 255.
		if (i >= MAX_BRANCHES) (named[i & 255] as number[]).push(i);
	}
	return named.map((list) => [...new Set(list)]);
}

/** A part reduced to the vertices that `keep` marks, with the triangles whose corners it keeps. */
function subsetOf(arrays: PartArrays, keep: Uint8Array): PartArrays | undefined {
	const count = arrays.positions.length / 3;
	const remap = new Int32Array(count).fill(-1);
	let kept = 0;
	for (let v = 0; v < count; v++) if (keep[v]) remap[v] = kept++;
	if (kept === 0) return undefined;
	const indices: number[] = [];
	for (let t = 0; t + 2 < arrays.indices.length; t += 3) {
		const a = remap[arrays.indices[t] as number] as number;
		const b = remap[arrays.indices[t + 1] as number] as number;
		const c = remap[arrays.indices[t + 2] as number] as number;
		if (a >= 0 && b >= 0 && c >= 0) indices.push(a, b, c);
	}
	if (indices.length === 0) return undefined;
	const pick = <T extends Float32Array | Uint8Array>(source: T, out: T, width: number): T => {
		for (let v = 0; v < count; v++) {
			const to = remap[v] as number;
			if (to >= 0)
				for (let c = 0; c < width; c++) out[to * width + c] = source[v * width + c] as number;
		}
		return out;
	};
	return {
		positions: pick(arrays.positions, new Float32Array(kept * 3), 3),
		normals: pick(arrays.normals, new Float32Array(kept * 3), 3),
		uvs: pick(arrays.uvs, new Float32Array(kept * 2), 2),
		colors: pick(arrays.colors, new Uint8Array(kept * 4), 4),
		...(arrays.targets ? { targets: pick(arrays.targets, new Float32Array(kept * 4), 4) } : {}),
		indices: Uint32Array.from(indices),
	};
}

/** A cut piece of the plant, stood upright from its cut end as a studio picture stands it. */
interface Cutting {
	readonly parts: { readonly name: PlantPart['name']; readonly arrays: PartArrays }[];
	/** The rotation that stands the piece upright, and the position that puts its cut on the origin. */
	readonly rotation: [number, number, number, number];
	readonly position: V3;
	/** The piece's bounds after it is stood upright. */
	readonly min: V3;
	readonly max: V3;
	/** The branch the piece was cut from, and how far it reaches before the crop. */
	readonly branch: number;
	readonly level: number;
	readonly reach: number;
	/** Whether the piece was cropped from a longer branch because the plant grows no shorter one. */
	readonly cropped: boolean;
}

/** The rotation that turns direction `from` onto +Y, as a quaternion (x, y, z, w). */
function rotationToUp(from: V3): [number, number, number, number] {
	const up: V3 = [0, 1, 0];
	const d = dot(from, up);
	if (d < -0.9999) return [1, 0, 0, 0];
	const axis = cross(from, up);
	const w = 1 + d;
	const length = Math.hypot(axis[0], axis[1], axis[2], w);
	return [axis[0] / length, axis[1] / length, axis[2] / length, w / length];
}

/** A point turned by a quaternion. */
function rotate(q: [number, number, number, number], p: V3): V3 {
	const u: V3 = [q[0], q[1], q[2]];
	const t = scale(cross(u, p), 2);
	return add(add(p, scale(t, q[3])), cross(u, t));
}

/**
 * TODO(cutting): the plant core grows no cut piece of itself. The new core's `cutting` API should
 * return one branch's subtree as its own parts, cut at a chosen order and length and stood upright
 * from its cut end, as a studio picture shows a cut branch. Until then this picks a branch from the
 * wind table, gives every vertex to the nearest branch its byte can name, keeps the chosen branch's
 * subtree, and crops it to the length asked for when the plant grows no branch that short.
 */
function cuttingOf(
	asset: PlantAsset,
	length: number,
	piece: 'branch' | 'subbranch' | 'cluster',
): Cutting | undefined {
	const branches = branchesOf(asset);
	if (branches.length < 2) return undefined;
	const tipOnly = piece === 'cluster';
	// A cut branch shows more than one order, so it is cut from a branch that divides again.
	const divides = new Uint8Array(branches.length);
	for (const branch of branches) if (branch.parent >= 0) divides[branch.parent] = 1;
	// How far each branch's subtree reaches from the branch's own start, from the branches' tips.
	const reach = new Float64Array(branches.length);
	const deepest = Math.max(...branches.map((branch) => branch.level));
	for (const [i, branch] of branches.entries()) {
		const tip = tipOf(branch);
		reach[i] = Math.max(reach[i] as number, branch.length);
		// An ancestor reaches as far as its descendants' tips, measured from its own start.
		for (let ancestor = branch.parent; ancestor >= 0; ) {
			const from = (branches[ancestor] as Branch).pivot;
			const d = Math.hypot(tip[0] - from[0], tip[1] - from[1], tip[2] - from[2]);
			reach[ancestor] = Math.max(reach[ancestor] as number, d);
			ancestor = (branches[ancestor] as Branch).parent;
		}
	}
	// The branch to cut: the one whose subtree reaches nearest the length asked for, on the side of
	// the plant that a turn of 0 faces, at the finest order for a leaf cluster and among the
	// branches that divide again for a cut branch. The pick does not follow the turn, so a turn
	// walks round one piece.
	const side = facing(0);
	let chosen = -1;
	let score = Number.POSITIVE_INFINITY;
	for (const [i, branch] of branches.entries()) {
		if (branch.level < 1 || (tipOnly && branch.level < deepest)) continue;
		if (piece === 'branch' && !divides[i]) continue;
		const out = sub(tipOf(branch), asset.crown.center);
		const toward = dot(normalize([out[0], 0, out[2]]), side);
		const s = Math.abs(Math.log((reach[i] as number) / length)) - 0.35 * toward;
		if (s < score) {
			score = s;
			chosen = i;
		}
	}
	const root = branches[chosen];
	if (!root) return undefined;
	const inside = new Uint8Array(branches.length);
	for (const [i, branch] of branches.entries())
		inside[i] = i === chosen || (branch.parent >= 0 && inside[branch.parent] === 1) ? 1 : 0;
	// A branch that reaches much further than asked is cropped round its outer end, where its
	// finest orders and their leaves are; a leaf cluster is cropped round a shoot's tip.
	const rootReach = reach[chosen] as number;
	const cropped = rootReach > length * 1.5 || tipOnly;
	const outer = Math.min(root.length, Math.max(length * 0.5, rootReach - length * 0.5));
	const centre = tipOnly ? tipOf(root) : add(root.pivot, scale(root.axis, outer));
	const radius = length * 0.6;
	const named = namedBranches(branches);
	const parts: Cutting['parts'][number][] = [];
	let base: V3 | undefined;
	let nearestBase = Number.POSITIVE_INFINITY;
	const sum: V3 = [0, 0, 0];
	let kept = 0;
	for (const part of asset.levels[0]?.parts ?? []) {
		const owners = ownersOf(part, branches, named);
		const positions = part.arrays.positions;
		const keep = new Uint8Array(owners.length);
		for (let v = 0; v < owners.length; v++) {
			if (inside[owners[v] as number] !== 1) continue;
			const p = vertexOf(positions, v);
			if (cropped && Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) > radius)
				continue;
			keep[v] = 1;
			sum[0] += p[0];
			sum[1] += p[1];
			sum[2] += p[2];
			kept += 1;
			if (part.name === 'wood') {
				const d = Math.hypot(p[0] - root.pivot[0], p[1] - root.pivot[1], p[2] - root.pivot[2]);
				if (d < nearestBase) {
					nearestBase = d;
					base = p;
				}
			}
		}
		const arrays = subsetOf(part.arrays, keep);
		if (arrays) parts.push({ name: part.name, arrays });
	}
	if (kept === 0 || parts.length === 0) return undefined;
	const cut = base ?? root.pivot;
	const middle = scale(sum, 1 / kept);
	const rotation = rotationToUp(normalize(sub(middle, cut)));
	const position = scale(rotate(rotation, cut), -1);
	const min: V3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max: V3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (const part of parts)
		for (let v = 0; v < part.arrays.positions.length / 3; v++) {
			const p = add(rotate(rotation, vertexOf(part.arrays.positions, v)), position);
			for (let a = 0; a < 3; a++) {
				min[a] = Math.min(min[a] as number, p[a] as number);
				max[a] = Math.max(max[a] as number, p[a] as number);
			}
		}
	return {
		parts,
		rotation,
		position,
		min,
		max,
		branch: chosen,
		level: root.level,
		reach: reach[chosen] as number,
		cropped,
	};
}

/** The card that a leaf view draws alone: one that faces the sky and stands at the crown's surface. */
interface ChosenCard {
	readonly centre: V3;
	readonly normal: V3;
	readonly radius: number;
	/** The index of the card's first position number in the leaves part. */
	readonly chosen: number;
}

/** Picks the card that faces the sky and stands at the crown's surface, so its shape reads alone. */
function chooseCard(part: PlantPart, per: number, centre: readonly number[]): ChosenCard {
	const { positions, normals } = part.arrays;
	let chosen = 0;
	let best = Number.NEGATIVE_INFINITY;
	for (let at = 0; at + per * 3 <= positions.length; at += per * 3) {
		let cx = 0;
		let cy = 0;
		let cz = 0;
		for (let i = 0; i < per; i++) {
			cx += positions[at + i * 3] as number;
			cy += positions[at + i * 3 + 1] as number;
			cz += positions[at + i * 3 + 2] as number;
		}
		const reach = Math.hypot(
			cx / per - (centre[0] as number),
			cy / per - (centre[1] as number),
			cz / per - (centre[2] as number),
		);
		const score = (normals[at + 1] as number) + reach * 0.12;
		if (score > best) {
			best = score;
			chosen = at;
		}
	}
	const first = chosen / 3;
	let middle: V3 = [0, 0, 0];
	let normal: V3 = [0, 0, 0];
	for (let i = 0; i < per; i++) {
		middle = add(middle, vertexOf(positions, first + i));
		// A cluster card is folded, so the mean of its normals points between its two panels.
		normal = add(normal, vertexOf(normals, first + i));
	}
	middle = scale(middle, 1 / per);
	let radius = 0;
	for (let i = 0; i < per; i++) {
		const p = vertexOf(positions, first + i);
		radius = Math.max(radius, Math.hypot(p[0] - middle[0], p[1] - middle[1], p[2] - middle[2]));
	}
	return { centre: middle, normal: normalize(normal), radius: Math.max(0.05, radius), chosen };
}

/** One card of a part alone, as its own arrays. */
function cardArrays(part: PlantPart, card: ChosenCard, per: number): PartArrays {
	const keep = new Uint8Array(part.arrays.positions.length / 3);
	const first = card.chosen / 3;
	for (let i = 0; i < per; i++) keep[first + i] = 1;
	return subsetOf(part.arrays, keep) as PartArrays;
}

/** The major limb that runs across the view of a camera at a turn of 0, and its radius. */
function limbOf(asset: PlantAsset): { branch: Branch; index: number; radius: number } | undefined {
	const branches = branchesOf(asset);
	const longest = Math.max(0, ...branches.filter((b) => b.level === 1).map((b) => b.length));
	// A limb that runs across the frame at a turn of 0 points at right angles to that side. The pick
	// does not follow the turn, so a turn walks round one limb.
	const across = facing(Math.PI / 2);
	let index = -1;
	let best = Number.NEGATIVE_INFINITY;
	for (const [i, branch] of branches.entries()) {
		if (branch.level !== 1 || branch.length < longest * 0.4) continue;
		const s = Math.abs(dot(normalize([branch.axis[0], 0, branch.axis[2]]), across));
		if (s > best) {
			best = s;
			index = i;
		}
	}
	const branch = branches[index];
	if (!branch) return undefined;
	const wood = woodOf(asset);
	const distances: number[] = [];
	if (wood && index < MAX_BRANCHES) {
		const { positions, colors } = wood.arrays;
		// The limb's byte also names the wood of branches past the table's width, which stands off
		// the limb's axis, so the radius is a low quantile of the limb's own first half.
		for (let v = 0; v < positions.length / 3; v++) {
			if (colors[v * 4] !== index) continue;
			const p = vertexOf(positions, v);
			const along = dot(sub(p, branch.pivot), branch.axis);
			if (along > 0 && along < branch.length * 0.5) distances.push(distanceToBranch(p, branch));
		}
	}
	distances.sort((a, b) => a - b);
	return {
		branch,
		index,
		radius: Math.max(0.03, distances[Math.floor(distances.length * 0.3)] ?? 0.1),
	};
}

export default defineSketch((ctx) => {
	if (!SPECIES) throw new Error(`the review has no ${QUERY.species} species`);
	const { scene, geometry, materials, post, page } = ctx;
	// A review picture is laid beside a photograph, which carries no display curve; a tone curve
	// would crush and saturate the sky and the foliage that the photograph shows as they are.
	post.set({ toneMapping: 'none' });
	const colours = BACKGROUND_COLOURS[BACKGROUND];
	// A matte draws the plant black on white with no light, so a tool reads its exact outline.
	const silhouette = VIEW === 'silhouette' || QUERY.matte === true;
	scene.setBackground(silhouette ? '#ffffff' : (QUERY.sky ?? colours.sky));

	const asset = generatePlant(SPECIES, { seed: QUERY.seed ?? 11, variant: QUERY.variant ?? 0 });
	const { min, max, start } = asset.crown;
	const height = Math.max(0.2, max[1]);
	const trunk = trunkOf(asset);
	const reach = reachOf(asset, trunk.axis);
	const crownStart = Math.min(start, height * 0.9);
	const parts = asset.levels[0]?.parts ?? [];
	const notes: string[] = [];
	let placeholder: string | undefined;

	let view: View;
	let draw: 'all' | 'wood' | 'card' | 'cutting' = 'all';
	let card: ChosenCard | undefined;
	let cutting: Cutting | undefined;
	let limb: ReturnType<typeof limbOf>;
	const per = SPECIES.leaf?.kind === 'cluster' ? 6 : SPECIES.leaf?.cross === true ? 8 : 4;
	const leavesPart = parts.find((part) => part.name === 'leaves');
	const framingAsked =
		QUERY.horizon !== undefined ||
		QUERY.fill !== undefined ||
		QUERY.targetY !== undefined ||
		QUERY.targetX !== undefined ||
		QUERY.top !== undefined;

	if (WHOLE_VIEWS.includes(VIEW) && (framingAsked || QUERY.elevation === undefined)) {
		// The camera stands on the ground and puts the plant where the framing asks; without a
		// framing, it fills most of the frame's height, or less when the plant is too broad for it.
		const framing = (fill: number): ScreenFraming => {
			const middle = QUERY.targetY ?? 0.5;
			const asked = QUERY.top !== undefined && QUERY.fill === undefined;
			return {
				fov: FOV,
				aspect: ASPECT,
				horizon: QUERY.horizon ?? 0.62,
				top: asked ? (QUERY.top as number) : middle - fill / 2,
				...(asked ? { eye: QUERY.eye ?? EYE } : { base: middle + fill / 2 }),
				targetX: QUERY.targetX ?? 0.5,
			};
		};
		let fill = QUERY.fill ?? 0.8;
		let stand = standCamera(framing(fill), height);
		if (!framingAsked) {
			const half = Math.tan((FOV * Math.PI) / 360) * ASPECT;
			for (let pass = 0; pass < 3; pass++) {
				const across = reach / (stand.distance * half);
				if (across <= 0.92) break;
				fill *= 0.92 / across;
				stand = standCamera(framing(fill), height);
			}
		}
		if (stand.warning) notes.push(stand.warning);
		const out = facing(TURN);
		const right: V3 = [Math.cos(TURN), 0, -Math.sin(TURN)];
		const position: V3 = add(add(trunk.axis, scale(out, stand.distance * DISTANCE)), [
			0,
			stand.height,
			0,
		]);
		const level = sub(scale(out, -Math.cos(stand.yaw)), scale(right, Math.sin(stand.yaw)));
		const look = add(scale(level, Math.cos(stand.pitch)), [0, Math.sin(stand.pitch), 0]);
		view = { position, target: add(position, scale(look, stand.distance)), fov: FOV };
		if (VIEW === 'skeleton') draw = 'wood';
	} else if (WHOLE_VIEWS.includes(VIEW)) {
		const target: V3 = [trunk.axis[0], height * 0.5, trunk.axis[2]];
		const half = Math.tan((FOV * Math.PI) / 360);
		const fit = Math.max((height * 1.05) / 2 / half, reach / (half * ASPECT)) * 1.15;
		view = orbit(target, fit, QUERY.elevation as number);
		if (VIEW === 'skeleton') draw = 'wood';
	} else if (VIEW === 'crown') {
		// Stand off the crown's middle, a little below it, and look up at its outer surface against
		// the sky, so the frame holds the crown's structure rather than one leaf card.
		const target: V3 = [trunk.axis[0], crownStart + (height - crownStart) * 0.6, trunk.axis[2]];
		const span = Math.max(max[0] - min[0], max[2] - min[2], 1);
		view = orbit(target, Math.max(3.5, span * 0.7 + reach * 0.55), QUERY.elevation ?? -8);
	} else if (VIEW === 'below') {
		// Stand under the crown at eye height and look up into it, as a walker sees a canopy.
		const target: V3 = [trunk.axis[0], crownStart + (height - crownStart) * 0.5, trunk.axis[2]];
		const eye = Math.min(EYE, crownStart * 0.8, target[1] * 0.5);
		const elevation = QUERY.elevation ?? -65;
		const drop = Math.max(0.5, target[1] - Math.max(0.3, eye));
		view = {
			...orbit(target, drop / Math.max(0.2, Math.sin((-elevation * Math.PI) / 180)), elevation),
			// The leaves within reach of the camera are cleared, so the frame shows the crown above.
			near: 0.5,
		};
	} else if (VIEW === 'inside') {
		// Stand under the crown, beside the trunk, and look back up at the trunk and the limbs, as
		// a walker standing inside a crown sees it. The near plane clears the leaves within arm's
		// reach, as a photographer pushes them aside.
		const out = facing(TURN);
		const eye = Math.max(0.6, Math.min(EYE, crownStart * 0.9 || EYE));
		const position: V3 = add(add(trunk.axis, scale(out, reach * 0.3 * DISTANCE)), [0, eye, 0]);
		const lift = QUERY.elevation ?? 30;
		const back = scale(out, -1);
		const look: V3 = [
			back[0] * Math.cos((lift * Math.PI) / 180),
			Math.sin((lift * Math.PI) / 180),
			back[2] * Math.cos((lift * Math.PI) / 180),
		];
		view = { position, target: add(position, look), fov: FOV, near: 0.8 };
	} else if (VIEW === 'trunk') {
		// The bole from the ground to where the crown starts, so the taper and the fork height read.
		// A crown that reaches the ground leaves no clear bole, so the frame takes the lower trunk.
		const bole = crownStart < 2.2 ? Math.max(2.6, height * 0.45) : crownStart * 1.15;
		const half = Math.tan((FOV * Math.PI) / 360);
		view = orbit(
			[trunk.axis[0], bole / 2, trunk.axis[2]],
			(bole * 0.6) / half,
			QUERY.elevation ?? 0,
		);
		draw = 'wood';
	} else if (VIEW === 'bark-base') {
		const target: V3 = [trunk.axis[0], Math.max(0.25, trunk.radius), trunk.axis[2]];
		view = orbit(target, Math.max(0.9, trunk.radius * 4.5), QUERY.elevation ?? 15);
		draw = 'wood';
	} else if (VIEW === 'bark-mid') {
		const y = crownStart < 2.2 ? 1.4 : Math.min(2.5, Math.max(1.2, crownStart * 0.5));
		view = orbit(
			[trunk.axis[0], y, trunk.axis[2]],
			Math.max(0.5, trunk.radius * 3.2),
			QUERY.elevation ?? 0,
		);
		draw = 'wood';
	} else if (VIEW === 'bark-limb') {
		// A major limb that runs across the frame, near where it leaves the trunk unless the query
		// asks further along it.
		limb = limbOf(asset);
		if (limb) {
			const along = Math.max(0.4, (QUERY.along ?? 0.15) * limb.branch.length);
			const target = add(limb.branch.pivot, scale(limb.branch.axis, along));
			view = orbit(target, Math.max(0.6, limb.radius * 7), QUERY.elevation ?? -12);
		} else {
			notes.push('the plant has no limb, so the limb view shows the trunk');
			view = orbit([trunk.axis[0], 1.4, trunk.axis[2]], Math.max(0.5, trunk.radius * 3.2), 0);
		}
		draw = 'wood';
	} else if (VIEW === 'leaf-upper' || VIEW === 'leaf-under') {
		if (!leavesPart) throw new Error(`${SPECIES.id} has no leaves for the ${VIEW} view`);
		card = chooseCard(leavesPart, per, asset.crown.center);
		// The camera stands on the card's normal, upper or lower side. A small sideways lean keeps
		// the camera's up axis off a normal that points straight up.
		const side = VIEW === 'leaf-upper' ? 1 : -1;
		const lean = normalize([
			card.normal[0] * side + 0.18,
			card.normal[1] * side + 0.02,
			card.normal[2] * side + 0.18,
		]);
		view = {
			position: add(card.centre, scale(lean, card.radius * 3.2 * DISTANCE)),
			target: card.centre,
			fov: FOV,
		};
		draw = 'card';
	} else {
		// A cut piece stood upright, as the studio pictures stand a cut branch from a hidden clamp.
		const leafSize = Math.max(SPECIES.leaf?.width ?? 0.08, SPECIES.leaf?.height ?? 0.08);
		const branchLength = Math.min(2.5, Math.max(0.8, height * 0.1));
		const length =
			VIEW === 'branch'
				? branchLength
				: VIEW === 'subbranch'
					? branchLength * 0.38
					: Math.max(0.25, leafSize * 3);
		cutting = cuttingOf(asset, length, VIEW as 'branch' | 'subbranch' | 'cluster');
		const half = Math.tan((FOV * Math.PI) / 360);
		if (cutting) {
			const size = sub(cutting.max, cutting.min);
			const target: V3 = scale(add(cutting.min, cutting.max), 0.5);
			const across = Math.max(size[0], size[2]);
			const fit = Math.max((size[1] * 1.15) / 2 / half, (across * 1.15) / 2 / (half * ASPECT));
			view = orbit(target, fit + across * 0.5, QUERY.elevation ?? 8);
			draw = 'cutting';
			if (cutting.cropped)
				notes.push(
					`cropped to ${length.toFixed(2)} m from a branch that reaches ${cutting.reach.toFixed(2)} m`,
				);
		} else {
			placeholder = 'the plant has no branch to cut; the generator needs the cutting API';
			view = orbit([0, 0.5, 0], 2.5, 0);
		}
	}

	// The near plane follows the view's own scale, so a leaf a hand's width away and a crown thirty
	// metres away both keep their depth.
	const span = Math.hypot(...sub(view.target, view.position));
	const camera = scene.createPerspectiveCamera({
		fov: view.fov,
		near: view.near ?? Math.max(0.01, Math.min(0.5, span * 0.02)),
		far: 9000,
		position: view.position,
		target: view.target,
	});
	scene.setActiveCamera(camera);

	if (!silhouette) {
		// Soft even daylight: most of the light comes from the whole sky, with a mild sun that gives
		// the crown its depth without hard shadows, and a little light from below for the undersides.
		scene.createAmbientLight({ intensity: 0.6 });
		scene.createHemisphereLight({ skyColor: '#dfe8f0', groundColor: '#7f8166', intensity: 1.7 });
		scene.createDirectionalLight({
			direction: [-0.45, -1, -0.35],
			intensity: 1.9,
			castShadows: true,
			shadow: { distance: Math.max(40, height * 2.5 + reach * 2), contactDistance: 0.4 },
		});
		scene.createDirectionalLight({ direction: [0.35, 1, 0.3], intensity: 0.45 });
	}
	const groundColour = QUERY.ground ?? colours.ground;
	if (groundColour && !silhouette && draw !== 'cutting' && draw !== 'card') {
		// The meadow is unlit and casts nothing back, so it shows its measured colour everywhere and a
		// mask can tell it from the plant by colour alone. It reaches far enough that its edge sits on
		// the horizon from any camera height the views use.
		scene.createMesh({
			mesh: geometry.plane({ width: 8000, height: 8000 }),
			material: materials.unlit({ color: groundColour }),
			rotation: FLAT,
		});
	}

	// The wind is a clip's business: a still of a swaying plant differs on every device.
	const wind = QUERY.wind ? createWind(ctx, { camera, box: 96, grid: 64 }) : undefined;
	const field = wind ? plantWind(ctx, asset, wind.field, { swayDistance: 0 }) : undefined;
	const atlases = bakePlantAtlases(ctx);
	const black: [number, number, number] = [0, 0, 0];
	const leaves = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: leafCellFor(SPECIES),
		color: silhouette ? black : (SPECIES.color.leaf as [number, number, number]),
		transmission: silhouette ? 0 : SPECIES.color.transmission,
		...(silhouette ? { leafGloss: 0 } : {}),
		// A needle card keeps the atlas's own cutoff; a lower one fills the gaps between the needles.
		alphaCutoff: SPECIES.leaf?.kind === 'needle' ? 0.35 : 0.24,
		...(field ? { wind: field } : {}),
	});
	const bark = plantMaterial(ctx, {
		atlases,
		part: 'wood',
		color: silhouette ? black : (SPECIES.color.bark as [number, number, number]),
		barkCell: barkCellFor(SPECIES),
		barkTiles: 5,
		...(field ? { wind: field } : {}),
	});
	const drawPart = (
		name: PlantPart['name'],
		arrays: PartArrays,
		pose?: { rotation: [number, number, number, number]; position: V3 },
	) =>
		scene.createMesh({
			mesh: geometry.fromArrays(arrays),
			material: name === 'wood' ? bark : leaves,
			castShadows: !silhouette,
			receiveShadows: !silhouette,
			...(pose ?? {}),
		});

	if (placeholder) {
		// A plain magenta panel says at a glance that this frame stands in for a view the
		// generator cannot draw yet; the posted facts carry the reason.
		scene.createMesh({
			mesh: geometry.box({ width: 1.2, height: 0.8, depth: 0.05 }),
			material: materials.unlit({ color: '#d63bd6' }),
			position: [0, 0.5, 0],
			rotation: [0, Math.sin(TURN / 2), 0, Math.cos(TURN / 2)],
		});
	} else if (draw === 'card' && card && leavesPart) {
		drawPart('leaves', cardArrays(leavesPart, card, per));
	} else if (draw === 'cutting' && cutting) {
		for (const part of cutting.parts)
			drawPart(part.name, part.arrays, { rotation: cutting.rotation, position: cutting.position });
	} else {
		for (const part of parts)
			if (draw === 'all' || part.name === 'wood') drawPart(part.name, part.arrays);
	}

	page.post('plant-review', {
		species: SPECIES.id,
		view: VIEW,
		background: silhouette ? 'matte' : BACKGROUND,
		plant: {
			height,
			width: max[0] - min[0],
			depth: max[2] - min[2],
			reach,
			crownStart,
			trunkRadius: trunk.radius,
			triangles: asset.levels[0]?.triangles ?? 0,
		},
		camera: { position: view.position, target: view.target, fov: view.fov, aspect: ASPECT },
		...(limb
			? { limb: { branch: limb.index, length: limb.branch.length, radius: limb.radius } }
			: {}),
		...(cutting
			? {
					cutting: {
						branch: cutting.branch,
						level: cutting.level,
						reach: cutting.reach,
						cropped: cutting.cropped,
						size: sub(cutting.max, cutting.min),
					},
				}
			: {}),
		...(placeholder ? { placeholder } : {}),
		notes,
	});

	if (!wind) return {};
	return {
		onUpdate() {
			wind.update();
			setWindLayer([leaves, bark], wind.field);
		},
	};
});

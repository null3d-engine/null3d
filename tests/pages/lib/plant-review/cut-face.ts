// The face of a stem cut across, which a section view draws. The wood is a skin with no inside, so
// where the near plane cuts a stem the picture would look into an empty tube. The page lays a flat
// face over the cut instead, built from the wood's own triangles where they cross the cut's plane,
// and draws it as a part of the wood: the colour picture, the matte and the picture of the parts all
// take it as the plant's own wood.
import { cross, dot, type V3 } from './anatomy';
import { partPositions } from './measure';
import type { PlantPart, SpeciesBox } from './plant-types';

/** The plane a stem is cut across at. */
export interface CutPlane {
	/** A point on the stem's line, in plant-space metres. */
	readonly at: V3;
	/** The cut face's outward normal, a unit vector along the stem's line. */
	readonly normal: V3;
	/** The farthest from the point, in metres, that the cut stem's own skin reaches. */
	readonly reach: number;
}

/** The largest value of a 16-bit quantised coordinate. */
const STEPS = 65535;
/** Half the range of a 16-bit coordinate. */
const HALF_STEPS = 32767;
/** The largest magnitude of an 8-bit quantised normal's component. */
const NORMAL_STEPS = 127;

/** One crossing of the plane: the edge's two vertices and the share of the way from the first. */
interface Crossing {
	readonly from: number;
	readonly to: number;
	readonly t: number;
	readonly at: V3;
}

/**
 * The cut face over one wood part where the plane crosses it, as a wood part of its own: a fan of
 * triangles from the plane's point to each wood triangle's crossing, wound to face along the normal.
 * Each rim vertex takes the crossed edge's bark coordinates and its second coordinates, the radius
 * and the junction, where it crosses, and the vertex bytes of the nearer end. The middle vertex of
 * each fan triangle takes its rim's radius, junction and bytes, and bark coordinates half their
 * range away, so the bark across the face reads at its coarsest level: the face draws flat in the
 * skin's mean colour, where the rim's own coordinates would drag the skin's pattern in as streaks.
 * The grower holds no flesh, so the face shows the cut's outline and no inner structure. A crossing
 * farther from the point than the reach belongs to another stem the plane crosses, and is left out.
 *
 * @param part The wood part.
 * @param box The species box its positions are quantised in.
 * @param plane The cut's plane.
 * @returns The cut face, or undefined where the plane crosses none of the part's own stem.
 */
export function cutFace(part: PlantPart, box: SpeciesBox, plane: CutPlane): PlantPart | undefined {
	const source = part.arrays;
	const metres = partPositions(part, box);
	const vertices = metres.length / 3;
	const side = new Float64Array(vertices);
	for (let v = 0; v < vertices; v++)
		side[v] =
			((metres[v * 3] as number) - plane.at[0]) * plane.normal[0] +
			((metres[v * 3 + 1] as number) - plane.at[1]) * plane.normal[1] +
			((metres[v * 3 + 2] as number) - plane.at[2]) * plane.normal[2];
	const crossingOf = (from: number, to: number): Crossing | undefined => {
		const a = side[from] as number;
		const b = side[to] as number;
		if (a < 0 === b < 0) return undefined;
		const t = a / (a - b);
		const at: V3 = [0, 1, 2].map(
			(k) =>
				(metres[from * 3 + k] as number) +
				((metres[to * 3 + k] as number) - (metres[from * 3 + k] as number)) * t,
		) as V3;
		return { from, to, t, at };
	};
	const rims: (readonly [Crossing, Crossing])[] = [];
	const reach2 = plane.reach * plane.reach;
	const within = (c: Crossing) => {
		const d = [c.at[0] - plane.at[0], c.at[1] - plane.at[1], c.at[2] - plane.at[2]];
		return dot(d, d) <= reach2;
	};
	const indices = source.indices;
	for (let i = 0; i + 2 < indices.length; i += 3) {
		const a = indices[i] as number;
		const b = indices[i + 1] as number;
		const c = indices[i + 2] as number;
		const found = [crossingOf(a, b), crossingOf(b, c), crossingOf(c, a)].filter(
			(x): x is Crossing => x !== undefined,
		);
		if (found.length !== 2) continue;
		const [first, second] = found as [Crossing, Crossing];
		if (!within(first) || !within(second)) continue;
		const turn = cross(
			[first.at[0] - plane.at[0], first.at[1] - plane.at[1], first.at[2] - plane.at[2]],
			[second.at[0] - plane.at[0], second.at[1] - plane.at[1], second.at[2] - plane.at[2]],
		);
		rims.push(dot(turn, plane.normal) >= 0 ? [first, second] : [second, first]);
	}
	if (rims.length === 0) return undefined;

	const count = rims.length * 3;
	const positions = new Uint16Array(count * 3);
	const normals = new Int8Array(count * 3);
	const uvs = new Uint16Array(count * 2);
	const uvs1 = new Uint16Array(count * 2);
	const colors = new Uint8Array(count * 4);
	const tangents = source.tangents ? new Int8Array(count * 4) : undefined;
	const facing = plane.normal.map((n) => Math.round(n * NORMAL_STEPS));
	const quantised = (at: V3, k: number) => {
		const low = box.min[k] as number;
		const span = (box.max[k] as number) - low;
		return Math.min(STEPS, Math.max(0, Math.round((((at[k] as number) - low) / span) * STEPS)));
	};
	const lerp = (array: Uint16Array, width: number, c: Crossing, k: number) =>
		Math.round(
			(array[c.from * width + k] as number) +
				((array[c.to * width + k] as number) - (array[c.from * width + k] as number)) * c.t,
		);
	const write = (out: number, at: V3, rim: Crossing, middle: boolean) => {
		const nearer = rim.t < 0.5 ? rim.from : rim.to;
		for (let k = 0; k < 3; k++) {
			positions[out * 3 + k] = quantised(at, k);
			normals[out * 3 + k] = facing[k] as number;
		}
		for (let k = 0; k < 2; k++) {
			const uv = lerp(source.uvs, 2, rim, k);
			uvs[out * 2 + k] = middle ? (uv <= HALF_STEPS ? uv + HALF_STEPS : uv - HALF_STEPS) : uv;
			uvs1[out * 2 + k] = lerp(source.uvs1, 2, rim, k);
		}
		colors.set(source.colors.subarray(nearer * 4, nearer * 4 + 4), out * 4);
		tangents?.set((source.tangents as Int8Array).subarray(nearer * 4, nearer * 4 + 4), out * 4);
	};
	rims.forEach(([first, second], r) => {
		write(r * 3, plane.at, first, true);
		write(r * 3 + 1, first.at, first, false);
		write(r * 3 + 2, second.at, second, false);
	});
	const order = count <= STEPS + 1 ? new Uint16Array(count) : new Uint32Array(count);
	for (let i = 0; i < count; i++) order[i] = i;
	return {
		name: 'wood',
		arrays: {
			positions,
			normals,
			uvs,
			uvs1,
			colors,
			...(tangents && { tangents }),
			indices: order,
		},
	};
}

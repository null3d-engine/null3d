// Compound leaves: a rachis with leaflets in opposite pairs and a terminal leaflet (pinnate: ash,
// acacia), or a common stalk with leaflets fanned from its tip (palmate: horse chestnut, baobab).
// Each leaflet is the species' blade mesh, scaled by its place: pinnate leaflets grow toward the
// middle of the rachis, palmate ones toward the middle of the fan. The rachis is a thin tube or
// ribbon that samples the texture's drawn stalk.
//
// Leaf space as for a simple leaf: the attach point at the origin, the rachis up +Y, the upper faces
// toward +Z.
import type { PrototypeArrays } from '../asset';
import { cos, quatFromFrame, quatRotate, radians, sin, type Vector3 } from '../core/math';
import type { CompoundLeaf, LeafShape } from '../core/record';
import { type Detail, spreadMean } from '../core/types';
import type { LeafOutline } from './outline';
import { LeafSurface } from './surface';
import { MeshWriter, SURFACE_LEAF } from './writer';

/** Degrees between a pinnate leaflet and the rachis. */
const PINNATE_ANGLE = 62;
/** Degrees a palmate fan of seven or more leaflets spans, edge leaflet to edge leaflet. */
const PALMATE_FAN = 210;
/** Sides of the rachis tube by tier; 0 draws a ribbon. */
const RACHIS_SIDES: Readonly<Record<Detail, number>> = { low: 0, medium: 0, high: 3, ultra: 4 };

/**
 * The share of its base width that a rachis keeps at its tip. A leaf's outline runs to nothing at its
 * tip, but the rachis still carries the last pair of leaflets, so a rachis that tapered like the
 * outline would leave them on a thread the coverage mask cannot follow, and the mask cuts each
 * leaflet free as a piece of its own. At three quarters the last ring stands wide enough for the
 * mask to hold it to the wood.
 */
export const RACHIS_TIP_SHARE = 0.75;

/** The drawn width of a rachis at a share of its run from its base, 0 to 1, where the base takes the full radius. */
export function rachisWidth(radius: number, share: number): number {
	const held = Math.min(1, Math.max(0, share));
	return radius * (1 - (1 - RACHIS_TIP_SHARE) * held);
}

/**
 * One leaflet's place on a compound leaf.
 *
 * @category api/vegetation
 */
export interface LeafletPlace {
	/** Metres along the spine from the attach point. */
	readonly at: number;
	/** Degrees from the rachis about the leaf's normal, positive to the right. */
	readonly angle: number;
	/** Its size over the record's leaflet length. */
	readonly scale: number;
}

/**
 * The leaflets of a compound leaf, in order from the base.
 *
 * @param compound The record's compound leaf.
 * @param stalk Metres of the common stalk.
 * @param rachis Metres of the rachis past the stalk.
 * @returns Their places.
 * @category api/vegetation
 */
export function leafletPlaces(
	compound: CompoundLeaf,
	stalk: number,
	rachis: number,
): LeafletPlace[] {
	const count = Math.max(1, Math.round(spreadMean(compound.leaflets)));
	const out: LeafletPlace[] = [];
	if (compound.kind === 'palmate') {
		const fan = count === 1 ? 0 : PALMATE_FAN * Math.min(1, count / 7);
		for (let k = 0; k < count; k++) {
			const share = count === 1 ? 0.5 : k / (count - 1);
			const angle = (share - 0.5) * fan;
			// The middle leaflet is longest; the fan's edges a little over half its length.
			out.push({ at: stalk + rachis, angle, scale: 0.55 + 0.45 * cos(radians(angle * 0.85)) });
		}
		return out;
	}
	const terminal = compound.terminal ? 1 : 0;
	const spread =
		compound.angle === undefined ? PINNATE_ANGLE : Math.min(90, Math.max(30, compound.angle));
	const pairs = Math.max(1, Math.floor((count - terminal) / 2));
	for (let k = 0; k < pairs; k++) {
		const t = pairs === 1 ? 1 : k / (pairs - 1);
		const at = stalk + rachis * (0.12 + 0.82 * t);
		const scale = 0.7 + 0.3 * sin(Math.PI * (0.25 + 0.6 * t));
		out.push({ at, angle: -spread, scale }, { at, angle: spread, scale });
	}
	if (terminal) out.push({ at: stalk + rachis, angle: 0, scale: 1 });
	return out;
}

/**
 * One compound leaf mesh in leaf space at one tier.
 *
 * @param shape The record's leaf: its stalk is the compound leaf's, its curl bends the rachis.
 * @param compound The record's compound leaf.
 * @param outline The leaflet's outline.
 * @param leaflet The leaflet's mesh at this tier.
 * @param detail The tier.
 * @returns The mesh.
 * @category api/vegetation
 */
export function compoundLeaf(
	shape: LeafShape,
	compound: CompoundLeaf,
	outline: LeafOutline,
	leaflet: PrototypeArrays,
	detail: Detail,
): PrototypeArrays {
	const length = spreadMean(shape.length);
	// The compound leaf's spine: its stalk droops by the stalk's droop, its rachis curls by the curl.
	const spine = new LeafSurface(
		{ ...shape, fold: 0, crossCurl: 0, twist: 0, wave: [0, 0] },
		{ ...outline, petiole: outline.base },
		Math.max(compound.rachis * length, 1e-4),
	);
	const mesh = new MeshWriter();
	addRachis(mesh, spine, shape.petiole.radius * 0.8, outline, RACHIS_SIDES[detail]);
	const at = [0, 0, 0];
	const tangent = [0, 0, 0];
	const q = [0, 0, 0, 1];
	for (const place of leafletPlaces(compound, spine.stalk, spine.blade)) {
		spine.place(0, place.at, at);
		spine.tangent(place.at, tangent);
		const normal: Vector3 = [0, -(tangent[2] as number), tangent[1] as number];
		const a = radians(place.angle);
		const direction: Vector3 = [
			sin(a),
			cos(a) * (tangent[1] as number),
			cos(a) * (tangent[2] as number),
		];
		quatFromFrame(direction, normal, q);
		const { scale } = place;
		mesh.append(
			leaflet,
			(p, n) => {
				p[0] *= scale;
				p[1] *= scale;
				p[2] *= scale;
				quatRotate(q, 0, p, p);
				p[0] += at[0] as number;
				p[1] += at[1] as number;
				p[2] += at[2] as number;
				quatRotate(q, 0, n, n);
			},
			undefined,
			(uv1) => {
				uv1[0] = place.at + (uv1[0] as number) * scale;
				uv1[1] = (uv1[1] as number) * scale;
			},
		);
	}
	return mesh.finishPrototype();
}

/** The rachis: a thin tube or ribbon along the compound leaf's spine, sampling the drawn stalk. */
function addRachis(
	mesh: MeshWriter,
	spine: LeafSurface,
	radius: number,
	outline: LeafOutline,
	sides: number,
): void {
	if (radius <= 0) return;
	const total = spine.stalk + spine.blade;
	const rings = 5;
	const count = sides > 0 ? sides + 1 : 2;
	const centre = [0, 0, 0];
	const tangent = [0, 0, 0];
	const first = mesh.vertices;
	const stalkU = 0.5 / outline.texels;
	const v = (outline.petiole[1] + outline.base[1]) / 2;
	for (let r = 0; r < rings; r++) {
		const t = (total * r) / (rings - 1);
		const width = rachisWidth(radius, r / (rings - 1));
		spine.place(0, t, centre);
		spine.tangent(t, tangent);
		const ny = -(tangent[2] as number);
		const nz = tangent[1] as number;
		for (let k = 0; k < count; k++) {
			const angle = sides > 0 ? (2 * Math.PI * k) / sides : k === 0 ? Math.PI : 0;
			const c = cos(angle);
			const s = sides > 0 ? sin(angle) : 0;
			mesh.vertex(
				[
					(centre[0] as number) + c * width,
					(centre[1] as number) + s * width * ny,
					(centre[2] as number) + s * width * nz,
				],
				sides > 0 ? [c, s * ny, s * nz] : [0, ny, nz],
				[0.5 + c * stalkU, v],
				[t, 0],
				[0, 0, SURFACE_LEAF, 255],
			);
		}
	}
	const quads = sides > 0 ? sides : 1;
	for (let r = 0; r < rings - 1; r++)
		for (let k = 0; k < quads; k++) {
			const a = first + r * count + k;
			mesh.quad(a, a + 1, a + count + 1, a + count);
		}
}

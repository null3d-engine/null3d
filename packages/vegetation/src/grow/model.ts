// The shared generator's intermediate model: what a family's adapter writes and no more. A family
// states axes, the sockets that carry its pieces and the pieces' own measured figures. It writes no
// geometry, no material and no level: the shared stages price, grow, close, allocate and bake it.
//
// The model is plain data so a family can be checked against it without building anything: each
// socket names its carrying axis, its order and its share along that axis, and each piece carries
// the record figures its size comes from. The crown box is the pieces' own reach, so a family does
// not state a box beside them.
import { length3 } from '../core/math';
import type { Vec3 } from '../core/types';

/**
 * One axis of the model: a carrier chain from the root to the finest wood, with its course and
 * girth. A tuft's stool, a rosette's crown stalk and a tree's trunk are the same shape here.
 *
 * @category api/vegetation
 */
export interface ModelAxis {
	/** Its order: 0 for a root, one more for each axis between it and the root. */
	readonly order: number;
	/** Its parent's index, or -1 for an axis that starts at the plant's foot. */
	readonly parent: number;
	/** The share along its parent where it leaves, from 0 to 1. */
	readonly parentShare: number;
	/** Its course: its first node in plant space and a point along its line. */
	readonly from: Vec3;
	readonly to: Vec3;
	/**
	 * Its own nodes where its girth or its course bends, in order from its foot: a stool's drum is a
	 * column of three nodes, a shoot's column two. Left out, its foot and its tip.
	 */
	readonly nodes?: readonly { readonly at: Vec3; readonly radius: number }[];
	/** Its girth at its foot and at its tip, in metres. */
	readonly radius: readonly [number, number];
	/**
	 * Whether it is drawn wood at every state: the plant's body. A piece whose carrier is not drawn
	 * is dropped, so a body is the axis a plant's pieces hang from.
	 */
	readonly body: boolean;
}

/**
 * One socket of the model: where a piece stands, on which axis, at which share along it, and which
 * piece of the kit it carries. A piece's size against its own is the record's own figure.
 *
 * @category api/vegetation
 */
export interface ModelSocket {
	/** Its carrying axis, an index into the model's axes. */
	readonly axis: number;
	/** Its order: 1 for a piece on a root, one more for each carrier between. */
	readonly order: number;
	/** Its place along its axis, from 0 at the foot to 1 at the tip. */
	readonly share: number;
	/** Its attach point and the way it points, in plant space. */
	readonly at: Vec3;
	readonly direction: Vec3;
	/** The piece's index among the kit's pieces. */
	readonly piece: number;
	/** The piece's size against the one the kit holds. */
	readonly scale: number;
	/**
	 * Its place in the order the plant thins by: 0 for the pieces the least plant keeps, 1 for the
	 * first to go. A piece never goes before the axis that carries it.
	 */
	readonly keep: number;
	/** The carrier chain or foliage mass it belongs to, so a shoot thins whole. */
	readonly group: number;
}

/**
 * One piece of the kit, as the record's figures state it. The figures are the measured numbers the
 * piece's geometry is built from; the model carries them so the shared price and the crown box read
 * the record, never a retyped size.
 *
 * @category api/vegetation
 */
export interface ModelPiece {
	/** Its name in the record, such as `blade-3` or `sheath`. */
	readonly name: string;
	/** Its length in metres, and its width and depth. */
	readonly length: number;
	readonly width: number;
	readonly depth: number;
	/** How high the piece stands above its socket and how far it reaches out, in metres. */
	readonly top: number;
	readonly reach: number;
	/** The record's own figures for it, by name, in the units the record states them. */
	readonly figures: Readonly<Record<string, number>>;
}

/**
 * A plant as its family writes it: axes, sockets and pieces, with the box the pieces fill. This is
 * the whole of a family's statement to the generator.
 *
 * @category api/vegetation
 */
export interface PlantModel {
	/** The species' id. */
	readonly species: string;
	/** Its axes, parents before children. */
	readonly axes: readonly ModelAxis[];
	/** Its sockets, in the order the plant thins by. */
	readonly sockets: readonly ModelSocket[];
	/** The pieces its sockets carry, in the kit's order. */
	readonly pieces: readonly ModelPiece[];
	/** The pieces the least plant keeps: the sockets whose keep is 0. */
	readonly least: number;
	/** The share of the adult height the emitted state stands at, from its maturity. */
	readonly scale: number;
	/** The share of the grown sockets the state keeps, from its sparseness. */
	readonly keepShare: number;
	/** The tall piece's height above the soil and the widest piece's reach from the middle. */
	readonly crown: { readonly top: number; readonly reach: number };
}

/**
 * The box a model's pieces fill, from the sockets' places and each piece's own top and reach. A
 * family states its pieces, and the shared stages read the box from them.
 *
 * @param sockets The model's sockets.
 * @param pieces The model's pieces.
 * @returns The top, the lowest foliage and the horizontal reach, in metres.
 * @category api/vegetation
 */
export function crownOf(
	sockets: readonly ModelSocket[],
	pieces: readonly ModelPiece[],
): { top: number; base: number; reach: number } {
	let top = 0;
	let base = Number.POSITIVE_INFINITY;
	let reach = 0;
	for (const socket of sockets) {
		const piece = pieces[socket.piece];
		if (!piece) continue;
		const height = (socket.at[1] as number) + piece.top * socket.scale;
		top = Math.max(top, height);
		base = Math.min(base, socket.at[1] as number);
		reach = Math.max(
			reach,
			length3(socket.at[0] as number, 0, socket.at[2] as number) + piece.reach * socket.scale,
		);
	}
	return { top, base: Number.isFinite(base) ? Math.max(0, base) : 0, reach };
}

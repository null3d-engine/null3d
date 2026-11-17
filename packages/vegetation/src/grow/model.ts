// The shared generator's intermediate model, and the contract every family's adapter follows.
//
// An adapter is a family's only contribution to the generator. It writes a PlantModel for one
// state of one record and nothing else. The shared stages then do the rest, once for every family:
//
//   emit      the adapter writes the model at the state asked for, its maturity and its season.
//   price     the model's pieces and sockets are priced from the record's figures.
//   grow      the skeleton is built from the axes and sockets, and the pieces are scaled with it.
//   close     every kept socket's carrier is drawn or the socket is dropped, a piece's scale is
//             the record's, and a card level's cover comes from the leaf form's.
//   allocate  the maximum reaches each part, the crown first at low maximums, with the closure's
//             carriers counted, and every level inside its maximum.
//   bake      the card atlas, the far picture and the levels' draws.
//
// What an adapter emits, and what each field means:
//
//   axes      Parents before children, axis 0 the plant's foot. Each states its order, its parent
//             and the share along that parent, its course (from and to, with its own nodes where it
//             bends), its girth at the foot and the tip, and whether it is body: drawn at every
//             state, so a piece that hangs from it is never left without wood.
//   sockets   One for each piece. Each states the axis that carries it, the piece's order, its
//             share along that axis, its place and direction and, where it is not the world's
//             down, its lower side, the piece's index in the kit's class order, its scale against
//             the kit's piece, its keep rank (0 for the least plant's) and its group (a shoot
//             thins whole, with every piece on it).
//   pieces    One for each kit class. Each states its name, length, width and depth, the height it
//             stands above its socket and its reach out from it, and the record's own figures by
//             name. The crown box is read from these, never stated beside them.
//   least     The sockets whose keep is 0: what a sparseness never takes.
//   scale     The share of the adult height the emitted state stands at.
//   keepShare The share of the grown sockets the state keeps, from its sparseness.
//   crown     The box the pieces fill, as crownOf reads it.
//
// What an adapter may not do:
//
//   - write geometry, a material, a level or a bake, or carry a piece's mesh;
//   - price anything: a price that is not read from the record is a fault, not a default;
//   - thin outside the keep rank: no frame's thin array and no family allowance moves a piece;
//   - hold a cap decision: the maximum and the crown-first split belong to the shared allocator;
//   - name another family's piece class, or a species' number in code both families read.
//
// What the shared stages expect of a model:
//
//   - the model is the state asked for: maturity's counts, the season's pieces and the request's
//     flower ramp are the adapter's, while the sparseness cut belongs to the grow stage;
//   - axis 0's first two nodes are the seat the other axes leave from, and every other axis's
//     parent is a lower index, except a body axis, which has none: it stands on the trunk's line
//     joined to nothing, so the allocator's trunk part keeps it at every maximum;
//   - a socket's axis is an index into the axes, and a socket never outlasts its axis;
//   - a socket's piece index names the pieces' order, which is the kit's class order;
//   - a plant's top and box are its own at every sparseness: the grow reads every grown socket,
//     never only the kept ones, so no sparseness moves the frame;
//   - the body is the axis drawn at every state, the stool, the culm or a tree's inner body, so the
//     closure keeps the plant's base under any cap.
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
	 * is dropped, so a body is the axis a plant's pieces hang from. A body has no parent: it stands
	 * on the trunk's line joined to nothing, and the allocator's trunk part keeps it.
	 */
	readonly body: boolean;
	/**
	 * The steps the axis holds, which the body surface is sampled from, where the family states
	 * them: not the rings the draw places, since the shared draw crowds or thins its rings over the
	 * axis's nodes and radii. The figure travels with the model without becoming a draw constant.
	 * Left out on an axis that is not a body.
	 */
	readonly segments?: number;
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
	/**
	 * The piece's lower side where it is not the world's down, as a rolled leaf's is. The shared
	 * grow turns the socket by the direction and this side, so a leaf's face reads on the plant.
	 * Absent, the grow reads the side from the direction.
	 */
	readonly face?: Vec3;
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
	/**
	 * How far the piece hangs below its socket, in metres, where it does: a dead frond's skirt reaches
	 * under the crown. Absent, 0.
	 */
	readonly bottom?: number;
	/** The piece's middle in its own rest frame, where its clump card stands. Absent, half its reach. */
	readonly middle?: Vec3;
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
	/** Its sockets, in the layout's order; each socket's keep names its place in the thinning order. */
	readonly sockets: readonly ModelSocket[];
	/** The pieces its sockets carry, in the kit's order. */
	readonly pieces: readonly ModelPiece[];
	/** The pieces the least plant keeps: the sockets whose keep is 0. */
	readonly least: number;
	/** The share of the adult height the emitted state stands at, from its maturity. */
	readonly scale: number;
	/** The share of the grown sockets the state keeps, from its sparseness. */
	readonly keepShare: number;
	/**
	 * The box the pieces fill: the tall piece's height above the soil, the widest piece's reach
	 * from the middle, and the lowest foliage's height, which a hanging piece's `bottom` gives. A
	 * shared stage reads the box through `crownOf`, so the three figures are one reading.
	 */
	readonly crown: { readonly top: number; readonly reach: number; readonly base: number };
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
		base = Math.min(base, (socket.at[1] as number) - (piece.bottom ?? 0) * socket.scale);
		reach = Math.max(
			reach,
			length3(socket.at[0] as number, 0, socket.at[2] as number) + piece.reach * socket.scale,
		);
	}
	return { top, base: Number.isFinite(base) ? Math.max(0, base) : 0, reach };
}

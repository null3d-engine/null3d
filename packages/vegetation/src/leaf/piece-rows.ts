// The rows of a plant that carries pieces at its sockets. A directed grower ends its wood in
// sockets, each a bud site with a size, a rank and a group; a ground form's grower stands its
// sockets on its stool or its rhizome, and writes the pieces they carry itself. This module puts
// one piece at each socket, as rows of the kind the renderer draws for shoots: every part of the
// piece's chosen variant is a row of its own at the socket's place, with one turn, one scale, one
// wind record and one phase, so the parts move as one body. A socket carries the piece its record
// names, or the piece the socket itself names where a plant's sockets carry different pieces. No
// shade or sky line thins the rows afterwards: the grower placed the sockets where the foliage
// stands.
import type { ShootPrototype } from '../asset';
import { hashAt } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import type { GrowthModel, Species } from '../core/record';
import type { DressInput } from '../stages';
import type { Row } from './instancer';
import { type PiecePrototype, pieceTurn } from './piece';
import type { UncardedPrototype } from './shoot';

/** The most prototypes a kit holds: a row names its prototype in one byte. */
export const PROTOTYPES_MOST = 255;

/** The growth models that end their wood in sockets. */
const DIRECTED: readonly GrowthModel[] = ['conifer'];
/** The growth models whose growers write the pieces their sockets carry. */
const WRITTEN: readonly GrowthModel[] = ['tuft'];

/** The hash purposes of a socket's choices, apart from the shoot rows' own. */
const Purpose = { Variant: 0x31, Phase: 0x32 } as const;

/**
 * Whether a plant of this record carries pieces at sockets: it grows by a directed model and its
 * record gives pieces, or its grower writes its pieces.
 *
 * @param record The species record.
 * @returns Whether its kit holds pieces and its rows stand at sockets.
 */
export function carriesPieces(record: Species): boolean {
	return (
		(DIRECTED.includes(record.growth.model) && (record.pieces?.length ?? 0) > 0) ||
		WRITTEN.includes(record.growth.model)
	);
}

/**
 * Whether a plant of this record writes its own pieces: its kit holds them in a cutting's kit too,
 * since a cut piece of it is the pieces that stand on its frame.
 *
 * @param record The species record.
 * @returns Whether its grower writes the pieces.
 */
export function writesPieces(record: Species): boolean {
	return WRITTEN.includes(record.growth.model);
}

/**
 * A piece's part as a kit prototype, before the card bake gives it its cells.
 *
 * @param piece The part, as the piece planner built it.
 * @param index Its index in the kit.
 * @returns The prototype.
 */
export function kitPiece(piece: PiecePrototype, index: number): UncardedPrototype {
	return {
		index,
		class: 'piece',
		vigor: [0, 1],
		length: piece.length,
		radius: piece.radius,
		leaves: piece.leaves,
		tiers: piece.tiers,
		piece: {
			name: piece.piece,
			variant: piece.variant,
			part: piece.part,
			parts: piece.parts,
			attitude: piece.attitude,
			...(piece.plane ? { plane: piece.plane } : {}),
		},
	};
}

/** The piece that a record's sockets carry, by name, where its growth names one. */
function socketPiece(record: Species): string | undefined {
	return record.growth.model === 'conifer' ? record.growth.patch.sockets?.piece : undefined;
}

/**
 * The rows of a plant whose sockets carry pieces: one piece a socket, every part of it a row.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows, in the sockets' order.
 */
export function pieceRows(input: DressInput): Row[] {
	const { record, seed, variant, skeleton, kit } = input;
	const { buds, position } = skeleton;
	const sockets = buds.sockets;
	const rows: Row[] = [];
	if (!sockets || kit.prototypes.length === 0) return rows;
	const salt = record.seedSalt;
	const pick = (purpose: number, a: number) => hashAt(seed, salt, variant * 64 + purpose, a);
	// Each piece's variants, each variant its parts in order.
	const byName = new Map<string, ShootPrototype[][]>();
	for (const prototype of kit.prototypes) {
		const piece = prototype.piece;
		if (!piece) continue;
		let variants = byName.get(piece.name);
		if (!variants) {
			variants = [];
			byName.set(piece.name, variants);
		}
		let parts = variants[piece.variant];
		if (!parts) {
			parts = [];
			variants[piece.variant] = parts;
		}
		parts[piece.part] = prototype;
	}
	const named = socketPiece(record);
	// A stand-in kit holds no pieces: each socket then carries the kit's first prototype.
	const offered = (list: ShootPrototype[][] | undefined) =>
		list?.filter((parts) => parts !== undefined && parts.length > 0);
	const variants = offered(
		(named !== undefined ? byName.get(named) : undefined) ??
			byName.values().next().value ?? [[kit.prototypes[0] as ShootPrototype]],
	) as ShootPrototype[][];
	if (variants.length === 0) return rows;
	// A socket that names its piece names its place in the kit's order of pieces.
	const own = sockets.piece;
	const byPlace = own ? [...byName.values()].map(offered) : [];
	const heading: Vector3 = [0, 0, 0];
	for (let b = 0; b < buds.count; b++) {
		const choices = own && byPlace.length > 0 ? byPlace[own[b] as number] : variants;
		if (!choices || choices.length === 0)
			throw new Error(
				`@null3d/vegetation: '${record.id}' has no piece for a socket that names piece ${own?.[b]}`,
			);
		const parts = choices[pick(Purpose.Variant, b) % choices.length] as ShootPrototype[];
		const first = parts[0] as ShootPrototype;
		quatRotate(buds.frame, b * 4, [0, 1, 0], heading);
		const node = buds.node[b] as number;
		const axis = buds.axis[b] as number;
		const at: Vector3 = [
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		];
		const parentNode = skeleton.parent[node] as number;
		const back: Vector3 =
			parentNode >= 0
				? [
						(position[parentNode * 3] as number) - at[0],
						(position[parentNode * 3 + 1] as number) - at[1],
						(position[parentNode * 3 + 2] as number) - at[2],
					]
				: [0, 0, 0];
		const rotation = first.piece
			? pieceTurn(first.piece.attitude, heading)
			: [
					buds.frame[b * 4] as number,
					buds.frame[b * 4 + 1] as number,
					buds.frame[b * 4 + 2] as number,
					buds.frame[b * 4 + 3] as number,
				];
		const phase = pick(Purpose.Phase, b) & 255;
		for (const part of parts)
			rows.push({
				prototype: part.index,
				position: [at[0], at[1], at[2]],
				rotation: [...rotation],
				scale: sockets.scale[b] as number,
				record: skeleton.axes.record[axis] as number,
				phase,
				node,
				axis,
				back: [back[0], back[1], back[2]],
				socket: b,
			});
	}
	return rows;
}

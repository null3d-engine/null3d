// The pieces a ground form writes itself: a blade, a sheath column, a flowering stem and its head,
// each built once and placed whole at a socket. They are pieces of the same kind as a tree's branch
// pieces (leaf/piece.ts): the kit holds each part as a prototype, the plant's sockets carry them
// (leaf/piece-rows.ts), and their rows thin, bend in the wind and bake to cards as shoots do. Only
// how a piece is drawn differs: a branch piece is a shoot plan, and a ground form's piece is
// written by the meshers that write a merged plant's foliage.
//
// Those meshers give each vertex the share of the way along its part and its browning, which a
// piece keeps, and a wind record, where a prototype's vertex holds its bend weight, its flutter
// phase, its surface kind and its shade. `pieceTier` makes that change, so no mesher is written
// twice. A piece's surface kind is its own (leaf/writer.ts), so the plant material reads its
// second coordinates as a share and draws its browning, its collar and its sheath's colour as it
// does a merged plant's.
import type { PrototypeArrays } from '../asset';
import { length3 } from '../core/math';
import { DETAILS } from '../core/types';
import { smoothstep } from '../grow/ground';
import type { PieceAttitude, PiecePrototype } from './piece';
import type { UncardedPrototype } from './shoot';
import { MeshWriter, SURFACE_PIECE, SURFACE_PIECE_SHEATH, SURFACE_SHEATH } from './writer';

/**
 * One piece a ground form writes: its name, how a socket turns it, and what writes each of its
 * parts.
 *
 * @category api/vegetation
 */
export interface WrittenPiece {
	/** The piece's name, unique among the plant's pieces, such as `blade-3`. */
	readonly name: string;
	/** How a socket turns it. */
	readonly attitude: PieceAttitude;
	/** Degrees it is turned about its own line at every socket. Absent, 0. */
	readonly roll?: number;
	/** The piece's length in metres at scale 1, from its attach point to its tip along its curve. */
	readonly length: number;
	/**
	 * Leaves the piece holds, which the crown's light counts: none for a piece of stems alone, whose
	 * card takes a cell of half the side as a bare twig's does.
	 */
	readonly leaves: number;
	/**
	 * For a piece whose attach point stands on the soil: the metres above it under which the piece
	 * lies on the soil, as a blade that has come to rest does. Its bend falls to nothing there, so
	 * the wind does not lift it off the ground.
	 */
	readonly lies?: number;
	/**
	 * Writes each part at a detail tier into a mesh, as the merged foliage meshers write: its attach
	 * point at the origin and +Y the piece's own up. A socket carries every part at one place with
	 * one turn, so a part drawn apart from another, such as a stem's head, stays on it.
	 */
	readonly parts: readonly ((mesh: MeshWriter, tier: number) => void)[];
}

/** A written mesh as a prototype's arrays, its colours the row material's. */
function pieceTier(mesh: MeshWriter, phase: number, lies: number | undefined): PrototypeArrays {
	const count = mesh.vertices;
	for (let i = 0; i < count; i++) {
		// A part bends by how far along it a vertex stands, and not where it lies on the soil; a
		// sheath column keeps its mark.
		const along = Math.min(1, Math.max(0, mesh.uvs1[i * 2] as number));
		const held = lies === undefined ? 1 : smoothstep(0, lies, mesh.positions[i * 3 + 1] as number);
		const sheath = (mesh.colors[i * 4 + 2] as number) === SURFACE_SHEATH;
		mesh.colors[i * 4] = Math.round(255 * along * held);
		mesh.colors[i * 4 + 1] = phase;
		mesh.colors[i * 4 + 2] = sheath ? SURFACE_PIECE_SHEATH : SURFACE_PIECE;
		mesh.colors[i * 4 + 3] = 255;
	}
	return mesh.finishPrototype();
}

/**
 * Writes a ground form's pieces as the kit's piece prototypes, in the order of its list and each
 * piece's parts in order. Each piece has one variant.
 *
 * @param pieces The pieces.
 * @returns The prototypes, as the piece planner gives a tree's.
 * @category api/vegetation
 */
export function writtenPieces(pieces: readonly WrittenPiece[]): PiecePrototype[] {
	const out: PiecePrototype[] = [];
	for (const piece of pieces)
		piece.parts.forEach((write, part) => {
			const tiers = DETAILS.map((_, tier) => {
				const mesh = new MeshWriter();
				write(mesh, tier);
				// Each part flutters on its own beat, so two blades side by side do not flap as one.
				return pieceTier(mesh, (out.length * 89) & 255, piece.lies);
			}) as unknown as UncardedPrototype['tiers'];
			const positions = (tiers[DETAILS.indexOf('high')] as PrototypeArrays).positions;
			let radius = 0;
			for (let i = 0; i < positions.length; i += 3)
				radius = Math.max(
					radius,
					length3(positions[i] as number, positions[i + 1] as number, positions[i + 2] as number),
				);
			out.push({
				piece: piece.name,
				variant: 0,
				attitude: piece.attitude,
				...(piece.roll ? { roll: piece.roll } : {}),
				part,
				parts: piece.parts.length,
				length: piece.length,
				radius,
				leaves: piece.leaves,
				tiers,
				sites: [],
			});
		});
	return out;
}

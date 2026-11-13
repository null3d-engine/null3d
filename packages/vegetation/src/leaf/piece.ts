// Pieces: the parts a ground form builds once and places whole at a socket, such as a blade, a leaf
// on its stalk, a frond on its stalk or a flowering stem with its heads. A piece is a kit prototype,
// as a tree's shoot is, so its rows thin, bend in the wind and bake to cards as shoots do.
//
// The meshers that write a piece are the ones that write a merged plant's foliage. They give each
// vertex the share of the way along its part and its browning, which a piece keeps, and a wind
// record, where a prototype's vertex holds its bend weight, its flutter phase, its surface kind and
// its shade. `pieceTier` makes that change, so no mesher is written twice. A piece's surface kind
// is its own (leaf/writer.ts), so the plant material reads its second coordinates as a share and
// draws its browning, its collar and its sheath's colour as it does a merged plant's.
//
// A socket names its piece by its bud's vigor: each class of piece owns one even band of the range
// from 0 to 1, in the order the grower lists its classes, and a socket's vigor is the middle of its
// class's band.
import type { PrototypeArrays } from '../asset';
import { length3 } from '../core/math';
import { DETAILS } from '../core/types';
import type { UncardedPrototype } from './shoot';
import { MeshWriter, SURFACE_PIECE, SURFACE_PIECE_SHEATH, SURFACE_SHEATH } from './writer';

/**
 * One class of piece: its name, how many prototypes of it the kit holds, and what writes one.
 *
 * @category api/vegetation
 */
export interface PieceClass {
	/** The class's name, such as `piece-blade-outer`. */
	readonly name: `piece-${string}`;
	/** Prototypes of the class, each written from its own number: its shape variants. */
	readonly variants: number;
	/** The piece's length in metres at scale 1, from its attach point to its tip along its curve. */
	readonly length: number;
	/**
	 * Leaves the piece holds, which the crown's light counts: none for a piece of stems alone, whose
	 * card takes a cell of half the side as a bare twig's does.
	 */
	readonly leaves: number;
	/**
	 * Writes one prototype of the class at a detail tier into a mesh, as the merged foliage meshers
	 * write: its attach point at the origin, +Y the way it leaves, +Z its upper face.
	 */
	readonly write: (mesh: MeshWriter, tier: number, variant: number) => void;
}

/**
 * The band of bud vigor that a class of piece owns.
 *
 * @param index The class's place in the grower's list.
 * @param count The classes in the list.
 * @returns The band's ends.
 * @category api/vegetation
 */
export function pieceBand(index: number, count: number): readonly [number, number] {
	return [index / count, (index + 1) / count];
}

/**
 * The bud vigor that names a class of piece: the middle of its band.
 *
 * @param index The class's place in the grower's list.
 * @param count The classes in the list.
 * @returns The vigor.
 * @category api/vegetation
 */
export function socketVigor(index: number, count: number): number {
	return (index + 0.5) / count;
}

/** A written mesh as a prototype's arrays. */
function pieceTier(mesh: MeshWriter, phase: number): PrototypeArrays {
	const count = mesh.vertices;
	for (let i = 0; i < count; i++) {
		// A part bends by how far along it a vertex stands; a sheath column keeps its mark.
		const along = Math.min(1, Math.max(0, mesh.uvs1[i * 2] as number));
		const sheath = (mesh.colors[i * 4 + 2] as number) === SURFACE_SHEATH;
		mesh.colors[i * 4] = Math.round(255 * along);
		mesh.colors[i * 4 + 1] = phase;
		mesh.colors[i * 4 + 2] = sheath ? SURFACE_PIECE_SHEATH : SURFACE_PIECE;
		mesh.colors[i * 4 + 3] = 255;
	}
	return mesh.finishPrototype();
}

/**
 * Builds the prototypes of a grower's classes of piece, in the order of its list: every variant of
 * the first class, then of the second, and so on. Each prototype serves its class's band of vigor.
 *
 * @param classes The classes.
 * @returns The prototypes, without their cards.
 * @category api/vegetation
 */
export function piecePrototypes(classes: readonly PieceClass[]): UncardedPrototype[] {
	const out: UncardedPrototype[] = [];
	classes.forEach((piece, k) => {
		for (let variant = 0; variant < piece.variants; variant++) {
			const tiers = DETAILS.map((_, tier) => {
				const mesh = new MeshWriter();
				piece.write(mesh, tier, variant);
				// Each variant flutters on its own beat, so two blades side by side do not flap as one.
				return pieceTier(mesh, (out.length * 89) & 255);
			}) as unknown as UncardedPrototype['tiers'];
			const positions = (tiers[DETAILS.indexOf('high')] as PrototypeArrays).positions;
			let radius = 0;
			for (let i = 0; i < positions.length; i += 3)
				radius = Math.max(
					radius,
					length3(positions[i] as number, positions[i + 1] as number, positions[i + 2] as number),
				);
			out.push({
				index: out.length,
				class: piece.name,
				vigor: pieceBand(k, classes.length),
				length: piece.length,
				radius,
				leaves: piece.leaves,
				tiers,
			});
		}
	});
	return out;
}

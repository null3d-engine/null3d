// What the directed growers of whole pieces share: the order their sockets are ranked in, and the
// record's piece a socket names.
import type { Species } from '../core/record';
import type { PieceRule } from '../leaf/piece';

/**
 * The radical inverse of `index` in a base, two by default: an order whose every leading run is
 * spread evenly.
 */
export function radicalInverse(index: number, base = 2): number {
	let value = 0;
	let unit = 1 / base;
	for (let i = index; i > 0; i = Math.floor(i / base)) {
		value += (i % base) * unit;
		unit /= base;
	}
	return value;
}

/** The record's piece named `name`, and its place in the record's pieces. */
export function pieceNamed(record: Species, name: string): { rule: PieceRule; index: number } {
	const pieces = record.pieces ?? [];
	const index = pieces.findIndex((piece) => piece.name === name);
	if (index < 0) throw new Error(`@null3d/vegetation: '${record.id}' has no piece named '${name}'`);
	return { rule: pieces[index] as PieceRule, index };
}

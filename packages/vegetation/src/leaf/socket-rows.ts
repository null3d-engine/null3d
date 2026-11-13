// The rows of a plant whose pieces stand at sockets: one row a socket, the piece its vigor names,
// stood by the socket's own frame and scaled to the length the socket gives. A row's order is its
// socket's rank, its place among the skeleton's sockets, so whatever thins the rows by their order
// takes the pieces the grower marked to go first and leaves a plant that is spread evenly and holds
// together (grow/sockets.ts).
import type { ShootRows } from '../asset';
import { BUD_SOCKET } from '../core/graph';
import { hashAt } from '../core/hash';
import type { DressInput } from '../stages';
import { prototypesFor } from './instancer';

/** A row's sky visibility before the crown is lit: open sky. */
const OPEN_SKY = 250;
/** A row's bent normal before the crown is lit: straight up. */
const BENT_UP = 0x88;
/** Purposes of the hash keys, so no two draws share one. */
const Purpose = { Prototype: 0x51, Phase: 0x52 } as const;

/**
 * The rows of a variant's sockets, in the sockets' own order.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows.
 * @category api/vegetation
 */
export function socketRows(input: DressInput): ShootRows {
	const { skeleton, kit, seed, variant } = input;
	const { buds } = skeleton;
	const salt = input.record.seedSalt >>> 0;
	const sockets: number[] = [];
	for (let b = 0; b < buds.count; b++) if ((buds.kind[b] as number) === BUD_SOCKET) sockets.push(b);
	const count = kit.prototypes.length === 0 ? 0 : sockets.length;
	const rows = {
		count,
		prototype: new Uint8Array(count),
		position: new Float32Array(count * 3),
		rotation: new Float32Array(count * 4),
		scale: new Float32Array(count),
		record: new Uint16Array(count),
		phase: new Uint8Array(count),
		sky: new Uint8Array(count).fill(OPEN_SKY),
		bent: new Uint8Array(count).fill(BENT_UP),
		order: new Uint32Array(count),
		back: new Float32Array(count * 3),
	};
	// The prototypes each class of piece offers, found once for each vigor the sockets name.
	const offered = new Map<number, number[]>();
	for (let r = 0; r < count; r++) {
		const b = sockets[r] as number;
		const vigor = buds.vigor[b] as number;
		let candidates = offered.get(vigor);
		if (!candidates) {
			candidates = prototypesFor(kit.prototypes, vigor);
			offered.set(vigor, candidates);
		}
		const prototype =
			kit.prototypes[
				candidates[
					hashAt(seed, salt, variant * 64 + Purpose.Prototype, b) % candidates.length
				] as number
			];
		if (!prototype)
			throw new Error(`@null3d/vegetation: no piece serves a socket of vigor ${vigor}`);
		rows.prototype[r] = prototype.index;
		for (let k = 0; k < 3; k++) rows.position[r * 3 + k] = buds.position[b * 3 + k] as number;
		for (let k = 0; k < 4; k++) rows.rotation[r * 4 + k] = buds.frame[b * 4 + k] as number;
		rows.scale[r] = (buds.woodRadius[b] as number) / prototype.length;
		rows.record[r] = skeleton.axes.record[buds.axis[b] as number] as number;
		rows.phase[r] = hashAt(seed, salt, variant * 64 + Purpose.Phase, b) & 255;
		rows.order[r] = r;
	}
	return rows;
}

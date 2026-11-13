// A species' near table and the rows its slots hold. Each slot of the table holds one copy's place,
// turn and scale, which the plant shader reads to find a shoot's base in the copy's own space, and
// each of the copy's shoot rows stands in the world as one instance of its prototype's batch, with
// the values the shader reads. Fixed placements and the near pool's placements share one table per
// species.
import type { InstanceBatch } from '@null3d/engine';
import type { PlantAsset } from '../asset';
import { cos, sin } from '../core/math';
import type { PlantCopies } from './place';
import { toHalf, writeShootRow } from './records';
import { NEAR_SLOT_TEXELS, NEAR_SLOTS, type SpeciesKit } from './textures';

/** A species' near table on the CPU, and the next slot that no placement holds. */
export interface NearTable {
	readonly data: Float32Array;
	next: number;
}

/** Each species' near table, by its texture. */
const TABLES = new WeakMap<object, NearTable>();

/**
 * The near table of a species, made the first time it is asked for.
 *
 * @param kit The species' kit.
 * @returns The table.
 */
export function nearTable(kit: SpeciesKit): NearTable {
	let table = TABLES.get(kit.textures.near);
	if (!table) {
		table = { data: new Float32Array(NEAR_SLOTS * NEAR_SLOT_TEXELS * 4), next: 0 };
		TABLES.set(kit.textures.near, table);
	}
	return table;
}

/**
 * The slots of a species that placements hold: slots 0 up to this count.
 *
 * @param kit The species' kit.
 * @returns The slots held.
 */
export function heldNearSlots(kit: SpeciesKit): number {
	return TABLES.get(kit.textures.near)?.next ?? 0;
}

/**
 * Writes a slot's place into the table: the place's high halves and the copy's turn, then the
 * place's remainders and its scale.
 *
 * @param table The species' table.
 * @param slot The slot.
 * @param place The copy's place.
 * @param turn The copy's turn about +Y in radians.
 * @param scale The copy's scale.
 */
export function writeSlotPlace(
	table: NearTable,
	slot: number,
	place: readonly [number, number, number],
	turn: number,
	scale: number,
): void {
	const at = slot * NEAR_SLOT_TEXELS * 4;
	for (let k = 0; k < 3; k++) {
		const p = place[k] as number;
		const high = toHalf(p);
		table.data[at + k] = high;
		table.data[at + 4 + k] = p - high;
	}
	table.data[at + 3] = turn;
	table.data[at + 7] = scale;
}

/**
 * Writes one copy's shoot rows of one prototype into a batch from a row on: each row's place in the
 * world, its turn, its scale and the values the shader reads.
 *
 * @param batch The prototype's batch.
 * @param from The first row to write.
 * @param asset The copy's variant.
 * @param copies Where the copies stand.
 * @param copy The copy.
 * @param prototype The prototype.
 * @param slot The copy's slot in the species' near table.
 * @returns The row after the last one written.
 */
export function writeCopyRows(
	batch: InstanceBatch,
	from: number,
	asset: PlantAsset,
	copies: PlantCopies,
	copy: number,
	prototype: number,
	slot: number,
): number {
	const shoots = asset.shoots;
	const { positions, rotations, scales } = batch;
	const values = batch.values as Float32Array;
	const cx = copies.position[copy * 3] as number;
	const cy = copies.position[copy * 3 + 1] as number;
	const cz = copies.position[copy * 3 + 2] as number;
	const turn = copies.turn[copy] as number;
	const size = copies.scale[copy] as number;
	const c = cos(turn);
	const s = sin(turn);
	const q = [0, sin(turn / 2), 0, cos(turn / 2)];
	let row = from;
	for (let r = 0; r < shoots.count; r++) {
		if ((shoots.prototype[r] as number) !== prototype) continue;
		const x = (shoots.position[r * 3] as number) * size;
		const y = (shoots.position[r * 3 + 1] as number) * size;
		const z = (shoots.position[r * 3 + 2] as number) * size;
		positions[row * 3] = cx + x * c + z * s;
		positions[row * 3 + 1] = cy + y;
		positions[row * 3 + 2] = cz - x * s + z * c;
		turnQuaternion(q, shoots.rotation, r * 4, rotations, row * 4);
		scales.fill((shoots.scale[r] as number) * size, row * 3, row * 3 + 3);
		writeShootRow(
			values,
			row,
			asset.wind.base + (shoots.record[r] as number),
			shoots.phase[r] as number,
			shoots.sky[r] as number,
			shoots.bent[r] as number,
			slot,
		);
		row++;
	}
	return row;
}

/** Writes the turn `a` (about +Y only) times the quaternion at `b[bo]` into `out[oo]`. */
function turnQuaternion(
	a: readonly number[],
	b: Float32Array,
	bo: number,
	out: Float32Array,
	oo: number,
): void {
	const ay = a[1] as number;
	const aw = a[3] as number;
	const bx = b[bo] as number;
	const by = b[bo + 1] as number;
	const bz = b[bo + 2] as number;
	const bw = b[bo + 3] as number;
	out[oo] = aw * bx + ay * bz;
	out[oo + 1] = aw * by + ay * bw;
	out[oo + 2] = aw * bz - ay * bx;
	out[oo + 3] = aw * bw - ay * by;
}

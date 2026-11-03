// The wind records: one record of 16 floats per axis, with 16-bit ids global in the species' records
// texture, so one material serves every variant. A variant's records start at its index times
// `VARIANT_RECORDS`, so eight variants fit the 65,000 ids that a half float's range allows on WebGL2.
//
// A record turns its axis about the point where it leaves its parent: the junction on the parent's
// internode, not its own first node, which stands one internode out. Its axis runs from there to its
// tip, and its length is that span, so a vertex's share along the branch is its projection over it.
//
// A variant with more axes than its share of ids keeps one record per axis for its coarse orders
// and shares records among its finest axes by parent: the twigs of one branch swing together, and
// each branch keeps its own motion. The skeleton's axis records and the shoot rows' records are
// renumbered to the shared ids, so every mesh reads the same table.
import type { WindTable } from '../asset';
import { unitAt } from '../core/hash';
import { length3 } from '../core/math';
import { curveAt } from '../core/types';
import type { MeshInput } from '../stages';

/**
 * Floats in one wind record.
 *
 * @category api/vegetation
 */
export const WIND_RECORD_FLOATS = 16;

/**
 * Records each variant may hold. A variant's records start at its index times this, so eight
 * variants fit the species' 65,000 records.
 *
 * @category api/vegetation
 */
export const VARIANT_RECORDS = 8000;

/** The hash key of a record's sway phase, apart from every other draw of the plant's hashes. */
const PHASE_KEY = 0x57494e44;

/**
 * Which axis each record is made from, after the finest axes share records by parent when the
 * variant holds more axes than its share of ids. Returns the record of each axis and the axis that
 * each record is made from.
 */
function shareRecords(
	parent: Int32Array,
	order: Uint8Array,
	count: number,
	limit: number,
): { readonly recordOf: Uint32Array; readonly from: Uint32Array } {
	const recordOf = new Uint32Array(count);
	// `lead[a]` is the axis whose record axis `a` takes: itself, or the first sibling of its order
	// under the same parent once that order shares.
	const lead = new Int32Array(count);
	for (let a = 0; a < count; a++) lead[a] = a;
	let distinct = count;
	let deepest = 0;
	for (let a = 0; a < count; a++) deepest = Math.max(deepest, order[a] as number);
	const firstChild = new Int32Array(count);
	for (let shared = deepest; shared >= 1 && distinct > limit; shared--) {
		firstChild.fill(-1);
		for (let a = 0; a < count; a++) {
			if ((order[a] as number) < shared) continue;
			// An axis of this order or finer goes with its nearest ancestor of the shared order's
			// parent, so a whole twig system under one branch shares one record.
			let up = a;
			while ((order[up] as number) > shared && (parent[up] as number) >= 0)
				up = parent[up] as number;
			const owner = parent[up] as number;
			if (owner < 0) continue;
			if ((firstChild[owner] as number) < 0) firstChild[owner] = up;
			lead[a] = firstChild[owner] as number;
		}
		distinct = 0;
		for (let a = 0; a < count; a++) if (lead[a] === a) distinct++;
	}
	const from = new Uint32Array(distinct);
	const idOf = new Int32Array(count).fill(-1);
	let next = 0;
	for (let a = 0; a < count; a++)
		if (lead[a] === a) {
			idOf[a] = next;
			from[next++] = a;
		}
	for (let a = 0; a < count; a++) recordOf[a] = idOf[lead[a] as number] as number;
	return { recordOf, from };
}

/**
 * The wind records of one variant: pivot, axis, parent record, stiffness, flutter, order, length,
 * phase and whip weight per record. When the variant holds more axes than `VARIANT_RECORDS`, its
 * finest axes share records by parent, and the skeleton's axis records and the shoot rows' records
 * take the shared ids.
 *
 * @param input The dressed variant: the skeleton, its shoot rows, the record, the seed and the variant.
 * @returns The variant's wind table.
 */
export function windRecords(input: MeshInput): WindTable {
	const { record, skeleton, variant, seed } = input;
	const axes = skeleton.axes;
	const count = axes.count;
	const p = skeleton.position;
	const base = variant * VARIANT_RECORDS;
	const { recordOf, from } = shareRecords(axes.parent, axes.order, count, VARIANT_RECORDS);
	if (from.length !== count) {
		// A row names its axis by the axis's record as grown; the shared ids replace both.
		const axisOf = new Int32Array(65536).fill(-1);
		for (let a = 0; a < count; a++) axisOf[axes.record[a] as number] = a;
		const rows = input.rows;
		for (let r = 0; r < rows.count; r++) {
			const axis = axisOf[rows.record[r] as number] as number;
			rows.record[r] = axis < 0 ? 0 : (recordOf[axis] as number);
		}
		for (let a = 0; a < count; a++) axes.record[a] = recordOf[a] as number;
	}
	let deepest = 1;
	for (let a = 0; a < count; a++) deepest = Math.max(deepest, axes.order[a] as number);
	const { stiffness, flutter, whips } = record.wind;
	const records = new Float32Array(from.length * WIND_RECORD_FLOATS);
	for (let r = 0; r < from.length; r++) {
		const a = from[r] as number;
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		const parentAxis = axes.parent[a] as number;
		const parentNode = axes.parentNode[a] as number;
		// The pivot: where the axis leaves its parent's internode, or its own base for a stem.
		let px = p[first * 3] as number;
		let py = p[first * 3 + 1] as number;
		let pz = p[first * 3 + 2] as number;
		if (parentAxis >= 0 && parentNode >= 0) {
			const t = axes.parentT[a] as number;
			const nextNode = Math.min(parentNode + 1, axes.last[parentAxis] as number);
			px = (p[parentNode * 3] as number) * (1 - t) + (p[nextNode * 3] as number) * t;
			py = (p[parentNode * 3 + 1] as number) * (1 - t) + (p[nextNode * 3 + 1] as number) * t;
			pz = (p[parentNode * 3 + 2] as number) * (1 - t) + (p[nextNode * 3 + 2] as number) * t;
		}
		const dx = (p[last * 3] as number) - px;
		const dy = (p[last * 3 + 1] as number) - py;
		const dz = (p[last * 3 + 2] as number) - pz;
		const length = length3(dx, dy, dz);
		const order = axes.order[a] as number;
		const parentRecord = parentAxis < 0 ? -1 : base + (recordOf[parentAxis] as number);
		const at = r * WIND_RECORD_FLOATS;
		records[at] = px;
		records[at + 1] = py;
		records[at + 2] = pz;
		records[at + 3] = parentRecord;
		records[at + 4] = length > 0 ? dx / length : 0;
		records[at + 5] = length > 0 ? dy / length : 1;
		records[at + 6] = length > 0 ? dz / length : 0;
		records[at + 7] = curveAt(stiffness, order / deepest);
		records[at + 8] = flutter.amplitude;
		records[at + 9] = flutter.frequency;
		records[at + 10] = order;
		records[at + 11] = length;
		records[at + 12] = unitAt(seed, record.seedSalt, variant, PHASE_KEY, a);
		records[at + 13] = whips && order >= whips.fromOrder ? whips.pendulum : 0;
	}
	return { base, count: from.length, records };
}
